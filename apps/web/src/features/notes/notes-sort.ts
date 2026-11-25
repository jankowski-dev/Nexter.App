import type { Note } from '@nexter/contracts';

export function sortNotes(notes: Note[], sort: 'updated' | 'created'): Note[] {
  const field = sort === 'updated' ? 'updatedAt' : 'createdAt';
  return [...notes].sort((left, right) => {
    if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
    return right[field].localeCompare(left[field]);
  });
}
