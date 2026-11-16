import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { audioNotes, users, type Database } from '@nexter/db';
import type { BotAudioNoteRequest, BotAudioNoteResponse } from '@nexter/contracts';
import { Inject } from '@nestjs/common';
import { DB } from '../../shared/db/db.module';
import { AiSettingsService } from '../ai/ai-settings.service';
import { AiService } from '../ai/ai.service';
import { NotesService } from '../notes/notes.service';

function toResponse(row: typeof audioNotes.$inferSelect): BotAudioNoteResponse {
  return {
    id: row.id,
    status: row.status as BotAudioNoteResponse['status'],
    noteId: row.noteId,
    title: row.title,
    error: row.error,
  };
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'getResponse' in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    if (response && typeof response === 'object' && 'message' in response) {
      return String((response as { message: unknown }).message).slice(0, 500);
    }
  }
  return error instanceof Error ? error.message.slice(0, 500) : 'Не удалось обработать аудио';
}

@Injectable()
export class AudioNotesService {
  private readonly logger = new Logger(AudioNotesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
    private readonly aiSettings: AiSettingsService,
    private readonly notes: NotesService,
  ) {}

  async createFromBot(input: BotAudioNoteRequest): Promise<BotAudioNoteResponse> {
    const [existing] = await this.db
      .select()
      .from(audioNotes)
      .where(eq(audioNotes.viberMessageId, input.viberMessageId))
      .limit(1);
    if (existing) return toResponse(existing);

    const [owner] = await this.db.select({ id: users.id }).from(users).limit(1);
    if (!owner) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Owner not found' });

    const [created] = await this.db
      .insert(audioNotes)
      .values({
        userId: owner.id,
        viberMessageId: input.viberMessageId,
        status: 'summarizing',
        audioMime: input.audioMime,
        audioName: input.audioName,
        audioSize: input.audioSize,
        durationSeconds: input.durationSeconds ?? null,
        transcript: input.transcript,
      })
      .returning();

    if (!created) throw new Error('Failed to create audio note job');

    try {
      const settings = await this.aiSettings.get(owner.id);
      let title: string;
      let body: string;
      let summary: string;
      let tags: string[] = [];

      if (settings.enabled && settings.hasApiKey) {
        try {
          const result = await this.ai.summarizeNote(owner.id, input.transcript);
          title = result.title;
          body = result.body;
          summary = result.summary;
          tags = result.tags;
        } catch (error) {
          if (!settings.fallbackToRaw) throw error;
          this.logger.warn(`AI summary failed, using raw transcript: ${errorMessage(error)}`);
          const fallback = this.rawNote(input.transcript);
          title = fallback.title;
          body = fallback.body;
          summary = fallback.summary;
        }
      } else if (settings.fallbackToRaw) {
        const fallback = this.rawNote(input.transcript);
        title = fallback.title;
        body = fallback.body;
        summary = fallback.summary;
      } else {
        throw new Error('ИИ не настроен, а сохранение сырого текста отключено');
      }

      const note = await this.notes.createFromAudio(
        owner.id,
        {
          title,
          body: body.slice(0, 20_000),
          tags,
          audio: {
            name:
              input.audioName || `audio-${input.viberMessageId}.${this.extension(input.audioMime)}`,
            mimeType: input.audioMime,
            dataUrl: input.audioDataUrl,
            sizeBytes: input.audioSize,
          },
        },
        {},
      );

      const [updated] = await this.db
        .update(audioNotes)
        .set({
          status: 'done',
          noteId: note.id,
          title,
          summary,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(audioNotes.id, created.id))
        .returning();

      return toResponse(updated ?? created);
    } catch (error) {
      const message = errorMessage(error);
      const [failed] = await this.db
        .update(audioNotes)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(eq(audioNotes.id, created.id))
        .returning();
      this.logger.warn(`Audio note failed: ${message}`);
      return toResponse(failed ?? created);
    }
  }

  async status(id: string): Promise<BotAudioNoteResponse> {
    const [row] = await this.db.select().from(audioNotes).where(eq(audioNotes.id, id)).limit(1);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Audio note not found' });
    return toResponse(row);
  }

  private rawNote(transcript: string): { title: string; body: string; summary: string } {
    const stamp = new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Minsk',
    }).format(new Date());
    return {
      title: `Аудиозаметка ${stamp}`,
      body: transcript.slice(0, 20_000),
      summary: transcript.slice(0, 500),
    };
  }

  private extension(mime: string): string {
    if (mime === 'audio/mpeg') return 'mp3';
    if (mime === 'audio/ogg') return 'ogg';
    if (mime === 'audio/wav') return 'wav';
    if (mime === 'audio/webm') return 'webm';
    return 'm4a';
  }
}
