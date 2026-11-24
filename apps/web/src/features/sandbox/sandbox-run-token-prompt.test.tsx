import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SandboxRunTokenEmptyPrompt } from './sandbox-run-drawer';

describe('sandbox run setup empty universe', () => {
  it('points the owner at the token universe UI', () => {
    const html = renderToStaticMarkup(
      <SandboxRunTokenEmptyPrompt onManageTokens={() => undefined} />,
    );
    expect(html).toContain('В песочнице пока нет токенов');
    expect(html).toContain('Добавить токены');
  });
});
