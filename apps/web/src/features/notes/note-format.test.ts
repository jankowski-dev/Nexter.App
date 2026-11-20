import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from './note-format';

describe('htmlToMarkdown', () => {
  it('keeps inline formatting and paragraphs', () => {
    const result = htmlToMarkdown(
      '<div>Привет, <strong>мир</strong> и <em>все</em>.</div><div>Второй абзац.</div>',
    );
    expect(result).toContain('Привет, **мир** и *все*.');
    expect(result).toContain('Второй абзац.');
  });

  it('converts unordered and ordered lists', () => {
    expect(htmlToMarkdown('<ul><li>Один</li><li><strong>Два</strong></li></ul>')).toBe(
      '- Один\n- **Два**',
    );
    expect(htmlToMarkdown('<ol><li>Первый</li><li>Второй</li></ol>')).toBe('1. Первый\n2. Второй');
  });

  it('converts links, headings, quotes and entities', () => {
    const result = htmlToMarkdown(
      '<h2>Заголовок</h2><blockquote>Цитата&nbsp;текста</blockquote><a href="https://example.com">Ссылка</a>',
    );
    expect(result).toContain('## Заголовок');
    expect(result).toContain('> Цитата текста');
    expect(result).toContain('[Ссылка](https://example.com)');
  });

  it('drops scripts and styles', () => {
    const result = htmlToMarkdown(
      '<style>.x{color:red}</style><script>alert(1)</script><p>Текст</p>',
    );
    expect(result).toBe('Текст');
  });
});
