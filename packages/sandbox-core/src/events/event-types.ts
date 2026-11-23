export type SandboxModule =
  | 'run'
  | 'data'
  | 'clock'
  | 'regime'
  | 'strategy'
  | 'portfolio'
  | 'risk'
  | 'execution'
  | 'ledger'
  | 'manual';

export type SandboxSeverity = 'debug' | 'info' | 'warn' | 'error' | 'decision';

export interface SandboxDecision {
  action: 'buy' | 'sell' | 'hold' | 'block' | 'noop';
  sizeUsd: string | null;
  reasonCode: string;
  reasonText: string;
}

export interface SandboxAlternative {
  action: 'buy' | 'sell' | 'hold' | 'block' | 'noop';
  reasonCode: string;
  whyNot: string;
}

export interface SandboxRiskCheck {
  name: string;
  value: string;
  limit: string;
  passed: boolean;
}

export interface SandboxEventInput {
  runId: string;
  clockTime: string;
  module: SandboxModule;
  eventType: string;
  severity: SandboxSeverity;
  tokenId?: string | null;
  strategyId?: string | null;
  regime?: string | null;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
  inputs?: Record<string, unknown>;
  timing?: Record<string, unknown> | null;
  decision?: SandboxDecision | null;
  alternatives?: SandboxAlternative[];
  riskChecks?: SandboxRiskCheck[];
  dataSnapshotId: string;
  configVersion: string;
  seed: number;
  correlationId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
}

export interface SandboxEvent extends SandboxEventInput {
  seq: number;
  recordedAt: string;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);
