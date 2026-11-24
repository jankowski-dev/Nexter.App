import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Sandbox module with SANDBOX_ENABLED=0', () => {
  beforeAll(() => {
    process.env.SANDBOX_ENABLED = '0';
  });

  it('keeps status reachable and hides the data API', async () => {
    const { SandboxController } = await import('./sandbox.controller');
    const { SandboxEnabledGuard } = await import('./sandbox-enabled.guard');
    const { SandboxTokensService } = await import('./sandbox-tokens.service');
    const { SANDBOX_ENABLED } = await import('./sandbox.types');

    const moduleRef = await Test.createTestingModule({
      controllers: [SandboxController],
      providers: [
        { provide: SANDBOX_ENABLED, useValue: false },
        { provide: SandboxTokensService, useValue: {} },
        SandboxEnabledGuard,
      ],
    }).compile();

    try {
      expect(moduleRef.get(SandboxController).status()).toEqual({
        enabled: false,
        version: 'sandbox-stage-2',
      });
      expect(() => moduleRef.get(SandboxEnabledGuard).canActivate()).toThrowError(
        NotFoundException,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
