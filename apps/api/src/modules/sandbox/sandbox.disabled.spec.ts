import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { SandboxController } from './sandbox.controller';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxReadService } from './sandbox-read.service';
import { SandboxReplayReportService } from './sandbox-replay-report.service';
import { SandboxReplayService } from './sandbox-replay.service';
import { SandboxRunService } from './sandbox-run.service';
import { SandboxTokensService } from './sandbox-tokens.service';
import { SANDBOX_ENABLED } from './sandbox.types';

function sandboxSource(file: string): string {
  for (const candidate of [
    resolve(process.cwd(), 'src/modules/sandbox', file),
    resolve(process.cwd(), 'apps/api/src/modules/sandbox', file),
  ]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }

  throw new Error(`Sandbox source ${file} was not found`);
}

describe('Sandbox module with SANDBOX_ENABLED=0', () => {
  it('keeps status reachable and hides the data API', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SandboxController],
      providers: [
        { provide: SANDBOX_ENABLED, useValue: false },
        { provide: SandboxTokensService, useValue: {} },
        { provide: SandboxRunService, useValue: {} },
        { provide: SandboxReadService, useValue: {} },
        { provide: SandboxReplayService, useValue: {} },
        { provide: SandboxReplayReportService, useValue: {} },
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
    const controller = sandboxSource('sandbox.controller.ts');
    const guarded = controller.match(/@UseGuards\(SandboxEnabledGuard\)/g) ?? [];
    // 31 data/read/replay control routes; only `GET /status` stays reachable when off.
    expect(guarded).toHaveLength(31);
    expect(controller).toContain("@Get('status')");

    const runner = sandboxSource('sandbox-runner.service.ts');
    expect(runner).toContain("if (env.NODE_ENV === 'test' || !this.enabled) return;");
  });
});
