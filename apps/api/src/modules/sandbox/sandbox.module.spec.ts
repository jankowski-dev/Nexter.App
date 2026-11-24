import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { SandboxController } from './sandbox.controller';
import { SandboxModule } from './sandbox.module';
import {
  SANDBOX_ENABLED,
  SANDBOX_EVENT_GENESIS_HASH,
  SANDBOX_VERSION,
  type SandboxStatus,
} from './sandbox.types';

describe('SandboxModule', () => {
  it('boots with the @nexter/sandbox-core dependency', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SandboxModule] }).compile();

    try {
      expect(moduleRef.get(SandboxController)).toBeInstanceOf(SandboxController);
      expect(SANDBOX_EVENT_GENESIS_HASH).toBe('0'.repeat(64));
    } finally {
      await moduleRef.close();
    }
  });

  it('reports the enabled feature flag', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SandboxController],
      providers: [{ provide: SANDBOX_ENABLED, useValue: true }],
    }).compile();

    try {
      const status: SandboxStatus = moduleRef.get(SandboxController).status();
      expect(status).toEqual({ enabled: true, version: SANDBOX_VERSION });
    } finally {
      await moduleRef.close();
    }
  });

  it('reports a disabled feature flag', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SandboxController],
      providers: [{ provide: SANDBOX_ENABLED, useValue: false }],
    }).compile();

    try {
      const status: SandboxStatus = moduleRef.get(SandboxController).status();
      expect(status).toEqual({ enabled: false, version: SANDBOX_VERSION });
    } finally {
      await moduleRef.close();
    }
  });
});
