import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { ApiNotFoundController } from './shared/errors/api-not-found.controller';
import { AuditModule } from './shared/audit/audit.module';
import { DbModule } from './shared/db/db.module';
import { loggerModule } from './shared/logging/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    loggerModule,
    DbModule,
    AuditModule,
    HealthModule,
    AuthModule,
  ],
  controllers: [ApiNotFoundController],
})
export class AppModule {}
