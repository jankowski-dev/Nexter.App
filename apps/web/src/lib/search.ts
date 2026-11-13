/**
 * Shared client-side search helpers.
 *
 * Search is case-insensitive, ignores diacritics and treats `ё` as `е`, so
 * Russian and Latin queries behave the same across the app. Multiple words
 * are AND-ed: every term must match at least one of the provided values.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .trim();
}

export function matchesSearch(
  query: string,
  values: ReadonlyArray<string | null | undefined>,
): boolean {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = values
    .filter((value): value is string => Boolean(value))
    .map(normalizeSearchText);

  return terms.every((term) => haystack.some((value) => value.includes(term)));
}

export function filterBySearch<T>(
  items: readonly T[],
  query: string,
  getValues: (item: T) => ReadonlyArray<string | null | undefined>,
): T[] {
  return items.filter((item) => matchesSearch(query, getValues(item)));
}
