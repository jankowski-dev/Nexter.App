import { describe, expect, it } from 'vitest';
import { parseListLine } from './note-markdown';

describe('parseListLine', () => {
  it('parses bullet and ordered lists at any indentation', () => {
    expect(parseListLine('- пункт')).toMatchObject({
      ordered: false,
      depth: 0,
      text: 'пункт',
    });
    expect(parseListLine('  - вложенный')).toMatchObject({
      ordered: false,
      depth: 1,
      text: 'вложенный',
    });
    expect(parseListLine('    1. третий уровень')).toMatchObject({
      ordered: true,
      depth: 2,
      text: 'третий уровень',
    });
  });

  it('ignores ordinary paragraphs', () => {
    expect(parseListLine('обычный текст')).toBeNull();
  });
});
