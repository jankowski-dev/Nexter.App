import { LoggerModule } from 'nestjs-pino';
import { env } from '../config/env';

interface RequestLike {
  id?: string;
  method?: string;
  url?: string;
  remoteAddress?: string;
  headers?: Record<string, string | string[] | undefined>;
}

interface ResponseLike {
  statusCode?: number;
}

export function requestSerializer(request: RequestLike) {
  const url = typeof request.url === 'string' ? request.url.split('?')[0] : request.url;

  return {
    id: request.id,
    method: request.method,
    url,
    remoteAddress: request.remoteAddress,
    userAgent: request.headers?.['user-agent'],
  };
}

export function responseSerializer(response: ResponseLike) {
  return {
    statusCode: response.statusCode,
  };
}

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'req.headers["x-api-key"]',
        'req.headers["x-csrf-token"]',
        'req.headers["x-auth-token"]',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: requestSerializer,
      res: responseSerializer,
    },
    transport:
      env.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
            },
          }
        : undefined,
    autoLogging: true,
  },
});
