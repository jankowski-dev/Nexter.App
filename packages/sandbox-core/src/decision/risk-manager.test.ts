import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './defaults';
import { Reason } from './reason-codes';
import { checkBuyRisk, checkSellRisk } from './risk-manager';
import type { RiskContext, RiskOutcome } from './risk-manager';
import type {
  PortfolioPosition,
  PortfolioSnapshot,
  RegimeFeatures,
  SandboxDecisionSettings,
  StrategyKey,
  TokenPhase,
} from './types';

const NOW = Date.UTC(2026, 0, 2, 0, 0, 0);
const HOUR_MS = 3_600_000;

const BUY_CHECK_NAMES = [
  'max_positions',
  'max_token_exposure',
  'max_strategy_exposure',
  'cash_buffer',
  'daily_loss_limit',
  'max_drawdown',
  'per_trade_risk',
  'liquidity',
  'data_stale',
  'cooldown',
  'token_blocked',
  'size_too_small',
] as const;

function position(tokenId: string, overrides: Partial<PortfolioPosition> = {}): PortfolioPosition {
  return {
    tokenId,
    strategyKey: 'trend_pullback',
    strategyVersion: 1,
    amount: '100',
    avgCostUsd: '1',
    marketPriceUsd: '1',
    marketValueUsd: '100',
    openedAt: 0,
    stopLossPct: null,
    takeProfitPct: null,
    ...overrides,
  };
}

function portfolio(
  options: {
    equity?: string;
    cash?: string;
    dayStart?: string;
    peak?: string;
    positions?: readonly PortfolioPosition[];
  } = {},
): PortfolioSnapshot {
  const equity = options.equity ?? '10000';
  return {
    equityUsd: equity,
    cashUsd: options.cash ?? '8000',
    dayStartEquityUsd: options.dayStart ?? equity,
    peakEquityUsd: options.peak ?? equity,
    positions: options.positions ?? [],
  };
}

function features(overrides: Partial<RegimeFeatures> = {}): RegimeFeatures {
  return {
    bars: 200,
    lastClose: '1',
    fastSma: '1',
    slowSma: '1',
    longSma: '1',
    atrPct: '2',
    recentHigh: '1.1',
    recentLow: '0.9',
    avgVolumeUsd: '200000',
    drawdownPct: '0',
    staleBars: 0,
    ...overrides,
  };
}

function settings(overrides: Partial<SandboxDecisionSettings> = {}): SandboxDecisionSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

function context(
  options: {
    now?: number;
    portfolio?: PortfolioSnapshot;
    settings?: SandboxDecisionSettings;
    phases?: Readonly<Record<string, TokenPhase>>;
    features?: Readonly<Record<string, RegimeFeatures>>;
    cooldowns?: Readonly<Record<string, number>>;
  } = {},
): RiskContext {
  return {
    now: options.now ?? NOW,
    portfolio: options.portfolio ?? portfolio(),
    settings: options.settings ?? settings(),
    phases: options.phases ?? { token: 'ARMED' },
    features: options.features ?? { token: features() },
    ...(options.cooldowns === undefined ? {} : { cooldowns: options.cooldowns }),
  };
}

function buy(
  overrides: Partial<{
    tokenId: string;
    strategyKey: StrategyKey;
    sizeUsd: string;
    stopLossPct: string | null;
    riskWeight: number;
    context: RiskContext;
  }> = {},
): RiskOutcome {
  return checkBuyRisk({
    tokenId: 'token',
    strategyKey: 'trend_pullback',
    sizeUsd: '100',
    stopLossPct: '3',
    riskWeight: 1,
    context: context(),
    ...overrides,
  });
}

function sell(
  overrides: Partial<{ tokenId: string; sizeUsd: string; context: RiskContext }> = {},
): RiskOutcome {
  return checkSellRisk({ tokenId: 'token', sizeUsd: '100', context: context(), ...overrides });
}

function failed(result: RiskOutcome) {
  return result.checks.filter((check) => !check.passed);
}

const IS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const IS_MONEY = /^\d+\.\d{2}$/;
const MONEY_OR_PERCENT_CHECKS: readonly string[] = [
  'max_token_exposure',
  'max_strategy_exposure',
  'cash_buffer',
  'daily_loss_limit',
  'max_drawdown',
  'per_trade_risk',
  'liquidity',
  'size_too_small',
];

