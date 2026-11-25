import { NotFoundException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { SandboxController } from './sandbox.controller';
import { SandboxEnabledGuard } from './sandbox-enabled.guard';
import { SandboxReadService } from './sandbox-read.service';
import { SandboxReplayChartService } from './sandbox-replay-chart.service';
import { SandboxReplayPdfService } from './sandbox-replay-pdf.service';
import { SandboxReplayReportService } from './sandbox-replay-report.service';
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

let uuidSeq = 0;
function uuid(): string {
  uuidSeq += 1;
  return `11111111-1111-4111-8111-${String(uuidSeq).padStart(12, '0')}`;
}

async function compile(enabled: boolean) {
  return Test.createTestingModule({
    controllers: [SandboxController],
    providers: [
      { provide: SANDBOX_ENABLED, useValue: enabled },
      { provide: SandboxTokensService, useValue: tokens },
      { provide: SandboxRunService, useValue: {} },
      { provide: SandboxReadService, useValue: {} },
      { provide: SandboxReplayService, useValue: {} },
      { provide: SandboxReplayReportService, useValue: {} },
      { provide: SandboxReplayPdfService, useValue: {} },
      { provide: SandboxReplayChartService, useValue: {} },
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

  it('serves the live Markdown report route no-store without a static content type', () => {
    const headersOf = (method: keyof SandboxController) =>
      (Reflect.getMetadata(HEADERS_METADATA, SandboxController.prototype[method]) ?? []) as Array<{
        name: string;
        value: string;
      }>;

    expect(headersOf('reportMarkdown')).toContainEqual({
      name: 'Cache-Control',
      value: 'no-store',
    });
    expect(headersOf('reportMarkdown').some((header) => header.name === 'Content-Type')).toBe(
      false,
    );
  });

  it('sets the live Markdown content type only after a successful report read', async () => {
    const read = { reportMarkdown: vi.fn(async () => '# Live paper run report\n') };
    const controller = new SandboxController(
      true,
      {} as never,
      {} as never,
      read as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const auth = { user: { id: '22222222-2222-4222-8222-222222222222' } } as never;
    const liveReply = { header: vi.fn() };

    await expect(controller.reportMarkdown(auth, uuid(), liveReply as never)).resolves.toContain(
      '# Live paper run report',
    );
    expect(liveReply.header).toHaveBeenCalledWith('Content-Type', 'text/markdown; charset=utf-8');
  });

  it('keeps the JSON error path on the live Markdown route when the read fails', async () => {
    const runMissing = new NotFoundException({
      code: 'SANDBOX_RUN_NOT_FOUND',
      message: 'Sandbox run not found',
    });
    const read = {
      reportMarkdown: vi.fn(async () => {
        throw runMissing;
      }),
    };
    const controller = new SandboxController(
      true,
      {} as never,
      {} as never,
      read as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const auth = { user: { id: '22222222-2222-4222-8222-222222222222' } } as never;
    const liveReply = { header: vi.fn() };

    await expect(controller.reportMarkdown(auth, uuid(), liveReply as never)).rejects.toBe(
      runMissing,
    );
    expect(liveReply.header).not.toHaveBeenCalled();
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
