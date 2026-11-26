export const MAX_TASK_ATTACHMENTS = 5;
export const MAX_TASK_ATTACHMENT_BYTES = 1_500_000;

export const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const TASK_ATTACHMENT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.rar',
  'application/zip',
]);

export const TASK_ATTACHMENT_EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  rar: 'application/vnd.rar',
  zip: 'application/zip',
};

export const TASK_ATTACHMENT_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  '.pdf',
  '.txt',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.rar',
  '.zip',
].join(',');

export function isImageMime(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}

export function mimeTypeForFile(file: File): string {
  if (file.type && TASK_ATTACHMENT_MIME_TYPES.has(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return TASK_ATTACHMENT_EXTENSION_TYPES[extension] ?? '';
}

export function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

export function decodedBase64Bytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}
