import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type {
  AuthMeResponse,
  AuthStatusResponse,
  ChangePasswordRequest,
  CsrfTokenResponse,
  LoginRequest,
  LoginResponse,
  RecoveryCodeRequest,
  RecoveryCodesResponse,
  RegenerateRecoveryCodesRequest,
  ResetPasswordRequest,
  SessionsResponse,
  SetupRequest,
  SetupResponse,
  TotpCodeRequest,
  TwoFactorSetupResponse,
  TwoFactorVerifyResponse,
} from '@nexter/contracts';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  recoveryCodeSchema,
  regenerateRecoveryCodesRequestSchema,
  resetPasswordRequestSchema,
  setupRequestSchema,
  totpCodeSchema,
} from '@nexter/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { NoStoreInterceptor } from '../../shared/http/no-store.interceptor';
import { ZodValidationPipe } from '../../shared/validation/zod-validation.pipe';
import { clearAuthCookies, setAuthCookies } from './auth.cookies';
import { CSRF_COOKIE } from './auth.constants';
import { CurrentAuth } from './current-auth.decorator';
import { AllowPending2fa, Public } from './public.decorator';
import type { AuthContext } from './auth.types';
import { AuthService } from './auth.service';

@ApiTags('auth')
@UseInterceptors(NoStoreInterceptor)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('status')
  status(): Promise<AuthStatusResponse> {
    return this.authService.status();
  }

  @Public()
  @Post('setup')
  async setup(
    @Body(new ZodValidationPipe(setupRequestSchema)) body: SetupRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SetupResponse> {
    const result = await this.authService.setup(body, request);
    if (result.tokens) setAuthCookies(reply, result.tokens);
    return result.data;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(body, request);
    if (result.tokens) setAuthCookies(reply, result.tokens);
    return result.data;
  }

  @AllowPending2fa()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): AuthMeResponse {
    return this.authService.me(auth);
  }

  @AllowPending2fa()
  @Get('csrf')
  csrf(@Req() request: FastifyRequest): CsrfTokenResponse {
    const csrfToken = request.cookies?.[CSRF_COOKIE];

    if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'CSRF token is not available',
      });
    }

    return { csrfToken };
  }

  @AllowPending2fa()
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  setupTotp(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
  ): Promise<TwoFactorSetupResponse> {
    return this.authService.setupTotp(auth, request);
  }

  @AllowPending2fa()
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  async enableTotp(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TwoFactorVerifyResponse> {
    const result = await this.authService.enableTotp(auth, body, request);
    if (result.tokens) setAuthCookies(reply, result.tokens);
    return { user: result.data.user };
  }

  @AllowPending2fa()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TwoFactorVerifyResponse> {
    const result = await this.authService.verifyTotp(auth, body, request);
    if (result.tokens) setAuthCookies(reply, result.tokens);
    return { user: result.data.user };
  }

  @AllowPending2fa()
  @Post('recovery/verify')
  @HttpCode(HttpStatus.OK)
  async verifyRecovery(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(recoveryCodeSchema)) body: RecoveryCodeRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TwoFactorVerifyResponse> {
    const result = await this.authService.verifyRecovery(auth, body, request);
    if (result.tokens) setAuthCookies(reply, result.tokens);
    return { user: result.data.user };
  }

  @AllowPending2fa()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.logout(auth, request);
    clearAuthCookies(reply);
  }

  @Get('sessions')
  sessions(@CurrentAuth() auth: AuthContext): Promise<SessionsResponse> {
    return this.authService.listSessions(auth);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.revokeSession(auth, id, request);
    if (id === auth.session.id) {
      clearAuthCookies(reply);
    }
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const tokens = await this.authService.changePassword(auth, body, request);
    setAuthCookies(reply, tokens);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema)) body: ResetPasswordRequest,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    return this.authService.resetPassword(body, request);
  }

  @Post('recovery-codes')
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(regenerateRecoveryCodesRequestSchema))
    body: RegenerateRecoveryCodesRequest,
    @Req() request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    return this.authService.regenerateRecoveryCodes(auth, body, request);
  }
}
