import { encodeAbiParameters, encodeFunctionData } from 'viem';
import { describe, expect, it } from 'vitest';
import realSwapFixture from './kyber-swap-bsc.fixture.json';
import {
  KYBER_ROUTER_ABI,
  SIMPLE_SWAP_DATA_ABI,
  KyberCalldataError,
  decodeKyberSwapCalldata,
  validateKyberSwapBuild,
  type DecodedKyberSwap,
  type SwapBuildExpectation,
} from './kyber-calldata';

const wallet = '0x1111111111111111111111111111111111111111';
const router = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const executor = '0x8F10B468b06c6FD214B65F87778827F7D113f996';
const tokenIn = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d';
const tokenOut = '0x1d28d989f9e3ccb8b15d0cec601734514f958e4d';
const other = '0x2222222222222222222222222222222222222222';
const amount = 1_000_000_000_000_000_000n;
const minOut = 1_990_000_000_000_000_000n;
const quotedOut = 2_000_000_000_000_000_000n;
const deadline = Math.floor(Date.now() / 1000) + 300;

interface SwapOverrides {
  dstReceiver?: string;
  srcToken?: string;
  dstToken?: string;
  amount?: bigint;
  minReturnAmount?: bigint;
  srcReceivers?: string[];
  srcAmounts?: bigint[];
  feeReceivers?: string[];
  feeAmounts?: bigint[];
  callTarget?: string;
  approveTarget?: string;
  flags?: bigint;
  permit?: string;
  targetData?: string;
}

function encodeSwap(
  overrides: SwapOverrides = {},
  options: { functionName?: 'swap' | 'swapGeneric'; simple?: boolean } = {},
): string {
  const functionName = options.functionName ?? 'swap';
  const targetData =
    overrides.targetData ??
    (options.simple
      ? encodeAbiParameters(SIMPLE_SWAP_DATA_ABI, [
          {
            firstPools: [],
            firstSwapAmounts: [],
            swapDatas: [],
            deadline: BigInt(deadline),
            destTokenFeeData: '0x',
          },
        ])
      : '0x1234');

  return encodeFunctionData({
    abi: KYBER_ROUTER_ABI,
    functionName,
    args: [
      {
        callTarget: overrides.callTarget ?? executor,
        approveTarget: overrides.approveTarget ?? '0x0000000000000000000000000000000000000000',
        targetData,
        desc: {
          srcToken: overrides.srcToken ?? tokenIn,
          dstToken: overrides.dstToken ?? tokenOut,
          srcReceivers: overrides.srcReceivers ?? [executor],
          srcAmounts: overrides.srcAmounts ?? [overrides.amount ?? amount],
          feeReceivers: overrides.feeReceivers ?? [],
          feeAmounts: overrides.feeAmounts ?? [],
          dstReceiver: overrides.dstReceiver ?? wallet,
          amount: overrides.amount ?? amount,
          minReturnAmount: overrides.minReturnAmount ?? minOut,
          flags: overrides.flags ?? (options.simple ? 0x20n : 0x200n),
          permit: overrides.permit ?? '0x',
        },
        clientData: '0x',
      },
    ],
  });
}

function expectation(overrides: Partial<SwapBuildExpectation> = {}): SwapBuildExpectation {
  return {
    wallet,
    tokenIn,
    tokenOut,
    nativeIn: false,
    amountInBase: amount.toString(),
    minOutBase: minOut.toString(),
    quotedAmountOut: quotedOut.toString(),
    routerAddress: router,
    executorAllowlist: [executor],
    deadline,
    ...overrides,
  };
}

function codes(
  decoded: DecodedKyberSwap,
  expected: SwapBuildExpectation = expectation(),
): string[] {
  return validateKyberSwapBuild(decoded, expected).issues.map((item) => item.code);
}

