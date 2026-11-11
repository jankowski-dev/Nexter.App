import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import {
  CalendarIcon,
  CheckIcon,
  ClipboardIcon,
  PencilIcon,
  TagIcon,
  TrashIcon,
  UndoIcon,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addTaskImage, createTask, removeTaskImage, updateTask } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { compressTaskImage } from '@/lib/image';
import { localDateKey } from '@/lib/tasks';
import { useSaveFlash } from '@/lib/use-save-flash';
import { useEffect, useRef, useState } from 'react';
import type {
  Task,
  TaskCreateRequest,
  TaskImage,
  TaskRecurrence,
  TaskStatus,
} from '@nexter/contracts';

const priorityLabels: Record<number, string> = {
  0: 'Низкий',
  1: 'Обычный',
  2: 'Высокий',
  3: 'Критичный',
};

const recurrenceLabels: Record<TaskRecurrence, string> = {
  daily: 'Ежедневно',
  weekly: 'Еженедельно',
  monthly: 'Ежемесячно',
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
  return value ? value.slice(0, 10) : '';
}

function toIsoDate(value: string): string | null {
  return value ? new Date(`${value}T12:00:00`).toISOString() : null;
}

function tagsFromInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function dueLabel(value: string): string {
  if (!value) return 'Без срока';
  return formatDate(new Date(`${value}T12:00:00`).toISOString());
}

