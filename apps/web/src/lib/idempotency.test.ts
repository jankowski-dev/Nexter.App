import { describe, expect, it } from 'vitest';
import { idempotencyForPayload } from './idempotency';

describe('idempotencyForPayload', () => {
  it('keeps the key for retrying the same payload', () => {
    const result = idempotencyForPayload('key-1', 'payload-a', 'payload-a');
    expect(result).toEqual({ key: 'key-1', signature: 'payload-a' });
  });

  it('keeps the key on the first submission', () => {
    const result = idempotencyForPayload('key-1', null, 'payload-a');
    expect(result).toEqual({ key: 'key-1', signature: 'payload-a' });
  });

  it('rotates the key when the payload changes', () => {
    const result = idempotencyForPayload('key-1', 'payload-a', 'payload-b', () => 'key-2');
    expect(result).toEqual({ key: 'key-2', signature: 'payload-b' });
  });
});
