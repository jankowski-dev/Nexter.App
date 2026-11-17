import { describe, expect, it } from 'vitest';
import {
  AUDIO_HARD_MAX_DATA_URL_CHARS,
  AUDIO_HARD_MAX_REQUEST_BYTES,
  AUDIO_MAX_MB_DEFAULT,
  AUDIO_MAX_MB_MAX,
  AUDIO_MAX_MB_MIN,
  audioDataUrlMaxChars,
  audioLimitBytes,
  audioRequestBodyMaxBytes,
  base64ByteLength,
  botAudioNoteRequestSchema,
  clampAudioMaxMb,
  decodedAudioBytes,
} from './audio-notes';
import { updateSettingsRequestSchema } from './settings';

describe('audio upload limits', () => {
  it('clamps the configurable limit to the supported range', () => {
    expect(clampAudioMaxMb(0)).toBe(AUDIO_MAX_MB_MIN);
    expect(clampAudioMaxMb(-5)).toBe(AUDIO_MAX_MB_MIN);
    expect(clampAudioMaxMb(1)).toBe(1);
    expect(clampAudioMaxMb(8.4)).toBe(8);
    expect(clampAudioMaxMb(19.6)).toBe(20);
    expect(clampAudioMaxMb(21)).toBe(AUDIO_MAX_MB_MAX);
    expect(clampAudioMaxMb(Number.NaN)).toBe(AUDIO_MAX_MB_DEFAULT);
    expect(clampAudioMaxMb(Number.POSITIVE_INFINITY)).toBe(AUDIO_MAX_MB_DEFAULT);
  });

  it('derives the data URL and request caps from the binary limit', () => {
    expect(audioLimitBytes(8)).toBe(8 * 1024 * 1024);
    expect(audioDataUrlMaxChars(8)).toBe(4 * Math.ceil((8 * 1024 * 1024) / 3) + 64);
    expect(audioRequestBodyMaxBytes(8)).toBe(audioDataUrlMaxChars(8) + 300_000);
    expect(AUDIO_HARD_MAX_DATA_URL_CHARS).toBe(audioDataUrlMaxChars(AUDIO_MAX_MB_MAX));
    expect(AUDIO_HARD_MAX_REQUEST_BYTES).toBe(audioRequestBodyMaxBytes(AUDIO_MAX_MB_MAX));
    expect(audioDataUrlMaxChars(20)).toBeGreaterThan(audioDataUrlMaxChars(1));
  });

  it('measures base64 and data URL payloads', () => {
    expect(base64ByteLength('')).toBe(0);
    expect(base64ByteLength('QQ==')).toBe(1);
    expect(base64ByteLength('QUI=')).toBe(2);
    expect(base64ByteLength('QUJD')).toBe(3);
    expect(decodedAudioBytes('data:audio/mpeg;base64,QUJD')).toBe(3);
    expect(decodedAudioBytes('data:audio/mpeg;base64,')).toBe(0);
    expect(decodedAudioBytes('not-a-data-url')).toBe(0);
  });

  it('accepts the hard binary maximum at the contract level and rejects more', () => {
    const base = {
      viberMessageId: 'viber-1',
      transcript: 'test',
      audioMime: 'audio/mpeg' as const,
      audioName: 'note.mp3',
      durationSeconds: 1,
      audioDataUrl: 'data:audio/mpeg;base64,QUJD',
    };

    expect(
      botAudioNoteRequestSchema.safeParse({
        ...base,
        audioSize: audioLimitBytes(AUDIO_MAX_MB_MAX),
      }).success,
    ).toBe(true);
    expect(
      botAudioNoteRequestSchema.safeParse({
        ...base,
        audioSize: audioLimitBytes(AUDIO_MAX_MB_MAX) + 1,
      }).success,
    ).toBe(false);
  });

  it('validates the settings range for audioMaxMb', () => {
    expect(updateSettingsRequestSchema.safeParse({ audioMaxMb: 8 }).success).toBe(true);
    expect(updateSettingsRequestSchema.safeParse({ audioMaxMb: AUDIO_MAX_MB_MIN }).success).toBe(
      true,
    );
    expect(updateSettingsRequestSchema.safeParse({ audioMaxMb: AUDIO_MAX_MB_MAX }).success).toBe(
      true,
    );
    expect(updateSettingsRequestSchema.safeParse({ audioMaxMb: 0 }).success).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({ audioMaxMb: 21 }).success).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({ audioMaxMb: 8.5 }).success).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({ timezone: 'Europe/Minsk' }).success).toBe(true);
  });
});
