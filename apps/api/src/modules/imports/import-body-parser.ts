import type { FastifyInstance } from 'fastify';
import { parse } from 'lossless-json';

export const NOTION_IMPORT_CONTENT_TYPE = 'application/x-notion-import+json';
export const NOTION_IMPORT_BODY_LIMIT = 10 * 1024 * 1024;
export const NOTION_IMPORT_PREVIEW_PATH = '/api/v1/imports/notion/preview';

/**
 * Parse the raw Notion export without converting numeric literals to JS
 * numbers. Every number becomes its original string lexeme, so amounts and
 * rates reach the decimal parser losslessly.
 */
export function parseNotionImportBody(body: string): unknown {
  return parse(body, null, { parseNumber: (value) => value });
}

export function registerNotionImportBodyParser(fastify: FastifyInstance): void {
  fastify.addHook('preParsing', (request, reply, payload, done) => {
    const mediaType = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    const path = request.url.split('?')[0];

    if (mediaType !== NOTION_IMPORT_CONTENT_TYPE) {
      done(null, payload);
      return;
    }

    if (request.method === 'POST' && path === NOTION_IMPORT_PREVIEW_PATH) {
      // Normalize so Fastify's content-type parser lookup is case-insensitive.
      request.headers['content-type'] = NOTION_IMPORT_CONTENT_TYPE;
      done(null, payload);
      return;
    }

    void reply.code(415).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Import content type is only accepted on the import preview route',
        requestId: request.id,
      },
    });
  });

  fastify.addContentTypeParser(
    NOTION_IMPORT_CONTENT_TYPE,
    { parseAs: 'string', bodyLimit: NOTION_IMPORT_BODY_LIMIT },
    (_request, body, done) => {
      try {
        done(null, parseNotionImportBody(body as string));
      } catch (error) {
        done(error instanceof Error ? error : new Error('Invalid import JSON'), undefined);
      }
    },
  );
}
