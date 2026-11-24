import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Sandbox module with SANDBOX_ENABLED=0', () => {
  beforeAll(() => {
    process.env.SANDBOX_ENABLED = '0';
  });

  it('boots and reports the disabled state', async () => {
    const { SandboxController } = await import('./sandbox.controller');
    const { SandboxModule } = await import('./sandbox.module');
    const moduleRef = await Test.createTestingModule({ imports: [SandboxModule] }).compile();

    try {
      expect(moduleRef.get(SandboxController).status()).toEqual({
        enabled: false,
        version: 'sandbox-stage-2',
      });
    } finally {
      await moduleRef.close();
    }
  });
});
