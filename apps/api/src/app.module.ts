import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { HealthModule } from './modules/health/health.module';
import { DbModule } from './shared/db/db.module';
import { loggerModule } from './shared/logging/logger.module';

const webDistPath = process.env.WEB_DIST_PATH ?? join(__dirname, '..', 'public');
const hasWebBuild = existsSync(join(webDistPath, 'index.html'));

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    loggerModule,
    DbModule,
    HealthModule,
    ...(hasWebBuild
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDistPath,
            exclude: ['/api/{*path}', '/health', '/ready'],
          }),
        ]
      : []),
  ],
})
export class AppModule {}
