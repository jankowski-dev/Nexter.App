import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTransactionHash, trackWalletRequest } from './wallet-request';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('trackWalletRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses a wallet hash that arrives before the timeout', async () => {
    const request = deferred<string>();
    const onStalled = vi.fn();
    const tracked = trackWalletRequest(request.promise, { timeoutMs: 90_000, onStalled });

    request.resolve('0xaaa');
    await expect(tracked.outcome).resolves.toEqual({ status: 'hash', hash: '0xaaa' });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onStalled).not.toHaveBeenCalled();
  });

  it('reports a stall and accepts a manual hash', async () => {
    const request = deferred<string>();
    const onStalled = vi.fn();
    const tracked = trackWalletRequest(request.promise, { timeoutMs: 90_000, onStalled });

    await vi.advanceTimersByTimeAsync(90_000);
    expect(onStalled).toHaveBeenCalledOnce();

    tracked.submitManualHash('0xbbb');
    await expect(tracked.outcome).resolves.toEqual({ status: 'hash', hash: '0xbbb' });
  });

  it('still uses a late wallet hash after reporting a stall', async () => {
    const request = deferred<string>();
    const onStalled = vi.fn();
    const tracked = trackWalletRequest(request.promise, { timeoutMs: 90_000, onStalled });

    await vi.advanceTimersByTimeAsync(90_000);
    request.resolve('0xccc');

    await expect(tracked.outcome).resolves.toEqual({ status: 'hash', hash: '0xccc' });
  });

  it('surfaces a wallet rejection before the timeout', async () => {
    const request = deferred<string>();
    const tracked = trackWalletRequest(request.promise, { timeoutMs: 90_000, onStalled: vi.fn() });
    const error = new Error('rejected');

    request.reject(error);
    await expect(tracked.outcome).resolves.toEqual({ status: 'error', error });
  });

  it('validates a transaction hash', () => {
    expect(isTransactionHash(`0x${'a'.repeat(64)}`)).toBe(true);
    expect(isTransactionHash(` 0x${'A'.repeat(64)} `)).toBe(true);
    expect(isTransactionHash('0x123')).toBe(false);
    expect(isTransactionHash(`0x${'g'.repeat(64)}`)).toBe(false);
  });

  it('keeps waiting for a manual hash when the wallet rejects after a stall', async () => {
    const request = deferred<string>();
    const tracked = trackWalletRequest(request.promise, { timeoutMs: 90_000, onStalled: vi.fn() });

    await vi.advanceTimersByTimeAsync(90_000);
    request.reject(new Error('rejected after stall'));
    await Promise.resolve();

    tracked.submitManualHash('0xeee');
    await expect(tracked.outcome).resolves.toEqual({ status: 'hash', hash: '0xeee' });
  });

  it('ignores a late wallet rejection after a manual hash was supplied', async () => {
    const request = deferred<string>();
    const tracked = trackWalletRequest(request.promise, { timeoutMs: 90_000, onStalled: vi.fn() });

    await vi.advanceTimersByTimeAsync(90_000);
    tracked.submitManualHash('0xddd');
    request.reject(new Error('late rejection'));

    await expect(tracked.outcome).resolves.toEqual({ status: 'hash', hash: '0xddd' });
  });
});
