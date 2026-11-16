import { z } from 'zod';

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
  audioSize: z.number().int().nonnegative().max(10_000_000),
  durationSeconds: z.number().int().nonnegative().max(3600).nullable().optional(),
  audioDataUrl: z
    .string()
    .max(3_500_000)
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
