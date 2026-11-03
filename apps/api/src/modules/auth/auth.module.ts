import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { env } from '../../shared/config/env';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { CryptoService } from './crypto.service';
import { CsrfGuard } from './csrf.guard';
import { SessionService } from './session.service';
import { TotpService } from './totp.service';
import { TwoFactorGuard } from './two-factor.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthThrottleService,
    SessionService,
    TotpService,
    {
      provide: CryptoService,
      useFactory: () => new CryptoService(env.AUTH_ENCRYPTION_KEY),
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TwoFactorGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
  exports: [SessionService],
})
export class AuthModule {}
