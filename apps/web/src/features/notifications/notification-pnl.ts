const CLOSED_TRADE_TYPES = new Set(['trade_closed', 'bot_trade_closed', 'bot_positions_closed']);

/** Returns the signed P&L string only for a closed-trade notification. */
export function closedTradePnl(type: string, payload: Record<string, unknown>): string | null {
  if (!CLOSED_TRADE_TYPES.has(type)) return null;
  const value = payload.realizedPnlUsd;
  return typeof value === 'string' && value !== '' ? value : null;
}
