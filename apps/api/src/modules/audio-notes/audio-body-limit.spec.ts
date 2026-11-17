import { Controller, Module, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AUDIO_NOTES_ROUTE, registerAudioBodyLimit } from './audio-body-limit';

@Controller('bot/audio-notes')
class AudioTestController {
  @Post()
  create(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({ controllers: [AudioTestController] })
class AudioTestModule {}

function jsonPayload(bytes: number): string {
  return JSON.stringify({ audioDataUrl: 'A'.repeat(bytes) });
}

describe('registerAudioBodyLimit', () => {
  it('raises the body limit only for the audio route', async () => {
    const fastify = Fastify({ bodyLimit: 1024 * 1024 });
    registerAudioBodyLimit(fastify, async () => 8);
    fastify.post(AUDIO_NOTES_ROUTE, async () => ({ ok: true }));
    fastify.post('/api/v1/other', async () => ({ ok: true }));
    await fastify.ready();

    const audio = await fastify.inject({
      method: 'POST',
      url: AUDIO_NOTES_ROUTE,
      headers: { 'content-type': 'application/json' },
      payload: jsonPayload(1_500_000),
    });
    expect(audio.statusCode).toBe(200);

    const other = await fastify.inject({
      method: 'POST',
      url: '/api/v1/other',
      headers: { 'content-type': 'application/json' },
      payload: jsonPayload(1_500_000),
    });
    expect(other.statusCode).toBe(413);

    await fastify.close();
  });

  it('rejects an oversized Content-Length before parsing', async () => {
    const fastify = Fastify();
    registerAudioBodyLimit(fastify, async () => 1);
    fastify.post(AUDIO_NOTES_ROUTE, async () => ({ ok: true }));
    await fastify.ready();

    const response = await fastify.inject({
      method: 'POST',
      url: AUDIO_NOTES_ROUTE,
      headers: { 'content-type': 'application/json' },
      payload: jsonPayload(2_000_000),
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      error: { code: 'AUDIO_TOO_LARGE', details: { maxMb: 1 } },
    });

    await fastify.close();
  });

  it('applies to the Nest route with the global API prefix', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AudioTestModule] }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
    );
    app.setGlobalPrefix('api/v1');
    registerAudioBodyLimit(app.getHttpAdapter().getInstance(), async () => 8);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: AUDIO_NOTES_ROUTE,
        headers: { 'content-type': 'application/json' },
        payload: jsonPayload(1_500_000),
      });
    expect(response.statusCode).toBe(201);

    await app.close();
  });
});
