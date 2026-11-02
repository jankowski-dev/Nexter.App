import { describe, expect, it } from 'vitest';
import { createDb } from './client';

describe('createDb', () => {
  it('registers a pool error listener', async () => {
    const errors: Error[] = [];
    const { pool } = createDb('postgres://postgres:postgres@127.0.0.1:1/nexter', {
      onPoolError: (error) => errors.push(error),
    });

    expect(pool.listenerCount('error')).toBe(1);

    pool.emit('error', new Error('simulated idle client error'));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('simulated idle client error');

    await pool.end();
  });
});
