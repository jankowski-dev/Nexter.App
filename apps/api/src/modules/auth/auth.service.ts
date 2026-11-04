import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { sessions, settings, users, type Database, type User } from '@nexter/db';
import type {
  AuthMeResponse,
  AuthStatusResponse,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  PublicUser,
  RecoveryCodeRequest,
  RecoveryCodesResponse,
  RegenerateRecoveryCodesRequest,
  ResetPasswordRequest,
  SessionSummary,
  SessionsResponse,
  SetupRequest,
  SetupResponse,
  StepUpResponse,
  TotpCodeRequest,
  TwoFactorSetupResponse,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { AuditService } from '../../shared/audit/audit.service';
import { AccountingBootstrapService } from '../accounting/accounting-bootstrap.service';
import type { AuthContext } from './auth.types';
import { AuthThrottleService } from './auth-throttle.service';
import { CryptoService } from './crypto.service';
import { SessionService, type SessionTokens } from './session.service';
import { TotpService } from './totp.service';

export interface AuthResult<T> {
  data: T;
  tokens?: SessionTokens;
}

const LOGIN_WINDOW = { max: 10, windowSeconds: 900, blockSeconds: 900 };
const TWO_FACTOR_WINDOW = { max: 5, windowSeconds: 300, blockSeconds: 900 };
const PASSWORD_WINDOW = { max: 5, windowSeconds: 900, blockSeconds: 900 };

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
    private readonly sessions: SessionService,
    private readonly throttle: AuthThrottleService,
    private readonly audit: AuditService,
    private readonly accountingBootstrap: AccountingBootstrapService,
  ) {}

  private publicUser(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      totpEnabled: user.totpEnabled,
    };
  }

  private meta(request: FastifyRequest) {
    return {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  private loginKeys(request: FastifyRequest, email: string): string[] {
    const emailHash = this.crypto.sha256(email);
    return [`login:${request.ip}:${emailHash}`, `login-ip:${request.ip}`];
  }

  private async assertLoginNotBlocked(
    keys: string[],
    meta: ReturnType<AuthService['meta']>,
  ): Promise<void> {
    for (const key of keys) {
      await this.throttle.assertNotBlocked(key, meta);
    }
  }

  private async hitLoginThrottles(
    keys: string[],
    meta: ReturnType<AuthService['meta']>,
  ): Promise<void> {
    let firstError: unknown;

    for (const key of keys) {
      try {
        await this.throttle.hit(key, LOGIN_WINDOW, meta);
      } catch (error) {
        firstError ??= error;
      }
    }

    if (firstError) {
      throw firstError;
    }
  }

  private async resetLoginThrottles(request: FastifyRequest, email: string): Promise<void> {
    await Promise.all(this.loginKeys(request, email).map((key) => this.throttle.reset(key)));
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }

  async status(): Promise<AuthStatusResponse> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(users);

    return { initialized: (row?.count ?? 0) > 0 };
  }

  async setup(dto: SetupRequest, request: FastifyRequest): Promise<AuthResult<SetupResponse>> {
    const key = `setup:${request.ip}`;
    const meta = this.meta(request);
    await this.throttle.assertNotBlocked(key, meta);

    if (!env.SETUP_TOKEN) {
      throw new ServiceUnavailableException({
        code: 'SETUP_DISABLED',
        message: 'First-run setup is disabled',
      });
    }

    if (!this.crypto.safeEqual(dto.setupToken, env.SETUP_TOKEN)) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 900, blockSeconds: 900 }, meta);
      await this.audit.log({
        action: 'auth.setup_failed',
        entityType: 'user',
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'INVALID_SETUP_TOKEN',
        message: 'Invalid setup token',
      });
    }

    this.crypto.assertConfigured();

    const passwordHash = await this.crypto.hashPassword(dto.password);
    const recoveryCodes = this.crypto.generateRecoveryCodes();
    const recoveryCodesHash = recoveryCodes.map((code) => this.crypto.hashRecoveryCode(code));

    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('nexter:setup')::bigint)`);

        const [row] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);

        if ((row?.count ?? 0) > 0) {
          throw new ConflictException({
            code: 'ALREADY_INITIALIZED',
            message: 'Nexter is already initialized',
          });
        }

        const [user] = await tx
          .insert(users)
          .values({
            email: dto.email.toLowerCase(),
            passwordHash,
            recoveryCodesHash,
            role: 'owner',
            totpEnabled: false,
          })
          .returning();

        if (!user) {
          throw new Error('Failed to create owner');
        }

        await tx.insert(settings).values({ userId: user.id });
        await this.accountingBootstrap.ensureDefaults(user.id, tx, this.meta(request), true);

        const tokens = await this.sessions.create(
          user.id,
          {
            twoFactorVerified: false,
            ...meta,
          },
          tx,
        );

        await this.audit.log(
          {
            userId: user.id,
            action: 'auth.setup_completed',
            entityType: 'user',
            entityId: user.id,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
          { executor: tx, strict: true },
        );

        return {
          data: {
            user: this.publicUser(user),
            recoveryCodes,
          },
          tokens,
        };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'ALREADY_INITIALIZED',
          message: 'Nexter is already initialized',
        });
      }

      throw error;
    }
  }

  async login(dto: LoginRequest, request: FastifyRequest): Promise<AuthResult<LoginResponse>> {
    const email = dto.email.toLowerCase();
    const meta = this.meta(request);
    const keys = this.loginKeys(request, email);
    await this.assertLoginNotBlocked(keys, meta);

    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const valid = await this.crypto.verifyPassword(user?.passwordHash, dto.password);

    if (!user || !valid) {
      await this.hitLoginThrottles(keys, meta);
      await this.audit.log({
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: email,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const tokens = await this.db.transaction(async (tx) => {
      const created = await this.sessions.create(
        user.id,
        {
          twoFactorVerified: false,
          ...meta,
        },
        tx,
      );

      await this.audit.log(
        {
          userId: user.id,
          action: 'auth.login_password_ok',
          entityType: 'user',
          entityId: user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );

      return created;
    });

    return {
      data: {
        user: this.publicUser(user),
        requires2fa: user.totpEnabled,
        requires2faSetup: !user.totpEnabled,
      },
      tokens,
    };
  }

  async setupTotp(auth: AuthContext, request: FastifyRequest): Promise<TwoFactorSetupResponse> {
    if (auth.user.totpEnabled) {
      throw new ConflictException({
        code: 'TOTP_ALREADY_ENABLED',
        message: 'TOTP is already enabled',
      });
    }

    const secret = auth.user.totpSecretEncrypted
      ? this.crypto.decryptSecret(auth.user.totpSecretEncrypted)
      : this.totp.generateSecret();

    if (!auth.user.totpSecretEncrypted) {
      const encrypted = this.crypto.encryptSecret(secret);
      const now = new Date();

      await this.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ totpSecretEncrypted: encrypted, updatedAt: now })
          .where(eq(users.id, auth.user.id));

        await this.audit.log(
          {
            userId: auth.user.id,
            action: 'auth.totp_setup_started',
            entityType: 'user',
            entityId: auth.user.id,
            ip: request.ip,
            userAgent: request.headers['user-agent'],
          },
          { executor: tx, strict: true },
        );
      });
    }

    const otpauthUrl = this.totp.uri(auth.user.email, secret);
    const qrDataUrl = await this.totp.qrDataUrl(otpauthUrl);

    return { secret, otpauthUrl, qrDataUrl };
  }

  async enableTotp(
    auth: AuthContext,
    dto: TotpCodeRequest,
    request: FastifyRequest,
  ): Promise<AuthResult<{ user: PublicUser }>> {
    if (auth.user.totpEnabled) {
      throw new ConflictException({
        code: 'TOTP_ALREADY_ENABLED',
        message: 'TOTP is already enabled',
      });
    }

    if (!auth.user.totpSecretEncrypted) {
      throw new BadRequestException({
        code: 'TOTP_NOT_STARTED',
        message: 'Start TOTP setup first',
      });
    }

    const meta = this.meta(request);
    const key = `2fa:${auth.user.id}`;
    await this.throttle.assertNotBlocked(key, meta);

    const secret = this.crypto.decryptSecret(auth.user.totpSecretEncrypted);
    const valid = await this.totp.verify(dto.code, secret);

    if (!valid) {
      await this.throttle.hit(key, TWO_FACTOR_WINDOW, meta);
      await this.audit.log({
        userId: auth.user.id,
        action: 'auth.totp_verify_failed',
        entityType: 'user',
        entityId: auth.user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'TOTP_INVALID',
        message: 'Invalid TOTP code',
      });
    }

    await this.throttle.reset(key);
    await this.resetLoginThrottles(request, auth.user.email);

    const result = await this.db.transaction(async (tx) => {
      const now = new Date();
      const [user] = await tx
        .update(users)
        .set({ totpEnabled: true, lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, auth.user.id))
        .returning();

      const tokens = await this.sessions.rotate(
        auth.session,
        {
          twoFactorVerified: true,
          ...meta,
        },
        tx,
      );

      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.totp_enabled',
          entityType: 'user',
          entityId: auth.user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );

      return { user: user ?? auth.user, tokens };
    });

    return {
      data: { user: this.publicUser(result.user) },
      tokens: result.tokens,
    };
  }

  async verifyTotp(
    auth: AuthContext,
    dto: TotpCodeRequest,
    request: FastifyRequest,
  ): Promise<AuthResult<{ user: PublicUser }>> {
    if (!auth.user.totpEnabled) {
      throw new BadRequestException({
        code: 'TOTP_NOT_ENABLED',
        message: 'TOTP is not enabled',
      });
    }

    if (auth.session.twoFactorVerified) {
      return { data: { user: this.publicUser(auth.user) } };
    }

    if (!auth.user.totpSecretEncrypted) {
      throw new BadRequestException({
        code: 'TOTP_NOT_CONFIGURED',
        message: 'TOTP is not configured',
      });
    }

    const meta = this.meta(request);
    const key = `2fa:${auth.user.id}`;
    await this.throttle.assertNotBlocked(key, meta);

    const secret = this.crypto.decryptSecret(auth.user.totpSecretEncrypted);
    const valid = await this.totp.verify(dto.code, secret);

    if (!valid) {
      await this.throttle.hit(key, TWO_FACTOR_WINDOW, meta);
      await this.audit.log({
        userId: auth.user.id,
        action: 'auth.totp_verify_failed',
        entityType: 'user',
        entityId: auth.user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'TOTP_INVALID',
        message: 'Invalid TOTP code',
      });
    }

    await this.throttle.reset(key);
    await this.resetLoginThrottles(request, auth.user.email);

    const tokens = await this.db.transaction(async (tx) => {
      const now = new Date();

      await tx
        .update(users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, auth.user.id));

      const rotated = await this.sessions.rotate(
        auth.session,
        {
          twoFactorVerified: true,
          ...meta,
        },
        tx,
      );

      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.totp_verified',
          entityType: 'user',
          entityId: auth.user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );

      return rotated;
    });

    return {
      data: { user: this.publicUser(auth.user) },
      tokens,
    };
  }

  async verifyRecovery(
    auth: AuthContext,
    dto: RecoveryCodeRequest,
    request: FastifyRequest,
  ): Promise<AuthResult<{ user: PublicUser }>> {
    if (!auth.user.totpEnabled) {
      throw new BadRequestException({
        code: 'TOTP_SETUP_REQUIRED',
        message: 'TOTP setup must be completed first',
      });
    }

    if (auth.session.twoFactorVerified) {
      return { data: { user: this.publicUser(auth.user) } };
    }

    const meta = this.meta(request);
    const key = `2fa:${auth.user.id}`;
    await this.throttle.assertNotBlocked(key, meta);

    const codeHash = this.crypto.hashRecoveryCode(dto.code);
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, auth.user.id)).for('update');

      if (!user || !user.totpEnabled) {
        return null;
      }

      const index = user.recoveryCodesHash.findIndex((hash) =>
        this.crypto.safeEqual(hash, codeHash),
      );

      if (index === -1) {
        return null;
      }

      const remaining = user.recoveryCodesHash.filter((_hash, hashIndex) => hashIndex !== index);
      const now = new Date();

      await tx
        .update(users)
        .set({ recoveryCodesHash: remaining, lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, user.id));

      const tokens = await this.sessions.rotate(
        auth.session,
        {
          twoFactorVerified: true,
          ...meta,
        },
        tx,
      );

      await this.audit.log(
        {
          userId: user.id,
          action: 'auth.recovery_code_used',
          entityType: 'user',
          entityId: user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );

      return tokens;
    });

    if (!result) {
      await this.throttle.hit(key, TWO_FACTOR_WINDOW, meta);
      await this.audit.log({
        userId: auth.user.id,
        action: 'auth.recovery_verify_failed',
        entityType: 'user',
        entityId: auth.user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'RECOVERY_CODE_INVALID',
        message: 'Invalid recovery code',
      });
    }

    await this.throttle.reset(key);
    await this.resetLoginThrottles(request, auth.user.email);

    return {
      data: { user: this.publicUser(auth.user) },
      tokens: result,
    };
  }

  async logout(auth: AuthContext, request: FastifyRequest): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.sessions.revoke(auth.session.id, tx);
      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.logout',
          entityType: 'session',
          entityId: auth.session.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );
    });
  }

  me(auth: AuthContext): AuthMeResponse {
    return {
      user: this.publicUser(auth.user),
      requires2fa: auth.user.totpEnabled && !auth.session.twoFactorVerified,
      requires2faSetup: !auth.user.totpEnabled,
    };
  }

  async listSessions(auth: AuthContext): Promise<SessionsResponse> {
    const rows = await this.sessions.list(auth.user.id);

    return {
      sessions: rows.map((session): SessionSummary => ({
        id: session.id,
        ip: session.ip,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === auth.session.id,
      })),
    };
  }

  async revokeSession(
    auth: AuthContext,
    sessionId: string,
    request: FastifyRequest,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.userId, auth.user.id),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id });

      if (!revoked) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.session_revoked',
          entityType: 'session',
          entityId: sessionId,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );
    });
  }

  async stepUp(
    auth: AuthContext,
    dto: TotpCodeRequest,
    request: FastifyRequest,
  ): Promise<StepUpResponse> {
    if (!auth.session.twoFactorVerified || !auth.user.totpEnabled) {
      throw new BadRequestException({
        code: 'TOTP_REQUIRED',
        message: 'Two-factor authentication is required',
      });
    }

    if (!auth.user.totpSecretEncrypted) {
      throw new BadRequestException({
        code: 'TOTP_NOT_CONFIGURED',
        message: 'TOTP is not configured',
      });
    }

    const meta = this.meta(request);
    const key = `2fa:${auth.user.id}`;
    await this.throttle.assertNotBlocked(key, meta);
    const secret = this.crypto.decryptSecret(auth.user.totpSecretEncrypted);
    const valid = await this.totp.verify(dto.code, secret);

    if (!valid) {
      await this.throttle.hit(key, TWO_FACTOR_WINDOW, meta);
      await this.audit.log({
        userId: auth.user.id,
        action: 'auth.step_up_failed',
        entityType: 'user',
        entityId: auth.user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'TOTP_INVALID',
        message: 'Invalid TOTP code',
      });
    }

    await this.throttle.reset(key);
    const stepUpUntil = new Date(Date.now() + 5 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      await tx.update(sessions).set({ stepUpUntil }).where(eq(sessions.id, auth.session.id));

      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.step_up_succeeded',
          entityType: 'session',
          entityId: auth.session.id,
          after: { stepUpUntil: stepUpUntil.toISOString() },
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );
    });

    return { stepUpUntil: stepUpUntil.toISOString() };
  }

  async changePassword(
    auth: AuthContext,
    dto: ChangePasswordRequest,
    request: FastifyRequest,
  ): Promise<SessionTokens> {
    const key = `password:${auth.user.id}`;
    const meta = this.meta(request);
    await this.throttle.assertNotBlocked(key, meta);
    const valid = await this.crypto.verifyPassword(auth.user.passwordHash, dto.currentPassword);

    if (!valid) {
      await this.throttle.hit(key, PASSWORD_WINDOW, meta);
      await this.audit.log({
        userId: auth.user.id,
        action: 'auth.password_change_failed',
        entityType: 'user',
        entityId: auth.user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Current password is invalid',
      });
    }

    const passwordHash = await this.crypto.hashPassword(dto.newPassword);

    const tokens = await this.db.transaction(async (tx) => {
      const revoked = await this.sessions.revokeActive(auth.session.id, tx);

      if (!revoked) {
        throw new UnauthorizedException({
          code: 'AUTH_REQUIRED',
          message: 'Session is no longer active',
        });
      }

      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, auth.user.id));

      await this.sessions.revokeOthers(auth.user.id, auth.session.id, tx);

      const rotated = await this.sessions.create(
        auth.user.id,
        {
          twoFactorVerified: true,
          ...meta,
        },
        tx,
      );

      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.password_changed',
          entityType: 'user',
          entityId: auth.user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );

      return rotated;
    });

    await this.throttle.reset(key);
    await this.throttle.reset(`2fa:${auth.user.id}`);
    await this.resetLoginThrottles(request, auth.user.email);
    return tokens;
  }

  async resetPassword(
    dto: ResetPasswordRequest,
    request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    const email = dto.email.toLowerCase();
    const meta = this.meta(request);
    const emailHash = this.crypto.sha256(email);
    const keys = [`reset:${request.ip}:${emailHash}`, `reset-ip:${request.ip}`];

    for (const key of keys) {
      await this.throttle.assertNotBlocked(key, meta);
    }

    const codeHash = this.crypto.hashRecoveryCode(dto.recoveryCode);
    const result = await this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.email, email)).for('update');

      if (!user) {
        return null;
      }

      const index = user.recoveryCodesHash.findIndex((hash) =>
        this.crypto.safeEqual(hash, codeHash),
      );

      if (index === -1) {
        return null;
      }

      const newCodes = this.crypto.generateRecoveryCodes();
      const newHashes = newCodes.map((code) => this.crypto.hashRecoveryCode(code));
      const passwordHash = await this.crypto.hashPassword(dto.newPassword);

      await tx
        .update(users)
        .set({
          passwordHash,
          recoveryCodesHash: newHashes,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await this.sessions.revokeAll(user.id, tx);

      await this.audit.log(
        {
          userId: user.id,
          action: 'auth.password_reset',
          entityType: 'user',
          entityId: user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );

      return { newCodes, userId: user.id };
    });

    if (!result) {
      let firstError: unknown;

      for (const key of keys) {
        try {
          await this.throttle.hit(key, PASSWORD_WINDOW, meta);
        } catch (error) {
          firstError ??= error;
        }
      }

      await this.audit.log({
        action: 'auth.password_reset_failed',
        entityType: 'user',
        entityId: email,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });

      if (firstError) {
        throw firstError;
      }

      throw new UnauthorizedException({
        code: 'RECOVERY_CODE_INVALID',
        message: 'Invalid recovery code',
      });
    }

    for (const key of keys) {
      await this.throttle.reset(key);
    }

    await this.throttle.reset(`2fa:${result.userId}`);
    await this.throttle.reset(`password:${result.userId}`);
    await this.throttle.reset(`recovery-codes:${result.userId}`);
    await this.resetLoginThrottles(request, email);

    return { recoveryCodes: result.newCodes };
  }

  async regenerateRecoveryCodes(
    auth: AuthContext,
    dto: RegenerateRecoveryCodesRequest,
    request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    const key = `recovery-codes:${auth.user.id}`;
    const meta = this.meta(request);
    await this.throttle.assertNotBlocked(key, meta);
    const valid = await this.crypto.verifyPassword(auth.user.passwordHash, dto.password);

    if (!valid) {
      await this.throttle.hit(key, PASSWORD_WINDOW, meta);
      await this.audit.log({
        userId: auth.user.id,
        action: 'auth.recovery_codes_regeneration_failed',
        entityType: 'user',
        entityId: auth.user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Password is invalid',
      });
    }

    const recoveryCodes = this.crypto.generateRecoveryCodes();
    const recoveryCodesHash = recoveryCodes.map((code) => this.crypto.hashRecoveryCode(code));

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ recoveryCodesHash, updatedAt: new Date() })
        .where(eq(users.id, auth.user.id));

      await this.audit.log(
        {
          userId: auth.user.id,
          action: 'auth.recovery_codes_regenerated',
          entityType: 'user',
          entityId: auth.user.id,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        },
        { executor: tx, strict: true },
      );
    });

    await this.throttle.reset(key);
    return { recoveryCodes };
  }
}
