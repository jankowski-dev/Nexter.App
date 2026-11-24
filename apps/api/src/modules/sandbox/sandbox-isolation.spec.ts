import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  for (const candidate of [process.cwd(), resolve(process.cwd(), '../..')]) {
    try {
      readdirSync(resolve(candidate, 'apps/api/src/modules/sandbox'));
      return candidate;
    } catch {
      // Try the next location; the suite runs from the package or the repo root.
    }
  }

  throw new Error('Repository root was not found');
}

const root = repoRoot();
const sandboxDir = resolve(root, 'apps/api/src/modules/sandbox');
const sandboxSources = readdirSync(sandboxDir)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .map((file) => ({ file, source: readFileSync(resolve(sandboxDir, file), 'utf8') }));

const contractsSource = readFileSync(resolve(root, 'packages/contracts/src/sandbox.ts'), 'utf8');

describe('sandbox stage 2 isolation', () => {
  it('keeps the sandbox module free of old AI and trading-bot imports', () => {
    for (const { file, source } of sandboxSources) {
      expect(source, file).not.toMatch(/from '[^']*ai-trading/);
      expect(source, file).not.toMatch(/from '[^']*\/ai\//);
      expect(source, file).not.toMatch(/from '[^']*trading-bots/);
      expect(source, file).not.toMatch(/AiTradingModule|TradingBotsModule|AiModule/);
    }
  });

  it('never reads or writes old candle and AI tables', () => {
    for (const { file, source } of sandboxSources) {
      expect(source, file).not.toMatch(/\bmarketCandles\b/);
      expect(source, file).not.toMatch(/\bmarket_candles\b/);
      expect(source, file).not.toMatch(/\bai_[a-z_]+/);
      expect(source, file).not.toMatch(/\btrading_bots\b/);
      expect(source, file).not.toMatch(/\btradingBots\b/);
      expect(source, file).not.toMatch(/\bbot_backtest_runs\b/);
    }
  });

  it('has no wallets, keys or signing in the sandbox module', () => {
    for (const { file, source } of sandboxSources) {
      expect(source, file).not.toMatch(/privateKey|seedPhrase|mnemonic|WalletConnect|viem/);
    }
  });

  it('keeps sandbox contracts independent of old AI contracts', () => {
    expect(contractsSource).not.toMatch(/ai-trading|trading-bots|market_candles|\bai_/);
  });

  it('reuses only the HTTP market-data clients', () => {
    const dataService = sandboxSources.find((entry) => entry.file === 'sandbox-data.service.ts');
    expect(dataService).toBeDefined();

    const importPaths = [...(dataService?.source ?? '').matchAll(/from '([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(importPaths).toContain('../market-data/geckoterminal.client');
    expect(importPaths).toContain('../market-data/binance.client');
    expect(importPaths).toContain('../market-data/coingecko.client');
    expect(importPaths.every((path) => !path.includes('ai-trading'))).toBe(true);
  });
});
