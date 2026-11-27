import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import {
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  FileIcon,
  PaperclipIcon,
  PencilIcon,
  TrashIcon,
  UndoIcon,
} from '@/components/ui/icons';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TimeField } from '@/components/ui/time-field';
import { addTaskImage, createTask, fetchTask, removeTaskImage, updateTask } from '@/lib/api';
import {
  MAX_TASK_ATTACHMENTS,
  MAX_TASK_ATTACHMENT_BYTES,
  TASK_ATTACHMENT_ACCEPT,
  decodedBase64Bytes,
  formatBytes,
  isImageMime,
  mimeTypeForFile,
  readDataUrl,
} from '@/lib/attachments';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { compressTaskImage } from '@/lib/image';
import { formatTaskDue, localDateKey } from '@/lib/tasks';
import { useSaveFlash } from '@/lib/use-save-flash';
import { useRuntimeSettings } from '../settings/use-settings';
import { useEffect, useRef, useState } from 'react';
import type { Task, TaskCreateRequest, TaskImage, TaskStatus } from '@nexter/contracts';

const priorityLabels: Record<number, string> = {
  0: 'Низкий',
  1: 'Обычный',
  2: 'Высокий',
  3: 'Критичный',
};

const statusLabels: Record<TaskStatus, string> = {
  open: 'Открыта',
  done: 'Выполнена',
  cancelled: 'Отменена',
};

