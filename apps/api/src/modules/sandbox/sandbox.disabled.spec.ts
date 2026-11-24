import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { SandboxController } from './sandbox.controller';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxRunService } from './sandbox-run.service';
import { SandboxTokensService } from './sandbox-tokens.service';
import { SANDBOX_ENABLED } from './sandbox.types';

describe('Sandbox module with SANDBOX_ENABLED=0', () => {
  it('keeps status reachable and hides the data API', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SandboxController],
      providers: [
        { provide: SANDBOX_ENABLED, useValue: false },
        { provide: SandboxTokensService, useValue: {} },
        { provide: SandboxRunService, useValue: {} },
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
