import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { ApiNotFoundController } from './shared/errors/api-not-found.controller';
import { DbModule } from './shared/db/db.module';
import { loggerModule } from './shared/logging/logger.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), loggerModule, DbModule, HealthModule],
  controllers: [ApiNotFoundController],
})
export class AppModule {}
