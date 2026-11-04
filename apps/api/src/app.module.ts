import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuthModule } from './modules/auth/auth.module';
import { AccountingModule } from './modules/accounting/accounting.module';
import { AuditLogModule } from './modules/audit/audit-log.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SwapModule } from './modules/swap/swap.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';
import { ApiNotFoundController } from './shared/errors/api-not-found.controller';
import { AuditModule } from './shared/audit/audit.module';
import { DbModule } from './shared/db/db.module';
import { NoStoreInterceptor } from './shared/http/no-store.interceptor';
import { loggerModule } from './shared/logging/logger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    loggerModule,
    DbModule,
    AuditModule,
    HealthModule,
    AuthModule,
    AccountingModule,
    ImportsModule,
    WatchlistModule,
    SettingsModule,
    AuditLogModule,
    SwapModule,
  ],
  controllers: [ApiNotFoundController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: NoStoreInterceptor,
    },
  ],
})
export class AppModule {}
