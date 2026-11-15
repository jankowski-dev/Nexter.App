import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type TradeChannel = 'manual' | 'onchain';

export interface TradeIntentContext {
  intentId: string;
  channel: TradeChannel;
  kind: string;
  source: string | null;
}

@Injectable()
export class TradeIntentService {
  create(input: {
    channel: TradeChannel;
    kind: string;
    source?: string | null;
    intentId?: string | null;
  }): TradeIntentContext {
    return {
      intentId: input.intentId?.trim() || randomUUID(),
      channel: input.channel,
      kind: input.kind,
      source: input.source?.trim() || null,
    };
  }

  audit(context: TradeIntentContext): {
    intentId: string;
    channel: TradeChannel;
    kind: string;
    tradeSource: string | null;
  } {
    return {
      intentId: context.intentId,
      channel: context.channel,
      kind: context.kind,
      tradeSource: context.source,
    };
  }
}
