import { Injectable, Logger } from '@nestjs/common';
import { decimal } from '../../shared/money/decimal';
import { NotificationsService } from './notifications.service';
import { ViberOutboxService } from './viber-outbox.service';
import { SettingsService } from '../settings/settings.service';

export interface ManualTradeClosedInput {
  groupId: string;
  symbol: string;
  realizedPnlUsd: string;
  costBasisUsd: string;
}

export interface BotTradeClosedInput {
  botId: string;
  botName: string;
  symbol: string;
  realizedPnlUsd: string;
  costBasisUsd: string;
}

export interface BotPositionsClosedInput {
  botId: string;
  botName: string;
  positions: number;
  realizedPnlUsd: string;
  costBasisUsd: string;
}

export interface BotStoppedInput {
  botId: string;
  botName: string;
  reason: string;
}

export interface TradeNotificationCopy {
  title: string;
  body: string;
  href: string;
}

export function formatSignedUsd(value: string): string {
  const amount = decimal(value);
  const absolute = amount.abs().toFixed(2);
  if (amount.gt(0)) return `+$${absolute}`;
  if (amount.lt(0)) return `-$${absolute}`;
  return `$${absolute}`;
}

export function formatReturnPct(realizedPnlUsd: string, costBasisUsd: string): string | null {
  const cost = decimal(costBasisUsd);
  if (cost.lte(0)) return null;
  const pct = decimal(realizedPnlUsd).div(cost).mul(100);
  return `${pct.gt(0) ? '+' : ''}${pct.toFixed(2)}%`;
}

function pnlLine(
  label: string,
  realizedPnlUsd: string,
  costBasisUsd: string,
  suffix: string,
): string {
  const pct = formatReturnPct(realizedPnlUsd, costBasisUsd);
  return `${label}: ${formatSignedUsd(realizedPnlUsd)}${pct ? ` (${pct})` : ''} · ${suffix}`;
}

function positionsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'позицию';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'позиции';
  return 'позиций';
}

export function manualTradeClosedCopy(input: ManualTradeClosedInput): TradeNotificationCopy {
  return {
    title: `Сделка закрыта: ${input.symbol}`,
    body: pnlLine('P&L', input.realizedPnlUsd, input.costBasisUsd, 'ручное закрытие'),
    href: `/trades/${input.groupId}`,
  };
}

export function botTradeClosedCopy(input: BotTradeClosedInput): TradeNotificationCopy {
  return {
    title: `Робот «${input.botName}» закрыл ${input.symbol}`,
    body: pnlLine('P&L', input.realizedPnlUsd, input.costBasisUsd, 'автоматическая продажа'),
    href: '/portfolio#robots',
  };
}

export function botPositionsClosedCopy(input: BotPositionsClosedInput): TradeNotificationCopy {
  return {
    title: `Робот «${input.botName}» закрыл ${input.positions} ${positionsWord(input.positions)}`,
    body: pnlLine('Итог', input.realizedPnlUsd, input.costBasisUsd, `позиций: ${input.positions}`),
    href: '/portfolio#robots',
  };
}

export function botStoppedCopy(input: BotStoppedInput): TradeNotificationCopy {
  return {
    title: 'Бот остановлен',
    body: `Бот «${input.botName}» остановлен: ${input.reason}.`,
    href: '/portfolio#robots',
  };
}

@Injectable()
export class TradingNotificationsService {
  private readonly logger = new Logger(TradingNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly outbox: ViberOutboxService,
    private readonly settings: SettingsService,
  ) {}

  async manualTradeClosed(userId: string, input: ManualTradeClosedInput): Promise<void> {
    const runtime = await this.settings.getRuntime();
    if (!runtime.notifyTradesClosed) return;
    await this.deliver(
      userId,
      'trade_closed',
      manualTradeClosedCopy(input),
      {
        groupId: input.groupId,
        symbol: input.symbol,
        realizedPnlUsd: input.realizedPnlUsd,
        costBasisUsd: input.costBasisUsd,
      },
      runtime.viberNotificationsEnabled && runtime.viberTradeClosedEnabled,
    );
  }

  async botTradeClosed(userId: string, input: BotTradeClosedInput): Promise<void> {
    const runtime = await this.settings.getRuntime();
    if (!runtime.notifyTradesClosed) return;
    await this.deliver(
      userId,
      'bot_trade_closed',
      botTradeClosedCopy(input),
      {
        botId: input.botId,
        symbol: input.symbol,
        realizedPnlUsd: input.realizedPnlUsd,
        costBasisUsd: input.costBasisUsd,
      },
      runtime.viberNotificationsEnabled && runtime.viberTradeClosedEnabled,
    );
  }

  async botPositionsClosed(userId: string, input: BotPositionsClosedInput): Promise<void> {
    const runtime = await this.settings.getRuntime();
    if (!runtime.notifyPositionsClosed) return;
    await this.deliver(
      userId,
      'bot_positions_closed',
      botPositionsClosedCopy(input),
      {
        botId: input.botId,
        positions: input.positions,
        realizedPnlUsd: input.realizedPnlUsd,
        costBasisUsd: input.costBasisUsd,
      },
      runtime.viberNotificationsEnabled && runtime.viberTradeClosedEnabled,
    );
  }

  async botStopped(userId: string, input: BotStoppedInput): Promise<void> {
    const runtime = await this.settings.getRuntime();
    if (!runtime.notifyBotStopped) return;
    await this.deliver(
      userId,
      'bot_stopped',
      botStoppedCopy(input),
      { botId: input.botId, reason: input.reason },
      runtime.viberNotificationsEnabled && runtime.viberBotStoppedEnabled,
    );
  }

  private async deliver(
    userId: string,
    type: string,
    copy: TradeNotificationCopy,
    payload: Record<string, unknown>,
    viberEnabled: boolean,
  ): Promise<void> {
    try {
      await this.notifications.create({
        userId,
        type,
        title: copy.title,
        body: copy.body,
        href: copy.href,
        payload,
      });
    } catch (error) {
      this.logger.warn(
        `Trade notification failed for ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    if (!viberEnabled) return;
    try {
      await this.outbox.enqueue({
        userId,
        type,
        title: copy.title,
        body: copy.body,
        payload,
      });
    } catch (error) {
      this.logger.warn(
        `Viber enqueue failed for ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
