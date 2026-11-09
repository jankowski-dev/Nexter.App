import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { addTaskImage, createTask, removeTaskImage, updateTask } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { compressTaskImage } from '@/lib/image';
import { useEffect, useRef, useState } from 'react';
import type { Task, TaskCreateRequest, TaskImage, TaskRecurrence } from '@nexter/contracts';

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

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

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

export function TaskDialog({
  task,
  initialDue,
  onClose,
  onSaved,
}: {
  task: Task | null;
  initialDue?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [priority, setPriority] = useState(String(task?.priority ?? 1));
  const [due, setDue] = useState(dueDate(task?.dueAt ?? null) || initialDue || '');
  const [tags, setTags] = useState(task?.tags.join(', ') ?? '');
  const [recurrence, setRecurrence] = useState<TaskRecurrence | 'none'>('none');
  const [recurrenceEnds, setRecurrenceEnds] = useState('');
  const [images, setImages] = useState<TaskImage[]>(task?.images ?? []);
  const [seriesLocked, setSeriesLocked] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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

    if (!trimmed) return true;

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
      if (taskIdRef.current) {
        await updateTask(taskIdRef.current, payload);
      } else {
        const createPayload: TaskCreateRequest = { ...payload };
        if (draft.recurrence !== 'none') {
          createPayload.recurrence = draft.recurrence;
          if (draft.recurrenceEnds) {
            createPayload.recurrenceEndsAt = toIsoDate(draft.recurrenceEnds);
          }
        }
        const created = await createTask(createPayload);
        taskIdRef.current = created.id;
        if (draft.recurrence !== 'none') setSeriesLocked(true);
      }

      savedSignatureRef.current = signature;
      setSaveState('saved');
      onSaved();
      return true;
    } catch (err) {
      setSaveState('error');
      setError(toRussianError(err, 'Не удалось сохранить задачу'));
      return false;
    }
  }

  const saveChainRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true));

  function saveNow(): Promise<boolean> {
    const run = () => runSave();
    const next = saveChainRef.current.then(run, run);
    saveChainRef.current = next.catch(() => false);
    return next;
  }

  saveNowRef.current = saveNow;

  useEffect(() => {
    const timer = window.setInterval(() => {
      void saveNowRef.current();
    }, 10_000);

    return () => window.clearInterval(timer);
  }, []);

  async function attemptClose(): Promise<void> {
    const saved = await saveNow();
    if (saved || !draftRef.current.title.trim()) onClose();
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

  const statusText =
    saveState === 'saving'
      ? 'Сохраняю…'
      : saveState === 'saved'
        ? 'Сохранено'
        : saveState === 'error'
          ? 'Ошибка сохранения'
          : 'Изменения сохраняются автоматически';

  return (
    <Dialog
      open
      onClose={() => void attemptClose()}
      title={task ? 'Изменить задачу' : 'Новая задача'}
      description="Изменения сохраняются автоматически каждые 10 секунд и при закрытии окна."
      size="xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <span
            role="status"
            className={`text-xs ${
              saveState === 'error'
                ? 'text-red-700'
                : saveState === 'saved'
                  ? 'text-emerald-700'
                  : 'text-zinc-500'
            }`}
          >
            {statusText}
          </span>
          <span className="text-xs text-zinc-500">Можно закрыть кликом вне окна</span>
        </div>
      }
    >
      <div className="space-y-4">
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

        {task ? (
          task.recurrence ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-600">
              Повтор: {recurrenceLabels[task.recurrence]}. Изменяется только это вхождение;
              остальные остаются как есть.
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
                onChange={(event) => setRecurrence(event.target.value as TaskRecurrence | 'none')}
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
                  <img src={image.dataUrl} alt={image.name} className="h-24 w-full object-cover" />
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

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {seriesLocked ? (
          <Badge tone="info">Повтор создан; изменения применяются к этому вхождению</Badge>
        ) : null}
      </div>
    </Dialog>
  );
}