const statusTones: Record<TaskStatus, 'neutral' | 'success' | 'info'> = {
  open: 'info',
  done: 'success',
  cancelled: 'neutral',
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Mode = 'view' | 'edit';

function dueDate(value: string | null): string {
  return value ? localDateKey(new Date(value)) : '';
}

function dueClock(value: string | null, hasTime: boolean): string {
  if (!value || !hasTime) return '';
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toIsoDate(
  value: string,
  time: string,
  hasTime: boolean,
  defaultTime = '12:00',
): string | null {
  return value
    ? new Date(`${value}T${hasTime && time ? time : defaultTime}:00`).toISOString()
    : null;
}

function dueLabel(value: string, time: string, hasTime: boolean, defaultTime = '12:00'): string {
  if (!value) return 'Без срока';
  return formatTaskDue(
    new Date(`${value}T${hasTime && time ? time : defaultTime}:00`).toISOString(),
    hasTime && Boolean(time),
  );
}

export function TaskDialog({
  task,
  duplicateFrom,
  initialDue,
  startInEdit = false,
  startWithDelete = false,
  onClose,
  onSaved,
  onDeleted,
}: {
  task: Task | null;
  duplicateFrom?: Task;
  initialDue?: string;
  startInEdit?: boolean;
  startWithDelete?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const runtime = useRuntimeSettings();
  const duplicate = !task && Boolean(duplicateFrom);
  const source = task ?? duplicateFrom ?? null;
  const duplicatedDueAt = duplicateFrom?.dueAt
    ? new Date(new Date(duplicateFrom.dueAt).getTime() + 86_400_000).toISOString()
    : null;
  const sourceDueAt = task?.dueAt ?? duplicatedDueAt;
  const [mode, setMode] = useState<Mode>(task && !startInEdit ? 'view' : 'edit');
  const [title, setTitle] = useState(source?.title ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [priority, setPriority] = useState(String(source?.priority ?? 1));
  const [due, setDue] = useState(dueDate(sourceDueAt) || initialDue || '');
  const [dueHasTime, setDueHasTime] = useState(Boolean(source?.dueHasTime));
  const [dueTimeValue, setDueTimeValue] = useState(
    dueClock(sourceDueAt, Boolean(source?.dueHasTime)),
  );
  const [status, setStatus] = useState<TaskStatus>(duplicate ? 'open' : (source?.status ?? 'open'));
  const [completedAt, setCompletedAt] = useState<string | null>(
    duplicate ? null : (source?.completedAt ?? null),
  );
  const [createdAt, setCreatedAt] = useState<string | null>(task?.createdAt ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(task?.updatedAt ?? null);
  const [images, setImages] = useState<TaskImage[]>(task?.images ?? []);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const showSaving = useSaveFlash(saveState);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(startWithDelete && Boolean(task));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const taskIdRef = useRef<string | null>(task?.id ?? null);
  const savedSignatureRef = useRef<string | null>(
    task
      ? JSON.stringify({
          title: task.title,
          description: task.description,
          priority: task.priority,
          dueAt: task.dueAt,
          dueHasTime: task.dueHasTime,
        })
      : null,
  );
  const draftRef = useRef({
    title,
    description,
    priority,
    due,
    dueTime: dueTimeValue,
    dueHasTime,
  });
  draftRef.current = {
    title,
    description,
    priority,
    due,
    dueTime: dueTimeValue,
    dueHasTime,
  };

  function basePayload(draft: typeof draftRef.current): {
    title: string;
    description: string | null;
    priority: number;
    dueAt: string | null;
    dueHasTime: boolean;
  } {
    return {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      priority: Number.parseInt(draft.priority, 10) || 0,
      dueAt: toIsoDate(draft.due, draft.dueTime, draft.dueHasTime, runtime.taskDefaultDueTime),
      dueHasTime: Boolean(draft.due && draft.dueHasTime),
    };
  }

  async function runSave(): Promise<boolean> {
    const draft = draftRef.current;
    const trimmed = draft.title.trim();

    if (!trimmed) {
      if (taskIdRef.current) {
        setError('Название задачи не может быть пустым.');
        setSaveState('error');
        return false;
      }
      return true;
    }

    if (images.length > MAX_TASK_ATTACHMENTS) {
      setError(`Не больше ${MAX_TASK_ATTACHMENTS} файлов на задачу.`);
      setSaveState('error');
      return false;
    }

    const payload = basePayload(draft);
    const signature = JSON.stringify(payload);

    if (signature === savedSignatureRef.current) {
      setSaveState('saved');
      return true;
    }

    setSaveState('saving');
    setError(null);

    try {
      const saved = taskIdRef.current
        ? await updateTask(taskIdRef.current, payload)
        : await createTask(payload satisfies TaskCreateRequest);

      taskIdRef.current = saved.id;
      savedSignatureRef.current = signature;
      setStatus(saved.status);
      setCompletedAt(saved.completedAt);
      setCreatedAt(saved.createdAt);
      setUpdatedAt(saved.updatedAt);
      setSaveState('saved');
      onSaved();
      return true;
    } catch (err) {
      setSaveState('error');
      setError(toRussianError(err, 'Не удалось сохранить задачу'));
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
      if (mode === 'edit' && taskIdRef.current) void saveNowRef.current();
    }, runtime.autosaveIntervalSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [mode, runtime.autosaveIntervalSeconds]);

  useEffect(() => {
    const id = task?.id;
    if (!id) return;
    if ((task.attachmentCount ?? task.images.length) <= task.images.length) return;

    let cancelled = false;
    void fetchTask(id)
      .then((detail) => {
        if (!cancelled) setImages(detail.images);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [task?.id, task?.attachmentCount, task?.images.length]);

  async function attemptClose(): Promise<void> {
    if (mode === 'view') {
      onClose();
      return;
    }

    if (!draftRef.current.title.trim() && taskIdRef.current) {
      setError('Название задачи не может быть пустым.');
      setSaveState('error');
      return;
    }

    const saved = await saveNow();
    if (saved) onClose();
  }

  async function finishEditing(): Promise<void> {
    if (!draftRef.current.title.trim()) {
      setError('Введите название задачи.');
      setSaveState('error');
      return;
    }

    const saved = await saveNow();
    if (saved) {
      setError(null);
      setMode('view');
    }
  }

  async function createAndClose(): Promise<void> {
    if (!draftRef.current.title.trim()) {
      setError('Введите название задачи.');
      setSaveState('error');
      return;
    }

    const saved = await saveNow();
    if (saved) {
      setError(null);
      onClose();
    }
  }

  async function toggleStatus(): Promise<void> {
    const saved = taskIdRef.current ? true : await saveNow();
    if (!saved || !taskIdRef.current) return;

    const next = status === 'done' ? 'open' : 'done';
    try {
      const updated = await updateTask(taskIdRef.current, { status: next, applyToSeries: false });
      setStatus(updated.status);
      setCompletedAt(updated.completedAt);
      setUpdatedAt(updated.updatedAt);
      setError(null);
      onSaved();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось изменить задачу'));
    }
  }

  async function confirmArchive(): Promise<void> {
    if (!taskIdRef.current) return;
    setDeleting(true);
    setError(null);
    try {
      await updateTask(taskIdRef.current, { archived: true });
      onDeleted();
      onClose();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось удалить задачу'));
      setDeleting(false);
    }
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    if (!draftRef.current.title.trim()) {
      setError('Сначала укажите название задачи.');
      return;
    }

    if (images.length + files.length > MAX_TASK_ATTACHMENTS) {
      setError(`Не больше ${MAX_TASK_ATTACHMENTS} файлов на задачу.`);
      return;
    }

    setUploading(true);
    setError(null);

    try {
      for (const file of Array.from(files)) {
        const mimeType = mimeTypeForFile(file);
        if (!mimeType) {
          throw new Error(`Формат файла ${file.name} не поддерживается.`);
        }

        let prepared: { name: string; mimeType: string; dataUrl: string; sizeBytes: number };
        if (isImageMime(mimeType)) {
          const image = await compressTaskImage(file);
          prepared = { ...image, mimeType: image.mimeType };
        } else {
          if (file.size > MAX_TASK_ATTACHMENT_BYTES) {
            throw new Error(`Файл ${file.name} больше 1,5 МБ.`);
          }
          const dataUrl = await readDataUrl(file);
          prepared = {
            name: file.name,
            mimeType,
            dataUrl,
            sizeBytes: decodedBase64Bytes(dataUrl),
          };
        }

        if (prepared.sizeBytes > MAX_TASK_ATTACHMENT_BYTES) {
          throw new Error(`Файл ${prepared.name} больше 1,5 МБ.`);
        }

        const saved = await saveNow();
        if (!saved || !taskIdRef.current) return;

        const image = await addTaskImage(taskIdRef.current, {
          name: prepared.name,
          mimeType: prepared.mimeType as TaskImage['mimeType'],
          dataUrl: prepared.dataUrl,
        });
        setImages((current) => [...current, image]);
        onSaved();
      }
    } catch (err) {
      setError(
        toRussianError(err, err instanceof Error ? err.message : 'Не удалось добавить файл'),
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveImage(image: TaskImage): Promise<void> {
    if (!taskIdRef.current) {
      setImages((current) => current.filter((item) => item.id !== image.id));
      return;
    }

    setUploading(true);
    setError(null);

    try {
      await removeTaskImage(taskIdRef.current, image.id);
      setImages((current) => current.filter((item) => item.id !== image.id));
      onSaved();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось удалить файл'));
    } finally {
      setUploading(false);
    }
  }

  const persisted = Boolean(taskIdRef.current);
  const overdue =
    status === 'open' &&
    (dueTimeValue
      ? Boolean(due) && new Date(`${due}T${dueTimeValue}:00`).getTime() < Date.now()
      : Boolean(due) && due < localDateKey(new Date()));

  return (
    <>
      <Drawer
        open
        onClose={() => void attemptClose()}
        title={mode === 'edit' ? (persisted ? 'Изменить задачу' : 'Новая задача') : 'Задача'}
        titleIcon={mode === 'edit' ? <PencilIcon /> : <ClipboardIcon />}
        description={
          mode === 'view'
            ? `Создана ${formatDate(createdAt)} · обновлена ${formatDate(updatedAt)}`
            : 'Изменения сохраняются автоматически каждые 10 секунд и при закрытии.'
        }
        size="third"
        inert={confirmDelete}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {persisted ? (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <TrashIcon />
                  Удалить
                </Button>
              ) : null}
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
              {persisted ? (
                <Button
                  variant={status === 'done' ? 'secondary' : 'ghost'}
                  onClick={() => void toggleStatus()}
                >
                  {status === 'done' ? <UndoIcon /> : <CheckIcon />}
                  {status === 'done' ? 'В работу' : 'Завершить'}
                </Button>
              ) : null}
              {mode === 'view' ? (
                <Button onClick={() => setMode('edit')}>
                  <PencilIcon />
                  Изменить
                </Button>
              ) : persisted ? (
                <Button variant="secondary" onClick={() => void finishEditing()}>
                  Готово
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={onClose}>
                    Отмена
                  </Button>
                  <Button onClick={() => void createAndClose()}>Создать</Button>
                </>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-5 [&_input]:text-[15px] [&_select]:text-[15px] [&_textarea]:text-[15px]">
          {mode === 'view' ? (
            <>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
                  {title || 'Без названия'}
                </h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={statusTones[status]}>{statusLabels[status]}</Badge>
                  <Badge tone={Number(priority) >= 2 ? 'warning' : 'neutral'}>
                    {priorityLabels[Number(priority)] ?? 'Обычный'}
                  </Badge>
                  {overdue ? <Badge tone="danger">Просрочена</Badge> : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                <div className="flex items-center gap-2">
                  <CalendarIcon />
                  <span>{dueLabel(due, dueTimeValue, dueHasTime, runtime.taskDefaultDueTime)}</span>
                </div>
                {completedAt ? <div>Выполнена {formatDate(completedAt)}</div> : null}
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Описание
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[15px] text-zinc-700">
                  {description || 'Описание не заполнено.'}
                </p>
              </div>

              {images.length > 0 ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Файлы
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {images
                      .filter((image) => isImageMime(image.mimeType))
                      .map((image) => (
                        <img
                          key={image.id}
                          src={image.dataUrl}
                          alt={image.name}
                          className="h-24 w-full rounded-lg border border-zinc-200 object-cover"
                        />
                      ))}
                  </div>
                  <div className="mt-2 space-y-2">
                    {images
                      .filter((image) => !isImageMime(image.mimeType))
                      .map((image) => (
                        <a
                          key={image.id}
                          href={image.dataUrl}
                          download={image.name}
                          className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 transition hover:border-emerald-300 hover:text-emerald-800"
                        >
                          <FileIcon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{image.name}</span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {formatBytes(image.sizeBytes)}
                          </span>
                        </a>
                      ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="block text-sm text-zinc-600">
                Название
                <Input
                  className="mt-1"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Проверить позицию BASED"
                />
              </label>

              <div className="space-y-3">
                <div>
                  <div className="text-sm text-zinc-600">Приоритет</div>
                  <div
                    role="radiogroup"
                    aria-label="Приоритет"
                    className="mt-1 grid grid-cols-2 gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 sm:grid-cols-4"
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => {
                      const active = priority === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setPriority(value)}
                          className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'bg-white text-zinc-900 shadow-sm'
                              : 'text-zinc-500 hover:text-zinc-900'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-[190px] max-w-full">
                    <div className="text-sm text-zinc-600">Срок</div>
                    <DatePicker value={due} onChange={setDue} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-600">Время</div>
                    <TimeField
                      value={dueTimeValue}
                      onChange={(value) => {
                        setDueTimeValue(value);
                        setDueHasTime(Boolean(value));
                      }}
                      disabled={!due}
                      ariaLabel="Время задачи"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Время необязательно. Без него задача считается задачей на день.
                </p>
              </div>

              <label className="block text-sm text-zinc-600">
                Описание
                <Textarea
                  className="mt-1 min-h-52 border-0 bg-transparent shadow-none focus:border-0 focus:ring-0"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Детали, ссылки, следующий шаг"
                />
              </label>

              <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-emerald-700">
                      <PaperclipIcon />
                    </span>
                    <div>
                      <div className="text-sm font-medium text-zinc-800">Файлы</div>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        До {MAX_TASK_ATTACHMENTS} файлов, до 1,5 МБ. PDF, таблицы, архивы и
                        изображения.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || images.length >= MAX_TASK_ATTACHMENTS}
                  >
                    {uploading ? 'Загружаю…' : 'Добавить файл'}
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={TASK_ATTACHMENT_ACCEPT}
                  multiple
                  className="hidden"
                  aria-label="Добавить файл"
                  onChange={(event) => void handleFiles(event.target.files)}
                />
                {images.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {images
                        .filter((image) => isImageMime(image.mimeType))
                        .map((image) => (
                          <div
                            key={image.id}
                            className="relative overflow-hidden rounded-lg border border-zinc-200"
                          >
                            <img
                              src={image.dataUrl}
                              alt={image.name}
                              className="h-24 w-full object-cover"
                            />
                            <button
                              type="button"
                              aria-label={`Удалить ${image.name}`}
                              className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-xs text-zinc-700 shadow hover:text-red-700"
                              onClick={() => void handleRemoveImage(image)}
                              disabled={uploading}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                    </div>
                    {images
                      .filter((image) => !isImageMime(image.mimeType))
                      .map((image) => (
                        <div
                          key={image.id}
                          className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700"
                        >
                          <FileIcon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{image.name}</span>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {formatBytes(image.sizeBytes)}
                          </span>
                          <button
                            type="button"
                            aria-label={`Удалить ${image.name}`}
                            className="text-zinc-500 hover:text-red-700"
                            onClick={() => void handleRemoveImage(image)}
                            disabled={uploading}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-white/70 px-3 py-2 text-xs text-zinc-500">
                    <FileIcon className="h-4 w-4 shrink-0" />
                    Пока нет файлов — прикрепите PDF, таблицу, архив или изображение.
                  </div>
                )}
              </div>
            </>
          )}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить задачу?"
        description="Задача не удалится безвозвратно: она переместится в архив, откуда её можно вернуть."
        confirmAriaLabel="Подтвердить удаление задачи"
        cancelAriaLabel="Отменить удаление задачи"
        busy={deleting}
        error={error}
        onConfirm={() => void confirmArchive()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
