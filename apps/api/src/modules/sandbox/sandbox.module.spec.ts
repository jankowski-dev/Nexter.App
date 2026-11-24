import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { SandboxController } from './sandbox.controller';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxReadService } from './sandbox-read.service';
import { SandboxReplayService } from './sandbox-replay.service';
import { SandboxRunService } from './sandbox-run.service';
import { SandboxTokensService } from './sandbox-tokens.service';
import { SANDBOX_ENABLED, SANDBOX_VERSION, type SandboxStatus } from './sandbox.types';

const tokens = {
  list: async () => ({ tokens: [] }),
  create: async () => ({}),
  update: async () => ({}),
  refresh: async () => ({}),
  coverage: async () => ({ tokens: [] }),
};

async function compile(enabled: boolean) {
  return Test.createTestingModule({
    controllers: [SandboxController],
    providers: [
      { provide: SANDBOX_ENABLED, useValue: enabled },
      { provide: SandboxTokensService, useValue: tokens },
      { provide: SandboxRunService, useValue: {} },
      { provide: SandboxReadService, useValue: {} },
      { provide: SandboxReplayService, useValue: {} },
      SandboxEnabledGuard,
    ],
  }).compile();
}

describe('SandboxController', () => {
  it('boots the sandbox controller with the token service', async () => {
    const moduleRef = await compile(true);

    try {
      expect(moduleRef.get(SandboxController)).toBeInstanceOf(SandboxController);
    } finally {
      await moduleRef.close();
    }
  });

  it('reports the enabled feature flag', async () => {
    const moduleRef = await compile(true);

    try {
      const status: SandboxStatus = moduleRef.get(SandboxController).status();
      expect(status).toEqual({ enabled: true, version: SANDBOX_VERSION });
    } finally {
      await moduleRef.close();
    }
  });

  it('reports a disabled feature flag but keeps status reachable', async () => {
    const moduleRef = await compile(false);

    try {
      expect(moduleRef.get(SandboxController).status()).toEqual({
        enabled: false,
        version: SANDBOX_VERSION,
      });
    } finally {
      await moduleRef.close();
    }
  });
});

describe('SandboxEnabledGuard', () => {
  it('allows requests when the sandbox is enabled', async () => {
    const moduleRef = await compile(true);

    try {
      expect(moduleRef.get(SandboxEnabledGuard).canActivate()).toBe(true);
    } finally {
      await moduleRef.close();
    }
  });

  it('hides the data API when the sandbox is disabled', async () => {
    const moduleRef = await compile(false);

    try {
      const guard = moduleRef.get(SandboxEnabledGuard);
      expect(() => guard.canActivate()).toThrowError(NotFoundException);
      try {
        guard.canActivate();
      } catch (error) {
        expect((error as NotFoundException).getResponse()).toMatchObject({
          code: 'SANDBOX_DISABLED',
        });
      }
    } finally {
      await moduleRef.close();
    }
  });
});