describe('checkBuyRisk healthy portfolio', () => {
  it('returns all twelve checks in contract order and passes', () => {
    const result = buy();

    expect(result.checks.map((check) => check.name)).toEqual([...BUY_CHECK_NAMES]);
    expect(result.passed).toBe(true);
    expect(result.failedCode).toBeNull();
    expect(failed(result)).toEqual([]);
  });

  it('reports exact decimal values and limits for every check', () => {
    const result = buy();

    expect(result.checks).toEqual([
      { name: 'max_positions', value: '0', limit: '5', passed: true },
      { name: 'max_token_exposure', value: '1.00', limit: '20.00', passed: true },
      { name: 'max_strategy_exposure', value: '1.00', limit: '40.00', passed: true },
      { name: 'cash_buffer', value: '7900.00', limit: '1000.00', passed: true },
      { name: 'daily_loss_limit', value: '0.00', limit: '2.00', passed: true },
      { name: 'max_drawdown', value: '0.00', limit: '15.00', passed: true },
      { name: 'per_trade_risk', value: '3.00', limit: '100.00', passed: true },
      { name: 'liquidity', value: '100.00', limit: '2000.00', passed: true },
      { name: 'data_stale', value: '0', limit: '0', passed: true },
      { name: 'cooldown', value: 'none', limit: new Date(NOW).toISOString(), passed: true },
      { name: 'token_blocked', value: 'ARMED', limit: 'not_blocked', passed: true },
      { name: 'size_too_small', value: '100.00', limit: '10.00', passed: true },
    ]);
  });

  it('formats money and percentage values as two-decimal strings', () => {
    const result = buy();

    for (const check of result.checks) {
      if (!MONEY_OR_PERCENT_CHECKS.includes(check.name)) continue;
      expect(check.value, check.name).toMatch(IS_MONEY);
      expect(check.limit, check.name).toMatch(IS_MONEY);
    }
    expect(result.checks.find((check) => check.name === 'cooldown')?.limit).toMatch(IS_ISO);
  });

  it('falls back to defaultStopPct when the stop is missing', () => {
    const result = buy({ stopLossPct: null });

    expect(result.checks.find((check) => check.name === 'per_trade_risk')).toEqual({
      name: 'per_trade_risk',
      value: '3.00',
      limit: '100.00',
      passed: true,
    });
  });
});

