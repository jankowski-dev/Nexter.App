const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_DIMENSION = 1400;

export interface CompressedTaskImage {
  name: string;
  mimeType: 'image/jpeg';
  dataUrl: string;
  sizeBytes: number;
}

export async function compressTaskImage(file: File): Promise<CompressedTaskImage> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Поддерживаются только PNG, JPEG и WebP.');
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Файл больше 15 МБ.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('Не удалось подготовить изображение.');
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const sizeBytes = Math.floor((base64.length * 3) / 4);

  return {
    name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
    mimeType: 'image/jpeg',
    dataUrl,
    sizeBytes,
  };
}
