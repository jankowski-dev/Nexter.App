export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '';

  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    const isNumeric = /^-?\d+(?:\.\d+)?$/.test(text);
    const safe = !isNumeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };

  return [
    headers.map(escape).join(','),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
  ].join('\r\n');
}
