import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BotStrategyTemplate } from '@nexter/contracts';
import { StrategiesSettingsView } from './strategies-settings-page';

const template: BotStrategyTemplate = {
  key: 'trend_pullback',
  name: 'Трендовый откат',
  description: 'Покупает откат внутри восходящего тренда.',
  guide: 'Вход после подтверждения тренда, выход по трейлингу.',
  bestFor: 'Спокойный восходящий рынок.',
  risks: 'Ложные пробои и затяжной боковик.',
  icon: 'trend',
  kind: 'system',
  defaultParams: { fast: 20, slow: 50 },
  paramFields: [
    { key: 'fast', label: 'Быстрая SMA', hint: 'Период в часах', type: 'number' },
    { key: 'slow', label: 'Медленная SMA', hint: 'Период в часах', type: 'number' },
  ],
};

describe('StrategiesSettingsView', () => {
  it('renders the read-only catalog with guide and risks', () => {
    const html = renderToStaticMarkup(<StrategiesSettingsView templates={[template]} />);

    expect(html).toContain('Стратегии');
    expect(html).toContain('Трендовый откат');
    expect(html).toContain('Системная');
    expect(html).toContain('2 параметров');
    expect(html).not.toContain('Тестировать');
    expect(html).not.toContain('Редактировать');
  });

  it('shows an honest empty catalog without inventing strategies', () => {
    const html = renderToStaticMarkup(<StrategiesSettingsView templates={[]} />);
    expect(html).toContain('Каталог стратегий');
    expect(html).not.toContain('Трендовый откат');
  });
});
