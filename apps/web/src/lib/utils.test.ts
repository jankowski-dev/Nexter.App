import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges conflicting Tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
  });

  it('keeps non-conflicting classes', () => {
    expect(cn('text-sm', 'font-medium')).toBe('text-sm font-medium');
  });
});