describe('checkBuyRisk individual vetoes', () => {
  it('vetoes max_positions at the position limit', () => {
    const result = buy({
      context: context({
        portfolio: portfolio({
          positions: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => position(id)),
        }),
      }),
    });

    expect(failed(result)).toEqual([
      { name: 'max_positions', value: '5', limit: '5', passed: false },
    ]);
    expect(result.failedCode).toBe(Reason.RISK_MAX_POSITIONS);
    expect(result.passed).toBe(false);
  });

  it('allows one position below the position limit', () => {
    const result = buy({
      context: context({
        portfolio: portfolio({
          positions: ['p1', 'p2', 'p3', 'p4'].map((id) => position(id)),
        }),
      }),
    });

    expect(result.passed).toBe(true);
  });

  it('vetoes max_token_exposure above the cap and passes at equality', () => {
    const above = buy({
      context: context({
        portfolio: portfolio({ positions: [position('token', { marketValueUsd: '2000' })] }),
      }),
    });
    const atCap = buy({
      context: context({
        portfolio: portfolio({ positions: [position('token', { marketValueUsd: '1900' })] }),
      }),
    });

    expect(failed(above)).toEqual([
      { name: 'max_token_exposure', value: '21.00', limit: '20.00', passed: false },
    ]);
    expect(above.failedCode).toBe(Reason.RISK_TOKEN_EXPOSURE);
    expect(atCap.passed).toBe(true);
  });

  it('vetoes max_strategy_exposure above the cap and passes at equality', () => {
    const above = buy({
      context: context({
        portfolio: portfolio({
          positions: [position('other', { strategyKey: 'trend_pullback', marketValueUsd: '4000' })],
        }),
      }),
    });
    const atCap = buy({
      context: context({
        portfolio: portfolio({
          positions: [position('other', { strategyKey: 'trend_pullback', marketValueUsd: '3900' })],
        }),
      }),
    });

    expect(failed(above)).toEqual([
      { name: 'max_strategy_exposure', value: '41.00', limit: '40.00', passed: false },
    ]);
    expect(above.failedCode).toBe(Reason.RISK_STRATEGY_EXPOSURE);
    expect(atCap.passed).toBe(true);
  });

  it('vetoes cash_buffer when the size eats into the buffer and passes at equality', () => {
    const below = buy({ context: context({ portfolio: portfolio({ cash: '1050' }) }) });
    const atBuffer = buy({ context: context({ portfolio: portfolio({ cash: '1100' }) }) });

    expect(failed(below)).toEqual([
      { name: 'cash_buffer', value: '950.00', limit: '1000.00', passed: false },
    ]);
    expect(below.failedCode).toBe(Reason.RISK_CASH_BUFFER);
    expect(atBuffer.passed).toBe(true);
  });

  it('blocks daily loss at the limit and passes strictly below it', () => {
    const atLimit = buy({
      context: context({
        portfolio: portfolio({ equity: '9800', dayStart: '10000', peak: '9800' }),
      }),
    });
    const below = buy({
      context: context({
        portfolio: portfolio({ equity: '9801', dayStart: '10000', peak: '9801' }),
      }),
    });

    expect(failed(atLimit)).toEqual([
      { name: 'daily_loss_limit', value: '2.00', limit: '2.00', passed: false },
    ]);
    expect(atLimit.failedCode).toBe(Reason.RISK_DAILY_LOSS);
    expect(below.passed).toBe(true);
  });

  it('blocks drawdown at the limit and passes strictly below it', () => {
    const atLimit = buy({
      context: context({
        portfolio: portfolio({ equity: '8500', dayStart: '8500', peak: '10000' }),
      }),
    });
    const below = buy({
      context: context({
        portfolio: portfolio({ equity: '8600', dayStart: '8600', peak: '10000' }),
      }),
    });

    expect(failed(atLimit)).toEqual([
      { name: 'max_drawdown', value: '15.00', limit: '15.00', passed: false },
    ]);
    expect(atLimit.failedCode).toBe(Reason.RISK_MAX_DRAWDOWN);
    expect(below.passed).toBe(true);
  });

  it('vetoes per_trade_risk above the weighted budget and passes at equality', () => {
    const above = buy({
      stopLossPct: '20',
      context: context({ settings: settings({ perTradeRiskPct: 0.1 }) }),
    });
    const atBudget = buy({
      stopLossPct: '10',
      context: context({ settings: settings({ perTradeRiskPct: 0.1 }) }),
    });

    expect(failed(above)).toEqual([
      { name: 'per_trade_risk', value: '20.00', limit: '10.00', passed: false },
    ]);
    expect(above.failedCode).toBe(Reason.RISK_PER_TRADE);
    expect(atBudget.passed).toBe(true);
  });

  it('scales the per-trade budget by the risk weight', () => {
    const result = buy({
      sizeUsd: '100',
      stopLossPct: '20',
      riskWeight: 0.5,
      context: context({ settings: settings({ perTradeRiskPct: 0.1 }) }),
    });

    expect(result.checks.find((check) => check.name === 'per_trade_risk')).toEqual({
      name: 'per_trade_risk',
      value: '20.00',
      limit: '5.00',
      passed: false,
    });
    expect(result.failedCode).toBe(Reason.RISK_PER_TRADE);
  });

  it('vetoes liquidity above the volume cap and passes at equality', () => {
    const above = buy({
      context: context({ features: { token: features({ avgVolumeUsd: '1000' }) } }),
    });
    const atCap = buy({
      context: context({ features: { token: features({ avgVolumeUsd: '10000' }) } }),
    });

    expect(failed(above)).toEqual([
      { name: 'liquidity', value: '100.00', limit: '10.00', passed: false },
    ]);
    expect(above.failedCode).toBe(Reason.RISK_LIQUIDITY);
    expect(atCap.passed).toBe(true);
  });

  it('treats a missing volume as a zero liquidity cap', () => {
    const result = buy({
      context: context({ features: { token: features({ avgVolumeUsd: null }) } }),
    });

    expect(result.checks.find((check) => check.name === 'liquidity')).toEqual({
      name: 'liquidity',
      value: '100.00',
      limit: '0.00',
      passed: false,
    });
    expect(result.failedCode).toBe(Reason.RISK_LIQUIDITY);
  });

  it('vetoes data_stale when the token has stale bars', () => {
    const result = buy({ context: context({ features: { token: features({ staleBars: 1 }) } }) });

    expect(failed(result)).toEqual([{ name: 'data_stale', value: '1', limit: '0', passed: false }]);
    expect(result.failedCode).toBe(Reason.RISK_DATA_STALE);
  });

  it('treats missing features as stale with the 999999 sentinel', () => {
    const result = buy({ context: context({ features: {} }) });

    expect(result.checks.find((check) => check.name === 'data_stale')).toEqual({
      name: 'data_stale',
      value: '999999',
      limit: '0',
      passed: false,
    });
    // A missing feature set also has no volume, so liquidity fails first in
    // table order and becomes the reported veto.
    expect(result.failedCode).toBe(Reason.RISK_LIQUIDITY);
  });

  it('vetoes an active cooldown with ISO values', () => {
    const until = NOW + HOUR_MS;
    const result = buy({ context: context({ cooldowns: { token: until } }) });
    const check = result.checks.find((entry) => entry.name === 'cooldown');

    expect(check).toEqual({
      name: 'cooldown',
      value: new Date(until).toISOString(),
      limit: new Date(NOW).toISOString(),
      passed: false,
    });
    expect(check?.value).toMatch(IS_ISO);
    expect(result.failedCode).toBe(Reason.RISK_COOLDOWN);
  });

  it('vetoes a token whose phase is COOLDOWN without a deadline', () => {
    const result = buy({ context: context({ phases: { token: 'COOLDOWN' } }) });

    expect(result.checks.find((check) => check.name === 'cooldown')).toEqual({
      name: 'cooldown',
      value: 'cooldown',
      limit: new Date(NOW).toISOString(),
      passed: false,
    });
    expect(result.failedCode).toBe(Reason.RISK_COOLDOWN);
  });

  it('passes a cooldown that ended at or before now', () => {
    const atNow = buy({ context: context({ cooldowns: { token: NOW } }) });
    const past = buy({ context: context({ cooldowns: { token: NOW - HOUR_MS } }) });

    expect(atNow.passed).toBe(true);
    expect(past.checks.find((check) => check.name === 'cooldown')).toEqual({
      name: 'cooldown',
      value: new Date(NOW - HOUR_MS).toISOString(),
      limit: new Date(NOW).toISOString(),
      passed: true,
    });
  });

  it('vetoes a BLOCKED token phase', () => {
    const result = buy({ context: context({ phases: { token: 'BLOCKED' } }) });

    expect(failed(result)).toEqual([
      { name: 'token_blocked', value: 'BLOCKED', limit: 'not_blocked', passed: false },
    ]);
    expect(result.failedCode).toBe(Reason.RISK_TOKEN_BLOCKED);
  });

  it('treats a token absent from the phase map as not blocked', () => {
    const result = buy({ context: context({ phases: {} }) });

    expect(result.checks.find((check) => check.name === 'token_blocked')).toEqual({
      name: 'token_blocked',
      value: 'UNKNOWN',
      limit: 'not_blocked',
      passed: true,
    });
    expect(result.passed).toBe(true);
  });

  it('vetoes a size below the minimum order and passes at equality', () => {
    const below = buy({ sizeUsd: '5' });
    const atMin = buy({ sizeUsd: '10' });

    expect(failed(below)).toEqual([
      { name: 'size_too_small', value: '5.00', limit: '10.00', passed: false },
    ]);
    expect(below.failedCode).toBe(Reason.RISK_SIZE_TOO_SMALL);
    expect(atMin.passed).toBe(true);
  });

  it('keeps all twelve checks when an early check fails', () => {
    const result = buy({
      context: context({
        phases: { token: 'BLOCKED' },
        cooldowns: { token: NOW + HOUR_MS },
        features: { token: features({ staleBars: 3 }) },
        portfolio: portfolio({
          positions: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => position(id)),
        }),
      }),
    });

    expect(result.checks).toHaveLength(12);
    expect(result.checks.map((check) => check.name)).toEqual([...BUY_CHECK_NAMES]);
    expect(result.failedCode).toBe(Reason.RISK_MAX_POSITIONS);
  });

  it('reports the first failing check in table order', () => {
    const result = buy({
      sizeUsd: '5',
      context: context({
        phases: { token: 'BLOCKED' },
        features: { token: features({ staleBars: 1 }) },
        portfolio: portfolio({ cash: '1004' }),
      }),
    });

    // cash_buffer (4th) fails before data_stale, cooldown, token_blocked and
    // size_too_small, so it owns failedCode.
    expect(result.failedCode).toBe(Reason.RISK_CASH_BUFFER);
  });

  it('does not mutate the risk context or the portfolio', () => {
    const snapshot = context({
      phases: { token: 'BLOCKED' },
      cooldowns: { token: NOW + HOUR_MS },
      portfolio: portfolio({ positions: [position('token')] }),
    });
    const before = JSON.parse(JSON.stringify(snapshot)) as RiskContext;

    buy({ context: snapshot });

    expect(snapshot).toEqual(before);
    expect(snapshot.portfolio.positions).toHaveLength(1);
  });
});

