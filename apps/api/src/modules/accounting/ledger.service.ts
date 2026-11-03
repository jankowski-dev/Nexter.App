import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  accounts,
  assets,
  lots,
  postings,
  settings as settingsTable,
  tradeDetails,
  tradeGroups,
  transactions,
  type Asset,
  type Database,
  type DbExecutor,
  type Transaction,
} from '@nexter/db';
import type {
  ManualTransactionRequest,
  ManualTransactionResponse,
  Posting as PostingContract,
  Transaction as TransactionContract,
} from '@nexter/contracts';
import { AuditService } from '../../shared/audit/audit.service';
import { DB } from '../../shared/db/db.module';
import {
  AMOUNT_SCALE,
  USD_SCALE,
  Decimal,
  amountString,
  decimal,
  usdString,
} from '../../shared/money/decimal';
import { AccountingBootstrapService } from './accounting-bootstrap.service';
import { AccountsService } from './accounts.service';
import { AssetsService } from './assets.service';
import { FifoService } from './fifo.service';

interface PostingDraft {
  accountId: string;
  assetId: string;
  amount: Decimal;
  usdValue: Decimal;
}

type LotWork =
  | {
      kind: 'acquire';
      asset: Asset;
      amount: Decimal;
      costBasisUsd: Decimal;
      groupId: string | null;
    }
  | {
      kind: 'consume';
      asset: Asset;
      amount: Decimal;
      proceedsUsd: Decimal;
      feeUsd: Decimal;
      realize: boolean;
    };

