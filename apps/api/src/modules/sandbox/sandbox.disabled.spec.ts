import { readFileSync } from 'node:fs';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { SandboxController } from './sandbox.controller';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxReadService } from './sandbox-read.service';
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
        { provide: SandboxReadService, useValue: {} },
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

  it('guards every route except status and gates the runner behind the flag', () => {
    const controller = readFileSync(new URL('./sandbox.controller.ts', import.meta.url), 'utf8');
    const guarded = controller.match(/@UseGuards\(SandboxEnabledGuard\)/g) ?? [];
    // 23 data/read/control routes; only `GET /status` stays reachable when off.
    expect(guarded).toHaveLength(23);
    expect(controller).toContain("@Get('status')");

    const runner = readFileSync(new URL('./sandbox-runner.service.ts', import.meta.url), 'utf8');
    expect(runner).toContain("if (env.NODE_ENV === 'test' || !this.enabled) return;");
  });
});
