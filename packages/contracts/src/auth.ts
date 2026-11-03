import { z } from 'zod';

export const emailSchema = z.email().max(254);
export const passwordSchema = z.string().min(12).max(128);

export const setupRequestSchema = z.object({
  setupToken: z.string().min(1).max(256),
  email: emailSchema,
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
});

export const recoveryCodeSchema = z.object({
  code: z.string().min(8).max(128),
});

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const resetPasswordRequestSchema = z.object({
  email: emailSchema,
  recoveryCode: z.string().min(8).max(128),
  newPassword: passwordSchema,
});

export const regenerateRecoveryCodesRequestSchema = z.object({
  password: z.string().min(1).max(128),
});

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.string(),
  totpEnabled: z.boolean(),
});

export const authStatusResponseSchema = z.object({
  initialized: z.boolean(),
});

export const authMeResponseSchema = z.object({
  user: publicUserSchema,
  requires2fa: z.boolean(),
  requires2faSetup: z.boolean(),
});

export const setupResponseSchema = z.object({
  user: publicUserSchema,
  recoveryCodes: z.array(z.string()),
});

export const loginResponseSchema = z.object({
  user: publicUserSchema.optional(),
  requires2fa: z.boolean(),
  requires2faSetup: z.boolean(),
});

export const twoFactorSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  qrDataUrl: z.string(),
});

export const twoFactorVerifyResponseSchema = z.object({
  user: publicUserSchema,
});

export const recoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime(),
  current: z.boolean(),
});

export const sessionsResponseSchema = z.object({
  sessions: z.array(sessionSummarySchema),
});

export const csrfTokenResponseSchema = z.object({
  csrfToken: z.string().min(1),
});

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type TotpCodeRequest = z.infer<typeof totpCodeSchema>;
export type RecoveryCodeRequest = z.infer<typeof recoveryCodeSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type RegenerateRecoveryCodesRequest = z.infer<typeof regenerateRecoveryCodesRequestSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthStatusResponse = z.infer<typeof authStatusResponseSchema>;
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;
export type SetupResponse = z.infer<typeof setupResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponseSchema>;
export type TwoFactorVerifyResponse = z.infer<typeof twoFactorVerifyResponseSchema>;
export type RecoveryCodesResponse = z.infer<typeof recoveryCodesResponseSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type SessionsResponse = z.infer<typeof sessionsResponseSchema>;
export type CsrfTokenResponse = z.infer<typeof csrfTokenResponseSchema>;
