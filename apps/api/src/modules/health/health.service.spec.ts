import { ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@nexter/db';
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service';

function createService(execute: ReturnType<typeof vi.fn>): HealthService {
  const db = { execute } as unknown as Database;
  return new HealthService(db);
}

describe('HealthService', () => {
  it('returns liveness information', () => {
    const service = createService(vi.fn());

    const health = service.liveness();

    expect(health.status).toBe('ok');
    expect(health.version).toBe('0.1.0');
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });

  it('reports readiness when the database responds', async () => {
    const service = createService(vi.fn().mockResolvedValue([]));

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ready',
      database: 'ok',
    });
  });

  it('fails readiness when the database is unavailable', async () => {
    const service = createService(vi.fn().mockRejectedValue(new Error('connection refused')));

    await expect(service.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
