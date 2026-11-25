import { describe, expect, it } from 'vitest';
import type { Note } from '@nexter/contracts';
import { sortNotes } from './notes-sort';

function note(id: string, pinned: boolean, createdAt: string, updatedAt: string): Note {
  return {
    id,
    title: id,
    body: '',
    tags: [],
    images: [],
    audio: [],
    attachmentCount: 0,
    pinned,
    relatedAssetId: null,
    relatedTradeGroupId: null,
    archivedAt: null,
    createdAt,
    updatedAt,
  };
}

describe('sortNotes', () => {
  const pinnedOld = note(
    'pinned-old',
    true,
    '2026-11-01T10:00:00.000Z',
    '2026-11-02T10:00:00.000Z',
  );
  const unpinnedNew = note(
    'unpinned-new',
    false,
    '2026-11-20T10:00:00.000Z',
    '2026-11-21T10:00:00.000Z',
  );
  const unpinnedOld = note(
    'unpinned-old',
    false,
    '2026-11-05T10:00:00.000Z',
    '2026-11-06T10:00:00.000Z',
  );

  it('places pinned notes before newer unpinned notes for both sort modes', () => {
    const notes = [unpinnedNew, pinnedOld, unpinnedOld];
    expect(sortNotes(notes, 'updated').map((item) => item.id)).toEqual([
      'pinned-old',
      'unpinned-new',
      'unpinned-old',
    ]);
    expect(sortNotes(notes, 'created').map((item) => item.id)).toEqual([
      'pinned-old',
      'unpinned-new',
      'unpinned-old',
    ]);
  });
});
