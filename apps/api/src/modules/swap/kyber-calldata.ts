type Hex = `0x${string}`;

export const KYBER_SWAP_SELECTOR = '0xe21fd0e9';
export const KYBER_SWAP_GENERIC_SELECTOR = '0x59e50fed';
const MIN_OUT_TOLERANCE_WEI = 10n;

export const KYBER_SUPPORTED_SELECTORS = [KYBER_SWAP_SELECTOR, KYBER_SWAP_GENERIC_SELECTOR];

const SWAP_DESCRIPTION_COMPONENTS = [
  { name: 'srcToken', type: 'address' },
  { name: 'dstToken', type: 'address' },
  { name: 'srcReceivers', type: 'address[]' },
  { name: 'srcAmounts', type: 'uint256[]' },
  { name: 'feeReceivers', type: 'address[]' },
  { name: 'feeAmounts', type: 'uint256[]' },
  { name: 'dstReceiver', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'minReturnAmount', type: 'uint256' },
  { name: 'flags', type: 'uint256' },
  { name: 'permit', type: 'bytes' },
] as const;

const EXECUTION_COMPONENTS = [
  { name: 'callTarget', type: 'address' },
  { name: 'approveTarget', type: 'address' },
  { name: 'targetData', type: 'bytes' },
  { name: 'desc', type: 'tuple', components: SWAP_DESCRIPTION_COMPONENTS },
  { name: 'clientData', type: 'bytes' },
] as const;

