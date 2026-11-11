import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { FileIcon, NotebookIcon, PencilIcon, TrashIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { addNoteImage, createNote, fetchNote, removeNoteImage, updateNote } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { compressTaskImage } from '@/lib/image';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSaveFlash } from '@/lib/use-save-flash';
import type { Note, NoteImage } from '@nexter/contracts';
import { NoteImageViewer } from './note-image-viewer';
import { NoteEditor, NoteMarkdown } from './note-markdown';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ATTACHMENT_MIME_TYPES = new Set([
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
  'application/x-rar-compressed',
  'application/zip',
  'application/x-zip-compressed',
]);
const EXTENSION_MIME_TYPES: Record<string, string> = {
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
const ATTACHMENT_ACCEPT = [
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

function isImageAttachment(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(mimeType);
}

function mimeTypeForFile(file: File): string {
  if (file.type && ATTACHMENT_MIME_TYPES.has(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME_TYPES[extension] ?? '';
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} КБ`;
  return `${(value / 1024 / 1024).toFixed(1)} МБ`;
}

function tagsFromInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function payloadFrom(note: { title: string; body: string; tags: string; pinned: boolean }): {
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
} {
  return {
    title: note.title.trim(),
    body: note.body,
    tags: tagsFromInput(note.tags),
    pinned: note.pinned,
  };
}

export function NoteDrawer({
  note,
  startInEdit = false,
  startWithDelete = false,
  onClose,
  onSaved,
  onDeleted,
  onImagesChanged,
}: {
  note: Note | null;
  startInEdit?: boolean;
  startWithDelete?: boolean;
  onClose: () => void;
  onSaved: (note: Note) => void;
  onDeleted: () => void;
  onImagesChanged?: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>(note && !startInEdit ? 'view' : 'edit');
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [tags, setTags] = useState(note?.tags.join(', ') ?? '');
  const [pinned] = useState(note?.pinned ?? false);
  const [archived, setArchived] = useState(Boolean(note?.archivedAt));
  const [images, setImages] = useState<NoteImage[]>(note?.images ?? []);
  const attachments = useQuery({
    queryKey: ['note-attachments', note?.id],
    queryFn: () => fetchNote(note!.id),
    enabled: Boolean(note?.id && note.images.length === 0 && note.attachmentCount > 0),
  });
  const viewerImages = images.filter((image) => isImageAttachment(image.mimeType));
  const [createdAt, setCreatedAt] = useState<string | null>(note?.createdAt ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(note?.updatedAt ?? null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const showSaving = useSaveFlash(saveState);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(startWithDelete && Boolean(note));
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (attachments.data) setImages(attachments.data.images);
  }, [attachments.data]);

  const noteIdRef = useRef<string | null>(note?.id ?? null);
  const savedSignatureRef = useRef<string | null>(
    note
      ? JSON.stringify({
          title: note.title,
          body: note.body,
          tags: note.tags,
          pinned: note.pinned,
        })
      : null,
  );
  const draftRef = useRef({ title, body, tags, pinned });
  draftRef.current = { title, body, tags, pinned };

  async function runSave(): Promise<boolean> {
    const draft = draftRef.current;
    const payload = payloadFrom(draft);

    if (!payload.title) {
      if (noteIdRef.current) {
        setError('Название заметки не может быть пустым.');
        setSaveState('error');
        return false;
      }
      return true;
    }

    const signature = JSON.stringify(payload);
    if (signature === savedSignatureRef.current) {
      setSaveState('saved');
      return true;
    }

    setSaveState('saving');
    setError(null);

    try {
      const saved = noteIdRef.current
        ? await updateNote(noteIdRef.current, payload)
        : await createNote(payload);
      noteIdRef.current = saved.id;
      savedSignatureRef.current = signature;
      setCreatedAt(saved.createdAt);
      setUpdatedAt(saved.updatedAt);
      setSaveState('saved');
      onSaved(saved);
      return true;
    } catch (err) {
      setSaveState('error');
      setError(toRussianError(err, 'Не удалось сохранить заметку'));
      return false;
    }
  }

  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const saveNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  function enqueue<T>(action: () => Promise<T>): Promise<T> {
    const next = saveChainRef.current.then(action, action);
    saveChainRef.current = next.catch(() => undefined);
    return next;
  }

  function saveNow(): Promise<boolean> {
    return enqueue(runSave);
  }

  saveNowRef.current = saveNow;

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (mode === 'edit') void saveNowRef.current();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [mode]);

  async function attemptClose(): Promise<void> {
    if (mode === 'view') {
      onClose();
      return;
    }

    if (!draftRef.current.title.trim() && noteIdRef.current) {
      setError('Название заметки не может быть пустым. Верните заголовок или удалите заметку.');
      setSaveState('error');
      return;
    }

    const saved = await saveNow();
    if (saved) onClose();
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    if (!draftRef.current.title.trim()) {
      setError('Сначала укажите заголовок заметки.');
      return;
    }
    if (images.length + files.length > 5) {
      setError('Не больше 5 вложений на заметку.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      for (const file of Array.from(files)) {
        const mimeType = mimeTypeForFile(file);
        if (!mimeType) {
          throw new Error(`Формат файла ${file.name} не поддерживается`);
        }
        if (!isImageAttachment(mimeType) && file.size > 1_500_000) {
          throw new Error('Файл должен быть не больше 1,5 МБ');
        }

        const prepared = isImageAttachment(mimeType)
          ? await compressTaskImage(file)
          : {
              name: file.name,
              mimeType: mimeType as NoteImage['mimeType'],
              dataUrl: await readDataUrl(file),
            };
        const saved = await saveNow();
        if (!saved || !noteIdRef.current) return;
        const image = await addNoteImage(noteIdRef.current, {
          name: prepared.name,
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
        });
        setImages((current) => [...current, image]);
        onImagesChanged?.();
      }
    } catch (err) {
      setError(
        toRussianError(err, err instanceof Error ? err.message : 'Не удалось добавить вложение'),
      );
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeImage(image: NoteImage): Promise<void> {
    if (!noteIdRef.current) {
      setImages((current) => current.filter((item) => item.id !== image.id));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      await removeNoteImage(noteIdRef.current, image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
      onImagesChanged?.();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось удалить фото'));
    } finally {
      setUploading(false);
    }
  }

  async function confirmArchive(): Promise<void> {
    if (!noteIdRef.current) return;
    setDeleting(true);
    setError(null);
    try {
      await enqueue(() => updateNote(noteIdRef.current as string, { archived: true }));
      onDeleted();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось удалить заметку'));
      setDeleting(false);
    }
  }

  async function restore(): Promise<void> {
    if (!noteIdRef.current) return;
    try {
      const updated = await enqueue(() =>
        updateNote(noteIdRef.current as string, { archived: false }),
      );
      setArchived(false);
      setUpdatedAt(updated.updatedAt);
      setError(null);
      onSaved(updated);
    } catch (err) {
      setError(toRussianError(err, 'Не удалось вернуть заметку'));
    }
  }

  async function finishEditing(): Promise<void> {
    if (!draftRef.current.title.trim()) {
      setError('Название заметки не может быть пустым.');
      setSaveState('error');
      return;
    }

    const saved = await saveNow();
    if (saved) {
      setError(null);
      setMode('view');
    }
  }

  return (
    <>
      <Drawer
        open
        onClose={() => void attemptClose()}
        title={mode === 'edit' ? 'Изменить заметку' : 'Заметка'}
        titleIcon={mode === 'edit' ? <PencilIcon /> : <NotebookIcon />}
        description={
          mode === 'view'
            ? `Создана ${formatDate(createdAt)} · обновлена ${formatDate(updatedAt)}`
            : 'Измените текст и закройте окно — сохранится автоматически.'
        }
        size="third"
        inert={confirmDelete}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <span role="status" className="text-xs">
              {saveState === 'error' ? (
                <span className="text-red-700">Ошибка сохранения</span>
              ) : showSaving ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700">
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                  Сохранение…
                </span>
              ) : null}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {archived ? (
                <Button variant="secondary" onClick={() => void restore()}>
                  Вернуть
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => {
                    if (noteIdRef.current) setConfirmDelete(true);
                  }}
                  disabled={!noteIdRef.current}
                >
                  <TrashIcon />
                  Удалить
                </Button>
              )}
              {mode === 'view' ? (
                <Button onClick={() => setMode('edit')}>
                  <PencilIcon />
                  Изменить
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => void finishEditing()}>
                  Готово
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          {archived ? <Badge tone="neutral">В архиве</Badge> : null}

          {mode === 'edit' ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Заголовок заметки"
              aria-label="Заголовок заметки"
              className="text-lg font-semibold"
            />
          ) : (
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {title || 'Без названия'}
            </h2>
          )}

          {mode === 'view' ? (
            <NoteMarkdown value={body} />
          ) : (
            <NoteEditor value={body} onChange={setBody} />
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Вложения
              </div>
              {mode === 'edit' ? (
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading || images.length >= 5}
                >
                  {uploading ? 'Загружаю…' : 'Добавить файл'}
                </Button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => void handleFiles(event.target.files)}
            />
            {images.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {images.map((image) => (
                  <div
                    key={image.id}
                    className="relative overflow-hidden rounded-lg border border-zinc-200"
                  >
                    {isImageAttachment(image.mimeType) ? (
                      <button
                        type="button"
                        className="block h-24 w-full"
                        onClick={() =>
                          setViewerIndex(viewerImages.findIndex((item) => item.id === image.id))
                        }
                        aria-label={`Открыть фото ${image.name}`}
                      >
                        <img
                          src={image.dataUrl}
                          alt={image.name}
                          className="h-24 w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="flex h-24 flex-col justify-between p-2">
                        <div className="flex min-w-0 items-start gap-1.5">
                          <FileIcon className="mt-0.5 shrink-0 text-zinc-500" />
                          <span className="min-w-0 truncate text-xs font-medium text-zinc-700">
                            {image.name}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                          <span>{formatBytes(image.sizeBytes)}</span>
                          <a
                            className="text-emerald-800 hover:underline"
                            href={image.dataUrl}
                            download={image.name}
                          >
                            Скачать
                          </a>
                        </div>
                      </div>
                    )}
                    {mode === 'edit' ? (
                      <button
                        type="button"
                        aria-label={`Удалить ${image.name}`}
                        className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-xs text-zinc-700 shadow hover:text-red-700"
                        onClick={() => void removeImage(image)}
                        disabled={uploading}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-zinc-500">Вложений пока нет.</p>
            )}
          </div>

          {mode === 'view' && tagsFromInput(tags).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tagsFromInput(tags).map((tag) => (
                <Badge key={tag} tone="neutral">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}

          {mode === 'edit' ? (
            <label className="block text-sm text-zinc-600">
              Теги (через запятую)
              <Input
                className="mt-1"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="Идея, риск, наблюдение"
              />
            </label>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить заметку?"
        description="Заметка не удалится безвозвратно: она переместится в архив, откуда её можно вернуть."
        confirmAriaLabel="Подтвердить удаление"
        cancelAriaLabel="Отменить удаление"
        busy={deleting}
        error={error}
        onConfirm={() => void confirmArchive()}
        onCancel={() => setConfirmDelete(false)}
      />

      {viewerIndex !== null && viewerImages.length > 0 ? (
        <NoteImageViewer
          images={viewerImages}
          index={viewerIndex}
          onChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </>
  );
}