export interface LedgerMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class LedgerService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly bootstrap: AccountingBootstrapService,
    private readonly accounts: AccountsService,
    private readonly assets: AssetsService,
    private readonly fifo: FifoService,
    private readonly audit: AuditService,
  ) {}

  async createManual(
    userId: string,
    input: ManualTransactionRequest,
    meta: LedgerMeta,
    idempotencyKey?: string,
  ): Promise<ManualTransactionResponse> {
    await this.bootstrap.ensureDefaults(userId);

    const result = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`accounting:${userId}`})::bigint)`,
      );

      if (idempotencyKey) {
        const [existing] = await tx
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
              eq(transactions.source, 'manual'),
              eq(transactions.sourceId, idempotencyKey),
            ),
          )
          .limit(1);

        if (existing) {
          const existingPostings = await tx
            .select()
            .from(postings)
            .where(eq(postings.transactionId, existing.id));

          return { transaction: existing, postings: existingPostings };
        }
      }

      const [settings] = await tx
        .select()
        .from(settingsTable)
        .where(eq(settingsTable.userId, userId))
        .limit(1);

      const includeGas = settings?.includeGasInCostBasis ?? true;
      const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
      const notes = input.type === 'adjustment' ? input.reason : (input.notes ?? null);
      const drafts: PostingDraft[] = [];
      const work: LotWork[] = [];
      let feesUsd = new Decimal(0);
      let tradeGroupId: string | null = null;
      let tradeDetail: {
        groupId: string;
        referencePriceUsd: Decimal | null;
        executionCostUsd: Decimal | null;
      } | null = null;

      const toUsd = (value: Decimal): Decimal => new Decimal(usdString(value));

      const assertAmount = (asset: Asset, amount: Decimal, label: string): void => {
        if (amount.decimalPlaces() > asset.decimals) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: `${label} supports at most ${asset.decimals} decimal places for ${asset.symbol}`,
            details: { assetId: asset.id, decimals: asset.decimals },
          });
        }
      };

      const add = (accountId: string, assetId: string, amount: Decimal, usdValue: Decimal) => {
        drafts.push({ accountId, assetId, amount, usdValue });
      };

      const resolveUsd = (
        asset: Asset,
        amount: Decimal,
        provided: string | undefined,
        label: string,
      ): Decimal => {
        if (provided !== undefined) {
          return decimal(provided);
        }

        if (asset.isCashEquivalent) {
          return toUsd(amount);
        }

        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `${label} is required for a non-cash asset`,
          details: { assetId: asset.id, symbol: asset.symbol },
        });
      };

      const resolveFee = async (
        feeAssetId: string | undefined,
        feeAmount: string | undefined,
        feeUsdValue: string | undefined,
      ): Promise<{ asset: Asset; amount: Decimal; usd: Decimal } | null> => {
        if (!feeAssetId && !feeAmount) {
          if (feeUsdValue !== undefined) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'feeUsdValue requires feeAssetId and feeAmount',
            });
          }

          return null;
        }

        if (!feeAssetId || !feeAmount) {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'feeAssetId and feeAmount must be provided together',
          });
        }

        const feeAsset = await this.assets.require(feeAssetId, tx);
        const amount = decimal(feeAmount);
        assertAmount(feeAsset, amount, 'feeAmount');
        const usd = resolveUsd(feeAsset, amount, feeUsdValue, 'feeUsdValue');
        return { asset: feeAsset, amount, usd };
      };

      const external = await this.accounts.systemAccount(userId, 'external', tx);

      const addExternal = (assetId: string, amount: Decimal, usdValue: Decimal) => {
        drafts.push({ accountId: external.id, assetId, amount, usdValue });
      };

      const addFeePostings = (
        accountId: string,
        fee: { asset: Asset; amount: Decimal; usd: Decimal } | null,
      ): void => {
        if (!fee) return;

        add(accountId, fee.asset.id, fee.amount.negated(), fee.usd.negated());
        addExternal(fee.asset.id, fee.amount, fee.usd);
      };

      switch (input.type) {
        case 'buy': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const base = await this.assets.require(input.assetId, tx);
          const quote = await this.assets.require(input.quoteAssetId, tx);

          if (!quote.isCashEquivalent) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'MVP manual buys require a cash-equivalent quote asset',
            });
          }

          const quoteAmount = decimal(input.quoteAmount);
          const baseAmount = decimal(input.amount);
          assertAmount(base, baseAmount, 'amount');
          assertAmount(quote, quoteAmount, 'quoteAmount');
          const tradeUsd = input.usdValue
            ? decimal(input.usdValue)
            : quote.isCashEquivalent
              ? toUsd(quoteAmount)
              : null;

          if (!tradeUsd || tradeUsd.lte(0)) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'A positive usdValue is required for a trade',
            });
          }

          const fee = await resolveFee(input.feeAssetId, input.feeAmount, input.feeUsdValue);
          const feeCapitalized = !base.isCashEquivalent && includeGas;
          feesUsd = fee && !feeCapitalized ? fee.usd : new Decimal(0);

          add(account.id, base.id, baseAmount, tradeUsd);
          addExternal(base.id, baseAmount.negated(), tradeUsd.negated());
          add(account.id, quote.id, quoteAmount.negated(), tradeUsd.negated());
          addExternal(quote.id, quoteAmount, tradeUsd);
          addFeePostings(account.id, fee);

          if (!base.isCashEquivalent) {
            tradeGroupId = await this.createGroup(userId, base.id, occurredAt, tx);
            work.push({
              kind: 'acquire',
              asset: base,
              amount: baseAmount,
              costBasisUsd: tradeUsd.plus(includeGas && fee ? fee.usd : 0),
              groupId: tradeGroupId,
            });
          }

          if (fee && !fee.asset.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset: fee.asset,
              amount: fee.amount,
              proceedsUsd: new Decimal(0),
              feeUsd: new Decimal(0),
              realize: false,
            });
          }

          tradeDetail = {
            groupId: tradeGroupId ?? '',
            referencePriceUsd: baseAmount.isZero() ? null : tradeUsd.div(baseAmount),
            executionCostUsd: null,
          };
          break;
        }

        case 'sell': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const base = await this.assets.require(input.assetId, tx);
          const proceedsAsset = await this.assets.require(input.proceedsAssetId, tx);

          if (!proceedsAsset.isCashEquivalent) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'MVP manual sells require a cash-equivalent proceeds asset',
            });
          }

          const baseAmount = decimal(input.amount);
          const proceedsAmount = decimal(input.proceedsAmount);
          assertAmount(base, baseAmount, 'amount');
          assertAmount(proceedsAsset, proceedsAmount, 'proceedsAmount');
          const proceedsUsd = input.usdValue
            ? decimal(input.usdValue)
            : proceedsAsset.isCashEquivalent
              ? toUsd(proceedsAmount)
              : null;

          if (!proceedsUsd || proceedsUsd.lte(0)) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'A positive usdValue is required for a trade',
            });
          }

          const fee = await resolveFee(input.feeAssetId, input.feeAmount, input.feeUsdValue);
          const feeCapitalized = !base.isCashEquivalent && includeGas;
          feesUsd = fee && !feeCapitalized ? fee.usd : new Decimal(0);

          add(account.id, base.id, baseAmount.negated(), proceedsUsd.negated());
          addExternal(base.id, baseAmount, proceedsUsd);
          add(account.id, proceedsAsset.id, proceedsAmount, proceedsUsd);
          addExternal(proceedsAsset.id, proceedsAmount.negated(), proceedsUsd.negated());
          addFeePostings(account.id, fee);

          if (!base.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset: base,
              amount: baseAmount,
              proceedsUsd,
              feeUsd: includeGas && fee ? fee.usd : new Decimal(0),
              realize: true,
            });
          }

          if (fee && !fee.asset.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset: fee.asset,
              amount: fee.amount,
              proceedsUsd: new Decimal(0),
              feeUsd: new Decimal(0),
              realize: false,
            });
          }

          tradeGroupId = input.tradeGroupId ?? null;
          if (tradeGroupId) {
            const [group] = await tx
              .select()
              .from(tradeGroups)
              .where(
                and(
                  eq(tradeGroups.id, tradeGroupId),
                  eq(tradeGroups.userId, userId),
                  eq(tradeGroups.assetId, base.id),
                ),
              )
              .limit(1);

            if (!group) {
              throw new NotFoundException({
                code: 'NOT_FOUND',
                message: 'Trade group not found for this asset',
              });
            }

            tradeDetail = {
              groupId: tradeGroupId,
              referencePriceUsd: baseAmount.isZero() ? null : proceedsUsd.div(baseAmount),
              executionCostUsd: null,
            };
          }
          break;
        }

        case 'swap': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const tokenIn = await this.assets.require(input.assetInId, tx);
          const tokenOut = await this.assets.require(input.assetOutId, tx);

          if (tokenIn.id === tokenOut.id) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'Swap assets must be different',
            });
          }

          const amountIn = decimal(input.amountIn);
          const amountOut = decimal(input.amountOut);
          assertAmount(tokenIn, amountIn, 'amountIn');
          assertAmount(tokenOut, amountOut, 'amountOut');
          const inUsd = input.usdValueIn
            ? decimal(input.usdValueIn)
            : tokenIn.isCashEquivalent
              ? toUsd(amountIn)
              : null;
          const outUsd = input.usdValueOut
            ? decimal(input.usdValueOut)
            : tokenOut.isCashEquivalent
              ? toUsd(amountOut)
              : null;

          if (!inUsd || !outUsd || inUsd.lte(0) || outUsd.lte(0)) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'Positive usdValueIn and usdValueOut are required for a swap',
            });
          }

          const fee = await resolveFee(input.feeAssetId, input.feeAmount, input.feeUsdValue);
          const feeCapitalized = !tokenOut.isCashEquivalent && includeGas;
          feesUsd = fee && !feeCapitalized ? fee.usd : new Decimal(0);

          add(account.id, tokenIn.id, amountIn.negated(), inUsd.negated());
          addExternal(tokenIn.id, amountIn, inUsd);
          add(account.id, tokenOut.id, amountOut, outUsd);
          addExternal(tokenOut.id, amountOut.negated(), outUsd.negated());
          addFeePostings(account.id, fee);

          if (!tokenIn.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset: tokenIn,
              amount: amountIn,
              proceedsUsd: inUsd,
              feeUsd: new Decimal(0),
              realize: true,
            });
          }

          if (!tokenOut.isCashEquivalent) {
            tradeGroupId = await this.createGroup(userId, tokenOut.id, occurredAt, tx);
            work.push({
              kind: 'acquire',
              asset: tokenOut,
              amount: amountOut,
              costBasisUsd: inUsd.plus(includeGas && fee ? fee.usd : 0),
              groupId: tradeGroupId,
            });
          }

          if (fee && !fee.asset.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset: fee.asset,
              amount: fee.amount,
              proceedsUsd: new Decimal(0),
              feeUsd: new Decimal(0),
              realize: false,
            });
          }

          tradeDetail = tradeGroupId
            ? {
                groupId: tradeGroupId,
                referencePriceUsd: amountOut.isZero() ? null : outUsd.div(amountOut),
                executionCostUsd: inUsd.minus(outUsd),
              }
            : null;
          break;
        }

        case 'transfer': {
          const from = await this.accounts.requireWallet(userId, input.fromAccountId, tx);
          const to = await this.accounts.requireWallet(userId, input.toAccountId, tx);
          const asset = await this.assets.require(input.assetId, tx);

          if (from.id === to.id) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'Transfer accounts must be different',
            });
          }

          const amount = decimal(input.amount);
          assertAmount(asset, amount, 'amount');
          const transferUsd = resolveUsd(asset, amount, input.usdValue, 'usdValue');

          if (transferUsd.lte(0)) {
            throw new BadRequestException({
              code: 'VALIDATION_ERROR',
              message: 'A positive usdValue is required for a transfer',
            });
          }

          const fee = await resolveFee(input.feeAssetId, input.feeAmount, input.feeUsdValue);
          feesUsd = fee?.usd ?? new Decimal(0);

          add(from.id, asset.id, amount.negated(), transferUsd.negated());
          add(to.id, asset.id, amount, transferUsd);
          addFeePostings(from.id, fee);

          if (fee && !fee.asset.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset: fee.asset,
              amount: fee.amount,
              proceedsUsd: new Decimal(0),
              feeUsd: new Decimal(0),
              realize: false,
            });
          }
          break;
        }

        case 'deposit': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const asset = await this.assets.require(input.assetId, tx);
          const amount = decimal(input.amount);
          assertAmount(asset, amount, 'amount');
          const usd = decimal(input.usdValue);

          add(account.id, asset.id, amount, usd);
          addExternal(asset.id, amount.negated(), usd.negated());

          if (!asset.isCashEquivalent) {
            work.push({
              kind: 'acquire',
              asset,
              amount,
              costBasisUsd: usd,
              groupId: null,
            });
          }
          break;
        }

        case 'withdrawal': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const asset = await this.assets.require(input.assetId, tx);
          const amount = decimal(input.amount);
          assertAmount(asset, amount, 'amount');
          const usd = decimal(input.usdValue);

          add(account.id, asset.id, amount.negated(), usd.negated());
          addExternal(asset.id, amount, usd);

          if (!asset.isCashEquivalent) {
            work.push({
              kind: 'consume',
              asset,
              amount,
              proceedsUsd: usd,
              feeUsd: new Decimal(0),
              realize: true,
            });
          }
          break;
        }

        case 'income': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const asset = await this.assets.require(input.assetId, tx);
          const income = await this.accounts.systemAccount(userId, 'income', tx);
          const amount = decimal(input.amount);
          assertAmount(asset, amount, 'amount');
          const usd = decimal(input.usdValue);

          add(account.id, asset.id, amount, usd);
          add(income.id, asset.id, amount.negated(), usd.negated());

          if (!asset.isCashEquivalent) {
            work.push({
              kind: 'acquire',
              asset,
              amount,
              costBasisUsd: usd,
              groupId: null,
            });
          }
          break;
        }

        case 'adjustment': {
          const account = await this.accounts.requireWallet(userId, input.accountId, tx);
          const asset = await this.assets.require(input.assetId, tx);
          const equity = await this.accounts.systemAccount(userId, 'equity', tx);
          const amount = decimal(input.amount);
          assertAmount(asset, amount, 'amount');
          const usd = decimal(input.usdValue);

          add(account.id, asset.id, amount, usd);
          add(equity.id, asset.id, amount.negated(), usd.negated());

          if (!asset.isCashEquivalent) {
            work.push({
              kind: 'acquire',
              asset,
              amount,
              costBasisUsd: usd,
              groupId: null,
            });
          }
          break;
        }

        default: {
          throw new BadRequestException({
            code: 'VALIDATION_ERROR',
            message: 'Unsupported manual transaction type',
          });
        }
      }

      this.assertBalanced(drafts);
      await this.assertNonNegative(userId, drafts, tx);

      const type =
        input.type === 'buy' || input.type === 'sell' || input.type === 'swap'
          ? 'trade'
          : input.type;

      const [transaction] = await tx
        .insert(transactions)
        .values({
          userId,
          type,
          subtype: input.type,
          source: 'manual',
          sourceId: idempotencyKey ?? null,
          tradeGroupId,
          occurredAt,
          notes,
          feesUsd: usdString(feesUsd),
        })
        .returning();

      if (!transaction) {
        throw new Error('Failed to create transaction');
      }

      const insertedPostings = await tx
        .insert(postings)
        .values(
          drafts.map((draft) => ({
            transactionId: transaction.id,
            accountId: draft.accountId,
            assetId: draft.assetId,
            amount: amountString(draft.amount),
            usdValue: usdString(draft.usdValue),
          })),
        )
        .returning();

      for (const item of work) {
        if (item.kind === 'acquire') {
          await this.createLot(
            userId,
            item.asset,
            item.amount,
            item.costBasisUsd,
            occurredAt,
            item.groupId,
            transaction.id,
            tx,
          );
        } else {
          await this.fifo.consume(
            userId,
            item.asset.id,
            amountString(item.amount),
            transaction.id,
            tx,
            {
              proceedsUsd: item.proceedsUsd,
              feeUsd: item.feeUsd,
              realize: item.realize,
            },
          );
        }
      }

      if (tradeDetail && tradeDetail.groupId) {
        await tx.insert(tradeDetails).values({
          tradeGroupId: tradeDetail.groupId,
          transactionId: transaction.id,
          referencePriceUsd: tradeDetail.referencePriceUsd
            ? usdString(tradeDetail.referencePriceUsd)
            : null,
          executionCostUsd: tradeDetail.executionCostUsd
            ? usdString(tradeDetail.executionCostUsd)
            : null,
        });
      }

      await this.audit.log(
        {
          userId,
          action: 'accounting.transaction_created',
          entityType: 'transaction',
          entityId: transaction.id,
          after: {
            type,
            subtype: input.type,
            occurredAt: occurredAt.toISOString(),
            feesUsd: usdString(feesUsd),
            reason: input.type === 'adjustment' ? input.reason : null,
            postings: drafts.map((draft) => ({
              accountId: draft.accountId,
              assetId: draft.assetId,
              amount: amountString(draft.amount),
              usdValue: usdString(draft.usdValue),
            })),
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
        { executor: tx, strict: true },
      );

      return { transaction, postings: insertedPostings };
    });

    return {
      transaction: this.toContract(result.transaction, result.postings),
    };
  }

  async list(userId: string): Promise<TransactionContract[]> {
    const rows = await this.db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.occurredAt), desc(transactions.createdAt))
      .limit(200);

    if (rows.length === 0) {
      return [];
    }

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(
        inArray(
          postings.transactionId,
          rows.map((row) => row.id),
        ),
      );

    const byTransaction = new Map<string, PostingContract[]>();

    for (const posting of postingRows) {
      const list = byTransaction.get(posting.transactionId) ?? [];
      list.push({
        id: posting.id,
        accountId: posting.accountId,
        assetId: posting.assetId,
        amount: posting.amount,
        usdValue: posting.usdValue,
      });
      byTransaction.set(posting.transactionId, list);
    }

    return rows.map((row) => this.toContract(row, byTransaction.get(row.id) ?? []));
  }

  async get(userId: string, transactionId: string): Promise<TransactionContract> {
    const [row] = await this.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Transaction not found',
      });
    }

    const postingRows = await this.db
      .select()
      .from(postings)
      .where(eq(postings.transactionId, row.id));

    return this.toContract(
      row,
      postingRows.map((posting) => ({
        id: posting.id,
        accountId: posting.accountId,
        assetId: posting.assetId,
        amount: posting.amount,
        usdValue: posting.usdValue,
      })),
    );
  }

  private toContract(
    transaction: Transaction,
    postingRows: Array<{
      id: string;
      accountId: string;
      assetId: string;
      amount: string;
      usdValue: string;
    }>,
  ): TransactionContract {
    return {
      id: transaction.id,
      type: transaction.type,
      subtype: transaction.subtype,
      source: transaction.source,
      sourceId: transaction.sourceId,
      tradeGroupId: transaction.tradeGroupId,
      occurredAt: transaction.occurredAt.toISOString(),
      notes: transaction.notes,
      feesUsd: transaction.feesUsd,
      postings: postingRows.map((posting) => ({
        id: posting.id,
        accountId: posting.accountId,
        assetId: posting.assetId,
        amount: posting.amount,
        usdValue: posting.usdValue,
      })),
    };
  }

  private assertBalanced(drafts: PostingDraft[]): void {
    const byAsset = new Map<string, Decimal>();

    for (const draft of drafts) {
      if (draft.amount.decimalPlaces() > AMOUNT_SCALE) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Amounts support at most ${AMOUNT_SCALE} decimal places`,
        });
      }

      if (draft.usdValue.decimalPlaces() > USD_SCALE) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `USD values support at most ${USD_SCALE} decimal places`,
        });
      }

      if (draft.amount.abs().gte(new Decimal('1e18'))) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Amount is too large',
        });
      }

      if (draft.usdValue.abs().gte(new Decimal('1e16'))) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'USD value is too large',
        });
      }

      byAsset.set(draft.assetId, (byAsset.get(draft.assetId) ?? new Decimal(0)).plus(draft.amount));
    }

    for (const [assetId, total] of byAsset) {
      if (!total.isZero()) {
        throw new Error(`Unbalanced ledger postings for asset ${assetId}`);
      }
    }
  }

  private async assertNonNegative(
    userId: string,
    drafts: PostingDraft[],
    executor: DbExecutor,
  ): Promise<void> {
    const accountIds = [...new Set(drafts.map((draft) => draft.accountId))];
    const accountRows = await executor
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), inArray(accounts.id, accountIds)));
    const accountById = new Map(accountRows.map((account) => [account.id, account]));
    const assetRows = await executor
      .select({ id: assets.id, chainId: assets.chainId, symbol: assets.symbol })
      .from(assets)
      .where(inArray(assets.id, [...new Set(drafts.map((draft) => draft.assetId))]));
    const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));

    for (const draft of drafts) {
      const account = accountById.get(draft.accountId);
      const asset = assetById.get(draft.assetId);

      if (!asset) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Asset not found',
          details: { assetId: draft.assetId },
        });
      }

      if (account?.type === 'wallet' && account.chainId && account.chainId !== asset.chainId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: `Asset ${asset.symbol} does not belong to the selected wallet chain`,
          details: {
            accountId: account.id,
            assetId: asset.id,
            accountChainId: account.chainId,
            assetChainId: asset.chainId,
          },
        });
      }
    }

    const deltas = new Map<string, { accountId: string; assetId: string; amount: Decimal }>();

    for (const draft of drafts) {
      const key = `${draft.accountId}:${draft.assetId}`;
      const existing = deltas.get(key);
      deltas.set(key, {
        accountId: draft.accountId,
        assetId: draft.assetId,
        amount: (existing?.amount ?? new Decimal(0)).plus(draft.amount),
      });
    }

    for (const delta of deltas.values()) {
      if (!delta.amount.isNegative()) continue;

      const account = accountById.get(delta.accountId);

      if (!account || account.type !== 'wallet') continue;

      const current = decimal(
        await this.accounts.balance(delta.accountId, delta.assetId, executor),
      );
      const next = current.plus(delta.amount);

      if (next.isNegative()) {
        throw new BadRequestException({
          code: 'NEGATIVE_BALANCE',
          message: 'Insufficient balance for this account and asset',
          details: {
            accountId: delta.accountId,
            assetId: delta.assetId,
            current: current.toFixed(18),
            change: delta.amount.toFixed(18),
          },
        });
      }
    }
  }

  private async createGroup(
    userId: string,
    assetId: string,
    openedAt: Date,
    executor: DbExecutor,
  ): Promise<string> {
    const [group] = await executor
      .insert(tradeGroups)
      .values({
        userId,
        assetId,
        status: 'open',
        openedAt,
      })
      .returning({ id: tradeGroups.id });

    if (!group) {
      throw new Error('Failed to create trade group');
    }

    return group.id;
  }

  private async createLot(
    userId: string,
    asset: Asset,
    amount: Decimal,
    costBasisUsd: Decimal,
    acquiredAt: Date,
    groupId: string | null,
    transactionId: string,
    executor: DbExecutor,
  ): Promise<void> {
    if (asset.isCashEquivalent) {
      return;
    }

    await executor.insert(lots).values({
      userId,
      assetId: asset.id,
      tradeGroupId: groupId,
      acquisitionTransactionId: transactionId,
      amount: amountString(amount),
      remainingAmount: amountString(amount),
      costBasisUsd: usdString(costBasisUsd),
      remainingCostBasisUsd: usdString(costBasisUsd),
      acquiredAt,
    });
  }
}
