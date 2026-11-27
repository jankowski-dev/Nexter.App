import { AttachmentsPanel } from '@/components/ui/attachments-panel';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { BookmarkIcon, NotebookIcon, PencilIcon, TrashIcon } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import {
  addNoteImage,
  createNote,
  fetchNote,
  improveNoteText,
  removeNoteImage,
  updateNote,
} from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { compressTaskImage } from '@/lib/image';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSaveFlash } from '@/lib/use-save-flash';
import { useRuntimeSettings } from '../settings/use-settings';
import type { Note, NoteAudio, NoteImage } from '@nexter/contracts';
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

function payloadFrom(note: { title: string; body: string; pinned: boolean }): {
  title: string;
  body: string;
  pinned: boolean;
} {
  return {
    title: note.title.trim(),
    body: note.body,
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
  const runtime = useRuntimeSettings();
  const [mode, setMode] = useState<'view' | 'edit'>(note && !startInEdit ? 'view' : 'edit');
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [images, setImages] = useState<NoteImage[]>(note?.images ?? []);
  const [audio, setAudio] = useState<NoteAudio[]>(note?.audio ?? []);
  const attachments = useQuery({
    queryKey: ['note-attachments', note?.id],
    queryFn: () => fetchNote(note!.id),
    enabled: Boolean(note?.id && note.attachmentCount > note.images.length),
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
  const [improving, setImproving] = useState(false);
  const [improvedOriginal, setImprovedOriginal] = useState<string | null>(null);

  useEffect(() => {
    if (attachments.data) {
      setImages(attachments.data.images);
      setAudio(attachments.data.audio);
    }
  }, [attachments.data]);

  useEffect(() => {
    setImprovedOriginal(null);
    setImproving(false);
  }, [note?.id]);

  const noteIdRef = useRef<string | null>(note?.id ?? null);
  const savedSignatureRef = useRef<string | null>(
    note
      ? JSON.stringify({
          title: note.title,
          body: note.body,
          pinned: note.pinned,
        })
      : null,
  );
  const draftRef = useRef({ title, body, pinned });
  draftRef.current = { title, body, pinned };

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
    }, runtime.autosaveIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [mode, runtime.autosaveIntervalSeconds]);

  async function improveBody(): Promise<void> {
    const current = draftRef.current.body;
    if (!current.trim() || improving) return;
    setImproving(true);
    setError(null);
    try {
      const result = await improveNoteText(current);
      setImprovedOriginal((previous) => previous ?? current);
      setBody(result.text);
    } catch (err) {
      setError(toRussianError(err, 'Не удалось улучшить текст'));
    } finally {
      setImproving(false);
    }
  }

  function revertImproved(): void {
    if (improvedOriginal === null) return;
    setBody(improvedOriginal);
    setImprovedOriginal(null);
  }

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

  async function togglePinned(): Promise<void> {
    const next = !pinned;
    setPinned(next);
    if (!noteIdRef.current) return;
    try {
      const saved = await updateNote(noteIdRef.current, { pinned: next });
      onSaved(saved);
      setError(null);
    } catch (err) {
      setPinned(!next);
      setError(toRussianError(err, 'Не удалось изменить закрепление'));
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
        bodyClassName="flex flex-col"
        inert={confirmDelete}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  if (noteIdRef.current) setConfirmDelete(true);
                }}
                disabled={!noteIdRef.current}
              >
                <TrashIcon />
                Удалить
              </Button>
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
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => void togglePinned()}
                title={pinned ? 'Открепить заметку' : 'Закрепить заметку'}
              >
                <BookmarkIcon filled={pinned} className="h-[18px] w-[18px]" />
                {pinned ? 'Открепить' : 'Закрепить'}
              </Button>
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
        <div className="flex flex-1 flex-col gap-5">
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
            <NoteEditor
              value={body}
              onChange={setBody}
              onImprove={() => void improveBody()}
              onRevert={revertImproved}
              improving={improving}
              canRevert={improvedOriginal !== null}
            />
          )}

          <AttachmentsPanel
            items={images}
            audio={audio}
            editable={mode === 'edit'}
            adding={uploading}
            className="mt-auto"
            onFiles={(files) => void handleFiles(files)}
            onRemove={(image) => void removeImage(image)}
            onOpenImage={(image) => {
              const index = viewerImages.findIndex((item) => item.id === image.id);
              if (index >= 0) setViewerIndex(index);
            }}
          />

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
