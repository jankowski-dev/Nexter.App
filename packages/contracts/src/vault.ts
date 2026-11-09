import { z } from 'zod';

function decodedBase64Length(value: string): number {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

const base64Schema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected base64')
  .refine((value) => value.length % 4 === 0, 'Base64 length must be a multiple of 4');

function exactBytes(bytes: number) {
  return base64Schema.refine(
    (value) => decodedBase64Length(value) === bytes,
    `Expected ${bytes} decoded bytes`,
  );
}

function ciphertextSchema() {
  return base64Schema
    .max(16_000)
    .refine((value) => decodedBase64Length(value) >= 16, 'Ciphertext is too short')
    .refine((value) => decodedBase64Length(value) <= 12_000, 'Ciphertext is too large');
}

export const vaultConfigSchema = z.object({
  salt: exactBytes(16),
  iterations: z.number().int().min(600_000).max(1_200_000),
  wrappedKey: exactBytes(48),
  wrappedKeyIv: exactBytes(12),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const vaultItemSchema = z.object({
  id: z.uuid(),
  ciphertext: ciphertextSchema(),
  iv: exactBytes(12),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const vaultResponseSchema = z.object({
  config: vaultConfigSchema.nullable(),
  items: z.array(vaultItemSchema),
});

export const vaultQuerySchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

export const vaultInitializeRequestSchema = z.object({
  salt: exactBytes(16),
  iterations: z.number().int().min(600_000).max(1_200_000),
  wrappedKey: exactBytes(48),
  wrappedKeyIv: exactBytes(12),
});

export const vaultItemCreateRequestSchema = z.object({
  ciphertext: ciphertextSchema(),
  iv: exactBytes(12),
});

export const vaultItemUpdateRequestSchema = z
  .object({
    ciphertext: ciphertextSchema().optional(),
    iv: exactBytes(12).optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.ciphertext !== undefined || value.iv !== undefined || value.archived !== undefined,
    'At least one field must be provided',
  );

export type VaultConfig = z.infer<typeof vaultConfigSchema>;
export type VaultItem = z.infer<typeof vaultItemSchema>;
export type VaultResponse = z.infer<typeof vaultResponseSchema>;
export type VaultQuery = z.infer<typeof vaultQuerySchema>;
export type VaultInitializeRequest = z.infer<typeof vaultInitializeRequestSchema>;
export type VaultItemCreateRequest = z.infer<typeof vaultItemCreateRequestSchema>;
export type VaultItemUpdateRequest = z.infer<typeof vaultItemUpdateRequestSchema>;