describe('checkSellRisk', () => {
  it('returns exactly the stale and liquidity checks and passes', () => {
    const result = sell();

    expect(result.checks).toEqual([
      { name: 'data_stale', value: '0', limit: '0', passed: true },
      { name: 'liquidity', value: '100.00', limit: '2000.00', passed: true },
    ]);
    expect(result.passed).toBe(true);
    expect(result.failedCode).toBeNull();
  });

  it('never blocks a sell on daily loss, drawdown, cooldown or a blocked phase', () => {
    const result = sell({
      context: context({
        portfolio: portfolio({ equity: '8000', cash: '0', dayStart: '10000', peak: '12000' }),
        phases: { token: 'BLOCKED' },
        cooldowns: { token: NOW + HOUR_MS },
      }),
    });

    expect(result.checks.map((check) => check.name)).toEqual(['data_stale', 'liquidity']);
    expect(result.passed).toBe(true);
    expect(result.failedCode).toBeNull();
  });

  it('never blocks a sell on a portfolio exactly at each loss limit', () => {
    const atDailyLoss = sell({
      context: context({
        portfolio: portfolio({ equity: '9800', dayStart: '10000', peak: '9800' }),
      }),
    });
    const atDrawdown = sell({
      context: context({
        portfolio: portfolio({ equity: '8500', dayStart: '8500', peak: '10000' }),
      }),
    });

    expect(atDailyLoss.passed).toBe(true);
    expect(atDrawdown.passed).toBe(true);
  });

  it('still checks stale data on a sell', () => {
    const result = sell({
      tokenId: 'token',
      context: context({ features: { token: features({ staleBars: 2 }) } }),
    });

    expect(result.checks).toEqual([
      { name: 'data_stale', value: '2', limit: '0', passed: false },
      { name: 'liquidity', value: '100.00', limit: '2000.00', passed: true },
    ]);
    expect(result.failedCode).toBe(Reason.RISK_DATA_STALE);
  });

  it('still checks liquidity on a sell', () => {
    const result = sell({
      context: context({ features: { token: features({ avgVolumeUsd: '1000' }) } }),
    });

    expect(result.checks).toEqual([
      { name: 'data_stale', value: '0', limit: '0', passed: true },
      { name: 'liquidity', value: '100.00', limit: '10.00', passed: false },
    ]);
    expect(result.failedCode).toBe(Reason.RISK_LIQUIDITY);
  });

  it('treats missing features as stale on a sell', () => {
    const result = sell({ context: context({ features: {} }) });

    expect(result.checks[0]).toEqual({
      name: 'data_stale',
      value: '999999',
      limit: '0',
      passed: false,
    });
    expect(result.failedCode).toBe(Reason.RISK_DATA_STALE);
  });
});
