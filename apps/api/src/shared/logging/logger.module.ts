import { LoggerModule } from 'nestjs-pino';
import { env } from '../config/env';

export const loggerModule = LoggerModule.forRoot({
  pinoHttp: {
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
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