export function TaskDialog({
  task,
  initialDue,
  startInEdit = false,
  startWithDelete = false,
  onClose,
  onSaved,
  onDeleted,
}: {
  task: Task | null;
  initialDue?: string;
  startInEdit?: boolean;
  startWithDelete?: boolean;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [mode, setMode] = useState<Mode>(task && !startInEdit ? 'view' : 'edit');
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState(String(task?.priority ?? 1));
  const [due, setDue] = useState(dueDate(task?.dueAt ?? null) || initialDue || '');
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'open');
  const [completedAt, setCompletedAt] = useState<string | null>(task?.completedAt ?? null);
  const [createdAt, setCreatedAt] = useState<string | null>(task?.createdAt ?? null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(task?.updatedAt ?? null);
  const [archived, setArchived] = useState(Boolean(task?.archivedAt));
  const [recurrence, setRecurrence] = useState<TaskRecurrence | 'none'>(task?.recurrence ?? 'none');
  const [recurrenceEnds, setRecurrenceEnds] = useState('');
  const [images, setImages] = useState<TaskImage[]>(task?.images ?? []);
  const [seriesLocked, setSeriesLocked] = useState(false);
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
          tags: task.tags,
          dueAt: task.dueAt,
        })
      : null,
  );
  const draftRef = useRef({ title, description, priority, due, tags, recurrence, recurrenceEnds });
  draftRef.current = { title, description, priority, due, tags, recurrence, recurrenceEnds };

  function basePayload(draft: typeof draftRef.current): {
    title: string;
    description: string | null;
    priority: number;
    tags: string[];
    dueAt: string | null;
  } {
    return {
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      priority: Number.parseInt(draft.priority, 10) || 0,
      tags: tagsFromInput(draft.tags),
      dueAt: toIsoDate(draft.due),
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

    if (images.length > 5) {
      setError('Не больше 5 картинок на задачу.');
      setSaveState('error');
      return false;
    }

    if (!taskIdRef.current && draft.recurrence !== 'none' && !draft.due) {
      setError('Для повторяющейся задачи укажите первый срок.');
      setSaveState('error');
      return false;
    }

    if (
      draft.recurrenceEnds &&
      (!draft.due || new Date(draft.recurrenceEnds) < new Date(draft.due))
    ) {
      setError('Дата окончания повтора не может быть раньше первого срока.');
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
        : await createTask({
            ...payload,
            ...(draft.recurrence !== 'none'
              ? {
                  recurrence: draft.recurrence,
                  ...(draft.recurrenceEnds
                    ? { recurrenceEndsAt: toIsoDate(draft.recurrenceEnds) }
                    : {}),
                }
              : {}),
          } satisfies TaskCreateRequest);

      taskIdRef.current = saved.id;
      savedSignatureRef.current = signature;
      setStatus(saved.status);
      setCompletedAt(saved.completedAt);
      setCreatedAt(saved.createdAt);
      setUpdatedAt(saved.updatedAt);
      setArchived(Boolean(saved.archivedAt));
      if (draft.recurrence !== 'none') setSeriesLocked(true);
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
      if (mode === 'edit') void saveNowRef.current();
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [mode]);

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
      setError('Название задачи не может быть пустым.');
      setSaveState('error');
      return;
    }

    const saved = await saveNow();
    if (saved) {
      setError(null);
      setMode('view');
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

  async function restore(): Promise<void> {
    if (!taskIdRef.current) return;
    try {
      const updated = await updateTask(taskIdRef.current, { archived: false });
      setArchived(false);
      setUpdatedAt(updated.updatedAt);
      setError(null);
      onSaved();
    } catch (err) {
      setError(toRussianError(err, 'Не удалось вернуть задачу'));
    }
  }

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    if (!draftRef.current.title.trim()) {
      setError('Сначала укажите название задачи.');
      return;
    }

    if (images.length + files.length > 5) {
      setError('Не больше 5 картинок на задачу.');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      for (const file of Array.from(files)) {
        const prepared = await compressTaskImage(file);
        const saved = await saveNow();
        if (!saved || !taskIdRef.current) return;

        const image = await addTaskImage(taskIdRef.current, {
          name: prepared.name,
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
        });
        setImages((current) => [...current, image]);
        onSaved();
      }
    } catch (err) {
      setError(
        toRussianError(err, err instanceof Error ? err.message : 'Не удалось добавить картинку'),
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
      setError(toRussianError(err, 'Не удалось удалить картинку'));
    } finally {
      setUploading(false);
    }
  }

  const effectiveRecurrence = task?.recurrence ?? (recurrence !== 'none' ? recurrence : null);
  const persisted = Boolean(taskIdRef.current);
  const overdue = status === 'open' && Boolean(due) && due < localDateKey(new Date());

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
              ) : persisted ? (
                <Button
                  variant="ghost"
                  className="text-red-700"
                  onClick={() => setConfirmDelete(true)}
                >
                  <TrashIcon />
                  Удалить
                </Button>
              ) : null}
              {persisted && !archived ? (
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
                  {effectiveRecurrence ? (
                    <Badge tone="info">↻ {recurrenceLabels[effectiveRecurrence]}</Badge>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                <div className="flex items-center gap-2">
                  <CalendarIcon />
                  <span>{dueLabel(due)}</span>
                </div>
                {completedAt ? <div>Выполнена {formatDate(completedAt)}</div> : null}
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Описание
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
                  {description || 'Описание не заполнено.'}
                </p>
              </div>

              {tagsFromInput(tags).length > 0 ? (
                <div className="flex items-start gap-1.5 text-sm text-zinc-600">
                  <TagIcon className="mt-0.5" />
                  <span>{tagsFromInput(tags).join(', ')}</span>
                </div>
              ) : null}

              {images.length > 0 ? (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Картинки
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {images.map((image) => (
                      <img
                        key={image.id}
                        src={image.dataUrl}
                        alt={image.name}
                        className="h-24 w-full rounded-lg border border-zinc-200 object-cover"
                      />
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm text-zinc-600">
                  Приоритет
                  <Select
                    className="mt-1"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block text-sm text-zinc-600">
                  Срок
                  <Input
                    className="mt-1"
                    type="date"
                    value={due}
                    onChange={(event) => setDue(event.target.value)}
                  />
                </label>
              </div>

              {persisted ? (
                effectiveRecurrence ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
                    Повтор: {recurrenceLabels[effectiveRecurrence]}. Изменения и удаление
                    применяются ко всей серии; отметка «выполнено» остаётся у каждого дня своя.
                  </div>
                ) : null
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm text-zinc-600">
                    Повтор
                    <Select
                      className="mt-1"
                      value={recurrence}
                      disabled={seriesLocked}
                      onChange={(event) =>
                        setRecurrence(event.target.value as TaskRecurrence | 'none')
                      }
                    >
                      <option value="none">Не повторять</option>
                      {(Object.keys(recurrenceLabels) as TaskRecurrence[]).map((value) => (
                        <option key={value} value={value}>
                          {recurrenceLabels[value]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {recurrence !== 'none' ? (
                    <label className="block text-sm text-zinc-600">
                      Повторять до (необязательно)
                      <Input
                        className="mt-1"
                        type="date"
                        value={recurrenceEnds}
                        min={due || undefined}
                        disabled={seriesLocked}
                        onChange={(event) => setRecurrenceEnds(event.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              )}

              <label className="block text-sm text-zinc-600">
                Описание
                <Textarea
                  className="mt-1 min-h-52"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Детали, ссылки, следующий шаг"
                />
              </label>

              <label className="block text-sm text-zinc-600">
                Теги (через запятую)
                <Input
                  className="mt-1"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  placeholder="Топ, Дашборд, Риск"
                />
              </label>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium text-zinc-700">Картинки</div>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading || images.length >= 5}
                  >
                    {uploading ? 'Загружаю…' : 'Добавить картинку'}
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  aria-label="Добавить картинку"
                  onChange={(event) => void handleFiles(event.target.files)}
                />
                {images.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {images.map((image) => (
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
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">
                    До 5 картинок. Они сжимаются в браузере и хранятся вместе с задачей.
                  </p>
                )}
              </div>
            </>
          )}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {seriesLocked ? <Badge tone="info">Изменения применяются ко всей серии</Badge> : null}
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
