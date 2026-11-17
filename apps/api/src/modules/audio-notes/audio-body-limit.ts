import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AUDIO_HARD_MAX_REQUEST_BYTES, audioRequestBodyMaxBytes } from '@nexter/contracts';

export const AUDIO_NOTES_ROUTE = '/api/v1/bot/audio-notes';

/**
 * The default Fastify/Nest body limit (4 MB in production) and the test
 * adapter default (1 MB) are too small for base64 audio. Fastify exposes a
 * per-route `bodyLimit`, so only this endpoint is raised to the bounded hard
 * cap for the maximum configurable 20 MB binary payload. Other routes keep the
 * global limit.
 */
export function registerAudioBodyLimit(
  fastify: FastifyInstance,
  getAudioMaxMb: () => Promise<number>,
): void {
  fastify.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url.replace(/\/+$/, '') !== AUDIO_NOTES_ROUTE) return;

    routeOptions.bodyLimit = AUDIO_HARD_MAX_REQUEST_BYTES;

    const onRequest = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const rawLength = request.headers['content-length'];
      if (!rawLength) return;

      const contentLength = Number(rawLength);
      if (!Number.isFinite(contentLength) || contentLength <= 0) return;

      const maxMb = await getAudioMaxMb();
      if (contentLength <= audioRequestBodyMaxBytes(maxMb)) return;

      await reply.code(413).send({
        error: {
          code: 'AUDIO_TOO_LARGE',
          message: `Аудио больше допустимого размера: ${maxMb} МБ`,
          details: { maxMb, maxBytes: maxMb * 1024 * 1024 },
          requestId: request.id,
        },
      });
    };

    const existing = routeOptions.onRequest;
    routeOptions.onRequest = [
      ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      onRequest,
    ];
  });
}
