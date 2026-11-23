import { z } from 'zod';
import type { SandboxEventInput } from './event-types';

const isoDate = z.iso.datetime();
const action = z.enum(['buy', 'sell', 'hold', 'block', 'noop']);

const decisionSchema = z.object({
  action,
  sizeUsd: z.string().nullable(),
  reasonCode: z.string().min(1),
  reasonText: z.string().min(1),
});

const alternativeSchema = z.object({
  action,
  reasonCode: z.string().min(1),
  whyNot: z.string().min(1),
});

const riskCheckSchema = z.object({
  name: z.string().min(1),
  value: z.string().min(1),
  limit: z.string().min(1),
  passed: z.boolean(),
});

export const sandboxEventInputSchema = z
  .object({
    runId: z.string().min(1),
    clockTime: isoDate,
    module: z.enum([
      'run',
      'data',
      'clock',
      'regime',
      'strategy',
      'portfolio',
      'risk',
      'execution',
      'ledger',
      'manual',
    ]),
    eventType: z.string().min(1),
    severity: z.enum(['debug', 'info', 'warn', 'error', 'decision']),
    tokenId: z.string().nullable().optional(),
    strategyId: z.string().nullable().optional(),
    regime: z.string().nullable().optional(),
    stateBefore: z.record(z.string(), z.unknown()).nullable().optional(),
    stateAfter: z.record(z.string(), z.unknown()).nullable().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    timing: z.record(z.string(), z.unknown()).nullable().optional(),
    decision: decisionSchema.nullable().optional(),
    alternatives: z.array(alternativeSchema).optional(),
    riskChecks: z.array(riskCheckSchema).optional(),
    dataSnapshotId: z.string().min(1),
    configVersion: z.string().min(1),
    seed: z.number().int(),
    correlationId: z.string().nullable().optional(),
    reasonCode: z.string().nullable().optional(),
    reasonText: z.string().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const needsReason =
      value.decision !== null && value.decision !== undefined
        ? true
        : /^(signal|order|position|strategy|risk)\./.test(value.eventType) ||
          value.eventType === 'run.failed';
    if (needsReason && !value.reasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reasonCode'],
        message: 'reasonCode is required for decision, rejection and failure events',
      });
    }
  }) satisfies z.ZodType<SandboxEventInput>;
