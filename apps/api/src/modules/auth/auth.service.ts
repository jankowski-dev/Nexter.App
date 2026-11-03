import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
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
  TotpCodeRequest,
  TwoFactorSetupResponse,
} from '@nexter/contracts';
import type { FastifyRequest } from 'fastify';
import { env } from '../../shared/config/env';
import { DB } from '../../shared/db/db.module';
import { AuditService } from '../../shared/audit/audit.service';
import type { AuthContext } from './auth.types';
import { AuthThrottleService } from './auth-throttle.service';
import { CryptoService } from './crypto.service';
import { SessionService, type SessionTokens } from './session.service';
import { TotpService } from './totp.service';

export interface AuthResult<T> {
  data: T;
  tokens?: SessionTokens;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly totp: TotpService,
    private readonly sessions: SessionService,
    private readonly throttle: AuthThrottleService,
    private readonly audit: AuditService,
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

  async status(): Promise<AuthStatusResponse> {
    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(users);

    return { initialized: (row?.count ?? 0) > 0 };
  }

  async setup(dto: SetupRequest, request: FastifyRequest): Promise<AuthResult<SetupResponse>> {
    const key = `setup:${request.ip}`;
    await this.throttle.assertNotBlocked(key);

    const [row] = await this.db.select({ count: sql<number>`count(*)::int` }).from(users);

    if ((row?.count ?? 0) > 0) {
      throw new ConflictException({
        code: 'ALREADY_INITIALIZED',
        message: 'Nexter is already initialized',
      });
    }

    if (!env.SETUP_TOKEN) {
      throw new ServiceUnavailableException({
        code: 'SETUP_DISABLED',
        message: 'SETUP_TOKEN is not configured',
      });
    }

    if (!this.crypto.safeEqual(dto.setupToken, env.SETUP_TOKEN)) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 900, blockSeconds: 900 });
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

    const passwordHash = await this.crypto.hashPassword(dto.password);
    const recoveryCodes = this.crypto.generateRecoveryCodes();
    const recoveryCodesHash = recoveryCodes.map((code) => this.crypto.hashRecoveryCode(code));

    const [user] = await this.db
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

    await this.db.insert(settings).values({ userId: user.id });

    const tokens = await this.sessions.create(user.id, {
      twoFactorVerified: false,
      ...this.meta(request),
    });

    await this.audit.log({
      userId: user.id,
      action: 'auth.setup_completed',
      entityType: 'user',
      entityId: user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return {
      data: {
        user: this.publicUser(user),
        recoveryCodes,
      },
      tokens,
    };
  }

  async login(dto: LoginRequest, request: FastifyRequest): Promise<AuthResult<LoginResponse>> {
    const key = `login:${request.ip}`;
    await this.throttle.assertNotBlocked(key);

    const email = dto.email.toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !(await this.crypto.verifyPassword(user.passwordHash, dto.password))) {
      await this.throttle.hit(key, { max: 10, windowSeconds: 900, blockSeconds: 900 });
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

    await this.throttle.reset(key);

    const tokens = await this.sessions.create(user.id, {
      twoFactorVerified: false,
      ...this.meta(request),
    });

    await this.audit.log({
      userId: user.id,
      action: 'auth.login_password_ok',
      entityType: 'user',
      entityId: user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
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

    const secret = this.totp.generateSecret();
    const encrypted = this.crypto.encryptSecret(secret);

    await this.db
      .update(users)
      .set({ totpSecretEncrypted: encrypted, updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));

    const otpauthUrl = this.totp.uri(auth.user.email, secret);
    const qrDataUrl = await this.totp.qrDataUrl(otpauthUrl);

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.totp_setup_started',
      entityType: 'user',
      entityId: auth.user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

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

    const secret = this.crypto.decryptSecret(auth.user.totpSecretEncrypted);
    const valid = await this.totp.verify(dto.code, secret);
    const key = `2fa:${auth.session.id}`;

    if (!valid) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 300, blockSeconds: 900 });
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
    const now = new Date();

    await this.db
      .update(users)
      .set({ totpEnabled: true, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, auth.user.id));

    const tokens = await this.sessions.rotate(auth.session, {
      twoFactorVerified: true,
      ...this.meta(request),
    });

    const [user] = await this.db.select().from(users).where(eq(users.id, auth.user.id)).limit(1);

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.totp_enabled',
      entityType: 'user',
      entityId: auth.user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return {
      data: { user: this.publicUser(user ?? auth.user) },
      tokens,
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

    const secret = this.crypto.decryptSecret(auth.user.totpSecretEncrypted);
    const valid = await this.totp.verify(dto.code, secret);
    const key = `2fa:${auth.session.id}`;

    if (!valid) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 300, blockSeconds: 900 });
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
    const now = new Date();

    await this.db
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, auth.user.id));

    const tokens = await this.sessions.rotate(auth.session, {
      twoFactorVerified: true,
      ...this.meta(request),
    });

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.totp_verified',
      entityType: 'user',
      entityId: auth.user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
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

    const codeHash = this.crypto.hashRecoveryCode(dto.code);
    const index = auth.user.recoveryCodesHash.findIndex((hash) =>
      this.crypto.safeEqual(hash, codeHash),
    );
    const key = `2fa:${auth.session.id}`;

    if (index === -1) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 300, blockSeconds: 900 });
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
    const remaining = auth.user.recoveryCodesHash.filter((_hash, hashIndex) => hashIndex !== index);
    const now = new Date();

    await this.db
      .update(users)
      .set({ recoveryCodesHash: remaining, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, auth.user.id));

    const tokens = await this.sessions.rotate(auth.session, {
      twoFactorVerified: true,
      ...this.meta(request),
    });

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.recovery_code_used',
      entityType: 'user',
      entityId: auth.user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return {
      data: { user: this.publicUser(auth.user) },
      tokens,
    };
  }

  async logout(auth: AuthContext, request: FastifyRequest): Promise<void> {
    await this.sessions.revoke(auth.session.id);
    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.logout',
      entityType: 'session',
      entityId: auth.session.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
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

  async revokeSession(auth: AuthContext, sessionId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.user.id)));

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: sessionId,
      ip: undefined,
    });
  }

  async changePassword(
    auth: AuthContext,
    dto: ChangePasswordRequest,
    request: FastifyRequest,
  ): Promise<void> {
    const key = `password:${auth.user.id}`;
    await this.throttle.assertNotBlocked(key);
    const valid = await this.crypto.verifyPassword(auth.user.passwordHash, dto.currentPassword);

    if (!valid) {
      await this.throttle.hit(key, {
        max: 5,
        windowSeconds: 900,
        blockSeconds: 900,
      });
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Current password is invalid',
      });
    }

    await this.throttle.reset(key);
    const passwordHash = await this.crypto.hashPassword(dto.newPassword);

    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));

    await this.sessions.revokeOthers(auth.user.id, auth.session.id);

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: auth.user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  }

  async resetPassword(
    dto: ResetPasswordRequest,
    request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    const key = `reset:${request.ip}`;
    await this.throttle.assertNotBlocked(key);

    const email = dto.email.toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    const codeHash = this.crypto.hashRecoveryCode(dto.recoveryCode);
    const index = user
      ? user.recoveryCodesHash.findIndex((hash) => this.crypto.safeEqual(hash, codeHash))
      : -1;

    if (!user || index === -1) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 900, blockSeconds: 900 });
      await this.audit.log({
        action: 'auth.password_reset_failed',
        entityType: 'user',
        entityId: email,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      throw new UnauthorizedException({
        code: 'RECOVERY_CODE_INVALID',
        message: 'Invalid recovery code',
      });
    }

    await this.throttle.reset(key);
    const newCodes = this.crypto.generateRecoveryCodes();
    const newHashes = newCodes.map((code) => this.crypto.hashRecoveryCode(code));
    const passwordHash = await this.crypto.hashPassword(dto.newPassword);

    await this.db
      .update(users)
      .set({
        passwordHash,
        recoveryCodesHash: newHashes,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, user.id));

    await this.audit.log({
      userId: user.id,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return { recoveryCodes: newCodes };
  }

  async regenerateRecoveryCodes(
    auth: AuthContext,
    dto: RegenerateRecoveryCodesRequest,
    request: FastifyRequest,
  ): Promise<RecoveryCodesResponse> {
    const key = `recovery-codes:${auth.user.id}`;
    await this.throttle.assertNotBlocked(key);
    const valid = await this.crypto.verifyPassword(auth.user.passwordHash, dto.password);

    if (!valid) {
      await this.throttle.hit(key, { max: 5, windowSeconds: 900, blockSeconds: 900 });
      throw new UnauthorizedException({
        code: 'INVALID_PASSWORD',
        message: 'Password is invalid',
      });
    }

    await this.throttle.reset(key);

    const recoveryCodes = this.crypto.generateRecoveryCodes();
    const recoveryCodesHash = recoveryCodes.map((code) => this.crypto.hashRecoveryCode(code));

    await this.db
      .update(users)
      .set({ recoveryCodesHash, updatedAt: new Date() })
      .where(eq(users.id, auth.user.id));

    await this.audit.log({
      userId: auth.user.id,
      action: 'auth.recovery_codes_regenerated',
      entityType: 'user',
      entityId: auth.user.id,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });

    return { recoveryCodes };
  }
}
