import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const featureDir = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(featureDir, '../..');

function sandboxSourceFiles(): string[] {
  return readdirSync(featureDir).filter(
    (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name),
  );
}

describe('legacy AI removal', () => {
  it('removes the AI trading feature, API client and tab', () => {
    expect(existsSync(resolve(webSrc, 'features/ai-trading'))).toBe(false);
    const api = readFileSync(resolve(webSrc, 'lib/api.ts'), 'utf8');
    expect(api).not.toContain('/api/v1/ai-trading');
    const tabs = readFileSync(resolve(webSrc, 'features/portfolio/portfolio-tabs.ts'), 'utf8');
    expect(tabs).not.toContain("'ai'");
    expect(tabs).not.toContain('ИИ-торговля');
  });
});

describe('sandbox web boundary', () => {
  it('does not import the old AI or trading-bot modules', () => {
    const forbidden = [
      '@nexter/ai-trading',
      'features/ai-trading',
      'features/trading-bots',
      'features/testing',
      'trading-bots/',
    ];

    for (const file of sandboxSourceFiles()) {
      const content = readFileSync(join(featureDir, file), 'utf8');
      for (const token of forbidden) {
        expect(content, `${file} must not import ${token}`).not.toContain(token);
      }
    }
  });

  it('does not use the legacy AI tables or a manual-buy flow', () => {
    const forbidden = ['market_candles', 'ai_candidates', 'ai_profile_tokens', 'manualBuy'];
    for (const file of sandboxSourceFiles()) {
      const content = readFileSync(join(featureDir, file), 'utf8');
      for (const token of forbidden) {
        expect(content, `${file} must not reference ${token}`).not.toContain(token);
      }
    }
  });
});