/** Kyber MetaAggregationRouterV2 on BSC. Both functions share the same tuple shape. */
export const KYBER_ROUTER_ABI = [
  {
    type: 'function',
    name: 'swap',
    stateMutability: 'payable',
    inputs: [{ name: 'execution', type: 'tuple', components: EXECUTION_COMPONENTS }],
    outputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'gasUsed', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'swapGeneric',
    stateMutability: 'payable',
    inputs: [{ name: 'execution', type: 'tuple', components: EXECUTION_COMPONENTS }],
    outputs: [
      { name: 'returnAmount', type: 'uint256' },
      { name: 'gasUsed', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Swapped',
    inputs: [
      { name: 'sender', type: 'address', indexed: false },
      { name: 'srcToken', type: 'address', indexed: false },
      { name: 'dstToken', type: 'address', indexed: false },
      { name: 'dstReceiver', type: 'address', indexed: false },
      { name: 'spentAmount', type: 'uint256', indexed: false },
      { name: 'returnAmount', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** `swapSimpleMode` receives this struct as `executorData`. */
export const SIMPLE_SWAP_DATA_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'firstPools', type: 'address[]' },
      { name: 'firstSwapAmounts', type: 'uint256[]' },
      { name: 'swapDatas', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
      { name: 'destTokenFeeData', type: 'bytes' },
    ],
  },
] as const;

interface RawSwapDescription {
  srcToken: string;
  dstToken: string;
  srcReceivers: readonly string[];
  srcAmounts: readonly bigint[];
  feeReceivers: readonly string[];
  feeAmounts: readonly bigint[];
  dstReceiver: string;
  amount: bigint;
  minReturnAmount: bigint;
  flags: bigint;
  permit: string;
}

interface RawExecution {
  callTarget: string;
  approveTarget: string;
  targetData: string;
  desc: RawSwapDescription;
  clientData: string;
}

export interface DecodedKyberSwap {
  functionName: 'swap' | 'swapGeneric';
  selector: string;
  callTarget: string;
  approveTarget: string;
  targetData: string;
  srcToken: string;
  dstToken: string;
  srcReceivers: string[];
  srcAmounts: string[];
  feeReceivers: string[];
  feeAmounts: string[];
  dstReceiver: string;
  amount: string;
  minReturnAmount: string;
  flags: bigint;
  permit: string;
  clientData: string;
  simpleMode: boolean;
  simpleDeadline: number | null;
}

export class KyberCalldataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'KyberCalldataError';
  }
}

function invalid(message: string): never {
  throw new KyberCalldataError('SWAP_CALLDATA_INVALID', message);
}

export async function decodeKyberSwapCalldata(data: string): Promise<DecodedKyberSwap> {
  if (!/^0x[0-9a-fA-F]+$/.test(data) || data.length < 10) {
    invalid('Calldata is not valid hex');
  }

  const selector = data.slice(0, 10).toLowerCase();

  if (!KYBER_SUPPORTED_SELECTORS.includes(selector)) {
    throw new KyberCalldataError(
      'SWAP_CALLDATA_UNSUPPORTED',
      'Calldata selector is not a supported Kyber swap function',
    );
  }

  const { decodeAbiParameters, decodeFunctionData } = await import('viem');
  const decoded = (() => {
    try {
      return decodeFunctionData({ abi: KYBER_ROUTER_ABI, data: data as Hex });
    } catch {
      invalid('Calldata does not match the Kyber router ABI');
    }
  })();

  const execution = decoded.args[0] as unknown as RawExecution;
  const desc = execution.desc;

  if (!desc) invalid('Calldata is missing the swap description');

  const simpleMode = decoded.functionName === 'swap' && (desc.flags & 0x20n) !== 0n;
  let simpleDeadline: number | null = null;

  if (simpleMode) {
    try {
      const [simple] = decodeAbiParameters(
        SIMPLE_SWAP_DATA_ABI,
        execution.targetData as Hex,
      ) as unknown as [{ deadline: bigint }];

      const deadline = Number(simple.deadline);

      if (!Number.isSafeInteger(deadline) || deadline <= 0) {
        invalid('Simple swap deadline is not a valid timestamp');
      }

      simpleDeadline = deadline;
    } catch (error) {
      if (error instanceof KyberCalldataError) throw error;
      invalid('Simple swap data could not be decoded');
    }
  }

  return {
    functionName: decoded.functionName,
    selector,
    callTarget: execution.callTarget.toLowerCase(),
    approveTarget: execution.approveTarget.toLowerCase(),
    targetData: execution.targetData,
    srcToken: desc.srcToken.toLowerCase(),
    dstToken: desc.dstToken.toLowerCase(),
    srcReceivers: [...desc.srcReceivers].map((address) => address.toLowerCase()),
    srcAmounts: [...desc.srcAmounts].map((amount) => amount.toString()),
    feeReceivers: [...desc.feeReceivers].map((address) => address.toLowerCase()),
    feeAmounts: [...desc.feeAmounts].map((amount) => amount.toString()),
    dstReceiver: desc.dstReceiver.toLowerCase(),
    amount: desc.amount.toString(),
    minReturnAmount: desc.minReturnAmount.toString(),
    flags: desc.flags,
    permit: desc.permit,
    clientData: execution.clientData,
    simpleMode,
    simpleDeadline,
  };
}

export interface SwapBuildExpectation {
  wallet: string;
  tokenIn: string;
  tokenOut: string;
  nativeIn: boolean;
  amountInBase: string;
  minOutBase: string;
  quotedAmountOut: string;
  routerAddress: string;
  executorAllowlist: string[];
  deadline: number;
}

export interface SwapBuildIssue {
  check: string;
  code: string;
  detail: string;
}

export interface SwapBuildValidationResult {
  issues: SwapBuildIssue[];
  passedChecks: string[];
  deadlineSource: 'calldata' | 'server';
}

function lower(value: string): string {
  return value.toLowerCase();
}

function includesAddress(list: string[], address: string): boolean {
  return list.some((item) => lower(item) === lower(address));
}

function issue(check: string, code: string, detail: string): SwapBuildIssue {
  return { check, code, detail };
}

export function validateKyberSwapBuild(
  decoded: DecodedKyberSwap,
  expected: SwapBuildExpectation,
): SwapBuildValidationResult {
  const issues: SwapBuildIssue[] = [];
  const passedChecks: string[] = [];
  const pass = (check: string): void => {
    passedChecks.push(check);
  };

  if (
    decoded.srcToken !== lower(expected.tokenIn) ||
    decoded.dstToken !== lower(expected.tokenOut)
  ) {
    issues.push(
      issue(
        'calldata.tokens',
        'SWAP_TOKEN_MISMATCH',
        'Calldata tokens do not match the quoted pair',
      ),
    );
  } else {
    pass('calldata.tokens');
  }

  if (decoded.simpleMode) {
    issues.push(
      issue(
        'calldata.simpleMode',
        'SWAP_SIMPLE_MODE_NOT_ALLOWED',
        'Simple-mode swaps are rejected until pool and destination-fee data are validated',
      ),
    );
  } else {
    pass('calldata.simpleMode');
  }

  if (decoded.dstReceiver !== lower(expected.wallet)) {
    issues.push(
      issue(
        'calldata.recipient',
        'SWAP_RECIPIENT_MISMATCH',
        'Calldata recipient does not match the connected wallet',
      ),
    );
  } else {
    pass('calldata.recipient');
  }

  if (decoded.amount !== BigInt(expected.amountInBase).toString()) {
    issues.push(
      issue(
        'calldata.amount',
        'SWAP_AMOUNT_MISMATCH',
        'Calldata input amount does not match the quote',
      ),
    );
  } else {
    pass('calldata.amount');
  }

  if (
    BigInt(decoded.minReturnAmount) + MIN_OUT_TOLERANCE_WEI < BigInt(expected.minOutBase) ||
    BigInt(decoded.minReturnAmount) > BigInt(expected.quotedAmountOut)
  ) {
    issues.push(
      issue(
        'calldata.minOut',
        'SWAP_MIN_OUT_MISMATCH',
        'Calldata minimum output is outside the quoted bounds',
      ),
    );
  } else {
    pass('calldata.minOut');
  }

  if (!includesAddress(expected.executorAllowlist, decoded.callTarget)) {
    issues.push(
      issue(
        'calldata.executor',
        'SWAP_EXECUTOR_NOT_ALLOWED',
        'Calldata executor is not in the allowlist',
      ),
    );
  } else {
    pass('calldata.executor');
  }

  if (
    decoded.approveTarget !== '0x0000000000000000000000000000000000000000' &&
    decoded.approveTarget !== lower(expected.routerAddress) &&
    !includesAddress(expected.executorAllowlist, decoded.approveTarget)
  ) {
    issues.push(
      issue(
        'calldata.approveTarget',
        'SWAP_APPROVE_TARGET_NOT_ALLOWED',
        'Calldata approve target is not allowed',
      ),
    );
  } else {
    pass('calldata.approveTarget');
  }

  if (decoded.srcReceivers.length !== decoded.srcAmounts.length) {
    issues.push(
      issue(
        'calldata.srcReceivers',
        'SWAP_RECEIVER_MISMATCH',
        'Calldata source receivers and amounts have different lengths',
      ),
    );
  } else if (expected.nativeIn) {
    if (decoded.srcReceivers.length > 0) {
      issues.push(
        issue(
          'calldata.srcReceivers',
          'SWAP_RECEIVER_MISMATCH',
          'Native swaps must not declare ERC-20 source receivers',
        ),
      );
    } else {
      pass('calldata.srcReceivers');
    }
  } else if (decoded.srcReceivers.length === 0) {
    issues.push(
      issue(
        'calldata.srcReceivers',
        'SWAP_RECEIVER_MISMATCH',
        'ERC-20 swaps must declare the executor as the source receiver',
      ),
    );
  } else {
    const total = decoded.srcAmounts.reduce((sum, amount) => sum + BigInt(amount), 0n);

    if (total !== BigInt(expected.amountInBase)) {
      issues.push(
        issue(
          'calldata.srcReceivers',
          'SWAP_RECEIVER_MISMATCH',
          'Calldata source amounts do not sum to the input amount',
        ),
      );
    } else if (
      decoded.srcReceivers.some(
        (receiver) => !includesAddress(expected.executorAllowlist, receiver),
      )
    ) {
      issues.push(
        issue(
          'calldata.srcReceivers',
          'SWAP_RECEIVER_MISMATCH',
          'Calldata source receiver is not an allowed executor',
        ),
      );
    } else {
      pass('calldata.srcReceivers');
    }
  }

  if (decoded.feeReceivers.length > 0 || decoded.feeAmounts.length > 0) {
    issues.push(
      issue('calldata.fees', 'SWAP_FEE_NOT_ALLOWED', 'Calldata declares an unexpected fee'),
    );
  } else {
    pass('calldata.fees');
  }

  if (decoded.permit !== '0x' && decoded.permit !== '') {
    issues.push(
      issue(
        'calldata.permit',
        'SWAP_PERMIT_NOT_ALLOWED',
        'Calldata contains an unsupported permit payload',
      ),
    );
  } else {
    pass('calldata.permit');
  }

  if ((decoded.flags & 0x01n) !== 0n) {
    issues.push(
      issue(
        'calldata.partialFill',
        'SWAP_PARTIAL_FILL_NOT_ALLOWED',
        'Partial-fill swaps are not supported for exact accounting',
      ),
    );
  } else {
    pass('calldata.partialFill');
  }

  if (expected.deadline <= Math.floor(Date.now() / 1000)) {
    issues.push(
      issue('calldata.deadline', 'SWAP_DEADLINE_INVALID', 'Build deadline is already in the past'),
    );
  } else if (decoded.simpleMode && decoded.simpleDeadline === null) {
    issues.push(
      issue(
        'calldata.deadline',
        'SWAP_DEADLINE_INVALID',
        'Simple swap calldata is missing a deadline',
      ),
    );
  } else if (decoded.simpleMode && decoded.simpleDeadline! < expected.deadline) {
    issues.push(
      issue(
        'calldata.deadline',
        'SWAP_DEADLINE_INVALID',
        'Calldata deadline is earlier than the approved deadline',
      ),
    );
  } else if (decoded.simpleMode && decoded.simpleDeadline! > expected.deadline + 60) {
    issues.push(
      issue(
        'calldata.deadline',
        'SWAP_DEADLINE_INVALID',
        'Calldata deadline is later than the approved deadline window',
      ),
    );
  }

  return {
    issues,
    passedChecks,
    deadlineSource: decoded.simpleMode ? 'calldata' : 'server',
  };
}
