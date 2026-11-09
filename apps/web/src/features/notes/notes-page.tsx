import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { Textarea } from '@/components/ui/textarea';
import { createNote, fetchNotes, updateNote } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Note } from '@nexter/contracts';

function tagsFromInput(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function NotesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notes = useQuery({
    queryKey: ['notes', search, includeArchived],
    queryFn: () => fetchNotes({ search: search || undefined, includeArchived }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        body,
        tags: tagsFromInput(tags),
        pinned,
      };

      return editing ? updateNote(editing.id, payload) : createNote(payload);
    },
    onSuccess: () => {
      setDialogOpen(false);
      setEditing(null);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось сохранить заметку')),
  });

  const pinMutation = useMutation({
    mutationFn: (note: Note) => updateNote(note.id, { pinned: !note.pinned }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось изменить заметку')),
  });

  const archiveMutation = useMutation({
    mutationFn: (note: Note) => updateNote(note.id, { archived: true }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось архивировать заметку')),
  });

  const restoreMutation = useMutation({
    mutationFn: (note: Note) => updateNote(note.id, { archived: false }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось вернуть заметку')),
  });

  function openCreate() {
    setEditing(null);
    setTitle('');
    setBody('');
    setTags('');
    setPinned(false);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(note: Note) {
    setEditing(note);
    setTitle(note.title);
    setBody(note.body);
    setTags(note.tags.join(', '));
    setPinned(note.pinned);
    setError(null);
    setDialogOpen(true);
  }

  const rows = notes.data?.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Заметки"
        subtitle="Свободные заметки, тезисы и наблюдения. Налоги и учёт не затрагиваются."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 bg-white"
              />
              Архив
            </label>
            <Button onClick={openCreate}>Новая заметка</Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md"
          placeholder="Поиск по заголовку, тексту и тегам"
          aria-label="Поиск по заметкам"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {error && !dialogOpen ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {notes.isPending ? <LoadingRows rows={5} /> : null}
      {notes.isError ? (
        <ErrorState
          message={toRussianError(notes.error, 'Не удалось загрузить заметки')}
          onRetry={() => void notes.refetch()}
        />
      ) : null}

      {!notes.isPending && !notes.isError ? (
        rows.length === 0 ? (
          <Card>
            <CardTitle>Заметок нет</CardTitle>
            <CardDescription>
              Запишите идею, наблюдение или ссылку, чтобы вернуться к ней позже.
            </CardDescription>
            <Button className="mt-4" onClick={openCreate}>
              Новая заметка
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map((note) => (
              <Card key={note.id} className={note.archivedAt ? 'opacity-60' : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-zinc-900">{note.title}</span>
                      {note.pinned ? <Badge tone="info">Закреплена</Badge> : null}
                      {note.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Обновлена {formatDate(note.updatedAt)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-8 px-2 text-xs"
                    onClick={() => pinMutation.mutate(note)}
                    disabled={pinMutation.isPending}
                  >
                    {note.pinned ? 'Открепить' : 'Закрепить'}
                  </Button>
                </div>

                {note.body ? (
                  <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm text-zinc-600">
                    {note.body}
                  </p>
                ) : null}

                {note.tags.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {note.tags.map((tag) => (
                      <Badge key={tag} tone="neutral">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    className="h-8 px-3 text-xs"
                    onClick={() => openEdit(note)}
                  >
                    Изменить
                  </Button>
                  {note.archivedAt ? (
                    <Button
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      onClick={() => restoreMutation.mutate(note)}
                      disabled={restoreMutation.isPending}
                    >
                      Вернуть
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="h-8 px-3 text-xs"
                      onClick={() => {
                        if (window.confirm(`Архивировать заметку «${note.title}»?`)) {
                          archiveMutation.mutate(note);
                        }
                      }}
                      disabled={archiveMutation.isPending}
                    >
                      В архив
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? 'Изменить заметку' : 'Новая заметка'}
        description="Заметки хранятся на сервере в открытом виде и доступны только владельцу."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !title.trim()}
            >
              {saveMutation.isPending ? 'Сохраняю…' : 'Сохранить'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block text-sm text-zinc-600">
            Заголовок
            <Input
              className="mt-1"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Идея по портфелю"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Текст
            <Textarea
              className="mt-1 min-h-40"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Текст заметки"
            />
          </label>
          <label className="block text-sm text-zinc-600">
            Теги (через запятую)
            <Input
              className="mt-1"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="Идея, Риск, Наблюдение"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(event) => setPinned(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 bg-white"
            />
            Закрепить сверху
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}
