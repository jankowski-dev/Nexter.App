import { useRef } from 'react';
import { FileIcon, PaperclipIcon } from '@/components/ui/icons';
import {
  MAX_TASK_ATTACHMENTS,
  TASK_ATTACHMENT_ACCEPT,
  formatBytes,
  isImageMime,
} from '@/lib/attachments';

export interface AttachmentItem {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
}

export type AudioAttachmentItem = AttachmentItem;

/**
 * Shared attachment panel for Notes and Tasks. The same dashed card, add
 * button, image thumbnails, file download cards and empty state stay in sync
 * across both modules.
 */
export function AttachmentsPanel<T extends AttachmentItem>({
  items,
  audio = [],
  maxItems = MAX_TASK_ATTACHMENTS,
  accept = TASK_ATTACHMENT_ACCEPT,
  editable,
  adding = false,
  title = 'Файлы',
  description = 'До 5 файлов, до 1,5 МБ. PDF, таблицы, архивы и изображения.',
  emptyText = 'Пока нет файлов — прикрепите PDF, таблицу, архив или изображение.',
  onFiles,
  onRemove,
  onOpenImage,
  className = '',
}: {
  items: readonly T[];
  audio?: readonly AudioAttachmentItem[];
  maxItems?: number;
  accept?: string;
  editable: boolean;
  adding?: boolean;
  title?: string;
  description?: string;
  emptyText?: string;
  onFiles: (files: FileList | null) => void;
  onRemove?: (item: T) => void;
  onOpenImage?: (item: T) => void;
  className?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const images = items.filter((item) => isImageMime(item.mimeType));
  const files = items.filter((item) => !isImageMime(item.mimeType));

  return (
    <div
      className={`rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 p-3 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-emerald-700">
            <PaperclipIcon />
          </span>
          <div>
            <div className="text-sm font-medium text-zinc-800">{title}</div>
            <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
          </div>
        </div>
        {editable ? (
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={adding || items.length >= maxItems}
          >
            {adding ? 'Загружаю…' : 'Добавить файл'}
          </button>
        ) : null}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        aria-label="Добавить файл"
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = '';
        }}
      />

      {images.length > 0 ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white"
            >
              {onOpenImage ? (
                <button type="button" className="block w-full" onClick={() => onOpenImage(image)}>
                  <img src={image.dataUrl} alt={image.name} className="h-24 w-full object-cover" />
                </button>
              ) : (
                <img src={image.dataUrl} alt={image.name} className="h-24 w-full object-cover" />
              )}
              {editable && onRemove ? (
                <button
                  type="button"
                  aria-label={`Удалить ${image.name}`}
                  className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-xs text-zinc-700 shadow hover:text-red-700"
                  onClick={() => onRemove(image)}
                  disabled={adding}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="mt-2 space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-700"
            >
              <FileIcon className="h-4 w-4 shrink-0" />
              <a
                href={file.dataUrl}
                download={file.name}
                className="min-w-0 flex-1 truncate hover:text-emerald-800"
              >
                {file.name}
              </a>
              <span className="shrink-0 text-xs text-zinc-500">{formatBytes(file.sizeBytes)}</span>
              {editable && onRemove ? (
                <button
                  type="button"
                  aria-label={`Удалить ${file.name}`}
                  className="text-zinc-500 hover:text-red-700"
                  onClick={() => onRemove(file)}
                  disabled={adding}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {audio.length > 0 ? (
        <div className="mt-3 space-y-2">
          {audio.map((item) => (
            <div key={item.id} className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
                <span className="min-w-0 truncate font-medium text-zinc-800">{item.name}</span>
                <span>{formatBytes(item.sizeBytes)}</span>
              </div>
              <audio controls src={item.dataUrl} className="mt-2 h-9 w-full" />
              <a
                className="mt-2 inline-block text-xs text-emerald-800 hover:underline"
                href={item.dataUrl}
                download={item.name}
              >
                Скачать оригинал
              </a>
            </div>
          ))}
        </div>
      ) : null}

      {items.length === 0 && audio.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-white/70 px-3 py-2 text-xs text-zinc-500">
          <FileIcon className="h-4 w-4 shrink-0" />
          {emptyText}
        </div>
      ) : null}
    </div>
  );
}