describe('Kyber calldata decoding', () => {
  it('decodes swap and validates every security field', async () => {
    const decoded = await decodeKyberSwapCalldata(encodeSwap());

    expect(decoded).toMatchObject({
      functionName: 'swap',
      selector: '0xe21fd0e9',
      callTarget: executor.toLowerCase(),
      srcToken: tokenIn,
      dstToken: tokenOut,
      dstReceiver: wallet,
      amount: amount.toString(),
      minReturnAmount: minOut.toString(),
      simpleMode: false,
      simpleDeadline: null,
    });
    expect(codes(decoded)).toEqual([]);
    expect(validateKyberSwapBuild(decoded, expectation()).deadlineSource).toBe('server');
  });

  it('decodes swapGeneric with the same tuple shape', async () => {
    const decoded = await decodeKyberSwapCalldata(encodeSwap({}, { functionName: 'swapGeneric' }));

    expect(decoded.functionName).toBe('swapGeneric');
    expect(decoded.selector).toBe('0x59e50fed');
    expect(codes(decoded)).toEqual([]);
  });

  it('rejects simple-mode calldata until pool and destination-fee data are validated', async () => {
    const decoded = await decodeKyberSwapCalldata(encodeSwap({}, { simple: true }));

    expect(decoded.simpleMode).toBe(true);
    expect(decoded.simpleDeadline).toBe(deadline);
    expect(validateKyberSwapBuild(decoded, expectation()).deadlineSource).toBe('calldata');
    expect(codes(decoded)).toContain('SWAP_SIMPLE_MODE_NOT_ALLOWED');
  });

  it('decodes a real BSC Kyber swap fixture', async () => {
    const decoded = await decodeKyberSwapCalldata(realSwapFixture.input);

    expect(decoded).toMatchObject({
      functionName: 'swap',
      selector: '0xe21fd0e9',
      callTarget: executor.toLowerCase(),
      dstToken: tokenIn,
      amount: '1345949795856258439590',
      minReturnAmount: '6804472424954007124',
      simpleMode: false,
    });
    expect(decoded.srcToken).toMatch(/^0x[0-9a-f]{40}$/);
    expect(decoded.srcToken.startsWith('0x14f6')).toBe(true);
    expect(decoded.srcReceivers).toEqual([executor.toLowerCase()]);
    expect(decoded.feeReceivers).toEqual([]);
  });

  it('rejects unsupported selectors and malformed calldata', async () => {
    await expect(decodeKyberSwapCalldata('0xdeadbeef')).rejects.toMatchObject({
      code: 'SWAP_CALLDATA_UNSUPPORTED',
    });
    await expect(decodeKyberSwapCalldata('0xe21fd0e9deadbeef')).rejects.toMatchObject({
      code: 'SWAP_CALLDATA_INVALID',
    });

    try {
      await decodeKyberSwapCalldata('0xe21fd0e9deadbeef');
    } catch (error) {
      expect(error).toBeInstanceOf(KyberCalldataError);
    }
  });

  it('reports each calldata mismatch with a stable code', async () => {
    expect(codes(await decodeKyberSwapCalldata(encodeSwap({ dstReceiver: other })))).toContain(
      'SWAP_RECIPIENT_MISMATCH',
    );
    expect(codes(await decodeKyberSwapCalldata(encodeSwap({ dstToken: other })))).toContain(
      'SWAP_TOKEN_MISMATCH',
    );
    expect(codes(await decodeKyberSwapCalldata(encodeSwap({ amount: amount + 1n })))).toContain(
      'SWAP_AMOUNT_MISMATCH',
    );
    expect(
      codes(await decodeKyberSwapCalldata(encodeSwap({ minReturnAmount: minOut - 1n }))),
    ).not.toContain('SWAP_MIN_OUT_MISMATCH');
    expect(
      codes(await decodeKyberSwapCalldata(encodeSwap({ minReturnAmount: minOut - 1000n }))),
    ).toContain('SWAP_MIN_OUT_MISMATCH');
    expect(codes(await decodeKyberSwapCalldata(encodeSwap({ callTarget: other })))).toContain(
      'SWAP_EXECUTOR_NOT_ALLOWED',
    );
    expect(
      codes(
        await decodeKyberSwapCalldata(encodeSwap({ feeReceivers: [executor], feeAmounts: [1n] })),
      ),
    ).toContain('SWAP_FEE_NOT_ALLOWED');
    expect(codes(await decodeKyberSwapCalldata(encodeSwap({ permit: '0x1234' })))).toContain(
      'SWAP_PERMIT_NOT_ALLOWED',
    );
    expect(codes(await decodeKyberSwapCalldata(encodeSwap({ flags: 0x201n })))).toContain(
      'SWAP_PARTIAL_FILL_NOT_ALLOWED',
    );
  });

  it('rejects an expired simple-mode deadline', async () => {
    const targetData = encodeAbiParameters(SIMPLE_SWAP_DATA_ABI, [
      {
        firstPools: [],
        firstSwapAmounts: [],
        swapDatas: [],
        deadline: BigInt(deadline - 1),
        destTokenFeeData: '0x',
      },
    ]);
    const decoded = await decodeKyberSwapCalldata(
      encodeSwap({ targetData, flags: 0x20n }, { simple: true }),
    );

    expect(codes(decoded)).toContain('SWAP_DEADLINE_INVALID');
  });

  it('allows native input only without ERC-20 source receivers', async () => {
    const native = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
    const decoded = await decodeKyberSwapCalldata(
      encodeSwap({ srcToken: native, srcReceivers: [], srcAmounts: [] }),
    );

    expect(
      codes(
        decoded,
        expectation({
          tokenIn: native,
          nativeIn: true,
        }),
      ),
    ).toEqual([]);
  });
});
