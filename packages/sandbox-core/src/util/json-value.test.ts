import { describe, expect, it } from 'vitest';
import { assertJsonValue, NonJsonValueError } from './json-value';

class PlainClass {
  readonly value = 1;
}

describe('assertJsonValue', () => {
  it('accepts a nested plain object with JSON-compatible values', () => {
    expect(() =>
      assertJsonValue({
        token: 'btc',
        count: 2,
        ratio: -0.5,
        enabled: true,
        missing: null,
        optional: undefined,
        nested: { list: [1, 'two', { deep: null }] },
        nullProto: Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 }),
      }),
    ).not.toThrow();
  });

  it('treats undefined as an allowed value that normalizes to null', () => {
    expect(() => assertJsonValue(undefined)).not.toThrow();
    expect(() => assertJsonValue({ a: undefined })).not.toThrow();
    expect(() => assertJsonValue([undefined])).not.toThrow();
  });

  it('rejects non-finite numbers', () => {
    expect(() => assertJsonValue({ a: Number.NaN })).toThrow(NonJsonValueError);
    expect(() => assertJsonValue([Number.POSITIVE_INFINITY])).toThrow(NonJsonValueError);
    expect(() => assertJsonValue(Number.NEGATIVE_INFINITY)).toThrow(NonJsonValueError);
  });

  it('rejects Date, Map, Set and class instances', () => {
    expect(() => assertJsonValue({ when: new Date() })).toThrow(NonJsonValueError);
    expect(() => assertJsonValue({ map: new Map() })).toThrow(NonJsonValueError);
    expect(() => assertJsonValue({ set: new Set() })).toThrow(NonJsonValueError);
    expect(() => assertJsonValue({ instance: new PlainClass() })).toThrow(NonJsonValueError);
  });

  it('rejects functions, symbols and bigints', () => {
    expect(() => assertJsonValue({ fn: () => 1 })).toThrow(NonJsonValueError);
    expect(() => assertJsonValue({ symbol: Symbol('x') })).toThrow(NonJsonValueError);
    expect(() => assertJsonValue({ big: 1n })).toThrow(NonJsonValueError);
  });

  it('rejects sparse array holes', () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = 1;

    expect(() => assertJsonValue(sparse)).toThrow(NonJsonValueError);
    expect(() => assertJsonValue(sparse)).toThrow(/sparse array hole/);
    expect(() => assertJsonValue([1, 2])).not.toThrow();
  });

  it('reports a nested sparse array by path', () => {
    const nested: unknown[] = [1];
    nested.length = 3;
    nested[2] = 3;

    expect(() => assertJsonValue({ a: nested })).toThrow(/\$\.a\[1\]: sparse array hole/);
  });

  it('rejects circular references', () => {
    const circular: Record<string, unknown> = { id: 'a' };
    circular.self = circular;
    expect(() => assertJsonValue(circular)).toThrow(/circular/);

    const list: unknown[] = [];
    list.push(list);
    expect(() => assertJsonValue({ list })).toThrow(/circular/);
  });

  it('allows shared but acyclic references', () => {
    const shared = { id: 'shared' };
    expect(() => assertJsonValue({ left: shared, right: shared })).not.toThrow();
  });

  it('reports the offending path', () => {
    expect(() => assertJsonValue({ a: [{ when: new Date() }] })).toThrow(/\$\.a\[0\]\.when/);
  });
});
