import { BadRequestException } from '@nestjs/common';

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string): T {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Cursor is not an object');
    }

    return parsed as T;
  } catch {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Invalid pagination cursor',
    });
  }
}

export function makePage<T>(
  rows: T[],
  limit: number,
  cursorFor: (row: T) => string,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);

  return {
    data,
    nextCursor: hasMore && last ? cursorFor(last) : null,
    hasMore,
  };
}
