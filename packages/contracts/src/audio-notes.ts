import { z } from 'zod';

export const AUDIO_MAX_MB_DEFAULT = 8;
export const AUDIO_MAX_MB_MIN = 1;
export const AUDIO_MAX_MB_MAX = 20;

// A data URL prefix is at most `data:audio/x-m4a;base64,` (24 chars); keep
// room for future MIME types without changing the derived cap.
const AUDIO_DATA_URL_PREFIX_ALLOWANCE = 64;
// JSON envelope: transcript (50k chars, up to 4 bytes each in UTF-8), id,
// name, duration and MIME. Keep enough headroom for escaping.
const AUDIO_REQUEST_OVERHEAD_BYTES = 300_000;

export function clampAudioMaxMb(value: number): number {
  if (!Number.isFinite(value)) return AUDIO_MAX_MB_DEFAULT;
  const rounded = Math.round(value);
  return Math.min(AUDIO_MAX_MB_MAX, Math.max(AUDIO_MAX_MB_MIN, rounded));
}

export function audioLimitBytes(audioMaxMb: number): number {
  return clampAudioMaxMb(audioMaxMb) * 1024 * 1024;
}

/**
 * Base64 expands binary data to `4 * ceil(bytes / 3)` characters. The cap is
 * derived from the configured binary limit, not fixed, so the two cannot drift.
 */
export function audioDataUrlMaxChars(audioMaxMb: number): number {
  return Math.ceil(audioLimitBytes(audioMaxMb) / 3) * 4 + AUDIO_DATA_URL_PREFIX_ALLOWANCE;
}

/** Raw request body bound: data URL plus the JSON envelope around it. */
export function audioRequestBodyMaxBytes(audioMaxMb: number): number {
  return audioDataUrlMaxChars(audioMaxMb) + AUDIO_REQUEST_OVERHEAD_BYTES;
}

export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function decodedAudioBytes(dataUrl: string): number {
  const separator = dataUrl.indexOf(',');
  return separator === -1 ? 0 : base64ByteLength(dataUrl.slice(separator + 1));
}

export const AUDIO_HARD_MAX_DATA_URL_CHARS = audioDataUrlMaxChars(AUDIO_MAX_MB_MAX);
export const AUDIO_HARD_MAX_REQUEST_BYTES = audioRequestBodyMaxBytes(AUDIO_MAX_MB_MAX);

export const noteAudioMimeSchema = z.enum([
  'audio/mpeg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

export const noteAudioSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mimeType: noteAudioMimeSchema,
  dataUrl: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export const botAudioNoteRequestSchema = z.object({
  viberMessageId: z.string().trim().min(1).max(200),
  transcript: z.string().trim().min(1).max(50_000),
  audioMime: noteAudioMimeSchema,
  audioName: z.string().trim().max(200).default(''),
  audioSize: z.number().int().nonnegative().max(audioLimitBytes(AUDIO_MAX_MB_MAX)),
  durationSeconds: z.number().int().nonnegative().max(3600).nullable().optional(),
  audioDataUrl: z
    .string()
    .max(AUDIO_HARD_MAX_DATA_URL_CHARS)
    .regex(/^data:audio\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i),
});

export const botAudioNoteStatusSchema = z.enum(['received', 'summarizing', 'done', 'failed']);

export const botAudioNoteResponseSchema = z.object({
  id: z.uuid(),
  status: botAudioNoteStatusSchema,
  noteId: z.uuid().nullable(),
  title: z.string().nullable(),
  error: z.string().nullable(),
});

export type NoteAudio = z.infer<typeof noteAudioSchema>;
export type BotAudioNoteRequest = z.infer<typeof botAudioNoteRequestSchema>;
export type BotAudioNoteResponse = z.infer<typeof botAudioNoteResponseSchema>;
