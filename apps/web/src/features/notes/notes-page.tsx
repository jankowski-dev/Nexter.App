import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchNotes, updateNote } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Note } from '@nexter/contracts';
import {
  NotebookIcon,
  PaperclipIcon,
  PencilIcon,
  PinIcon,
  TrashIcon,
  UndoIcon,
} from '@/components/ui/icons';
import { NoteDrawer } from './note-drawer';

interface DrawerState {
  note: Note | null;
  startInEdit?: boolean;
  startWithDelete?: boolean;
}

export function NotesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [archivedOnly, setArchivedOnly] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notes = useInfiniteQuery({
    queryKey: ['notes', search, archivedOnly],
    queryFn: ({ pageParam }) =>
      fetchNotes({
        search: search || undefined,
        archivedOnly,
        limit: 30,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, lastPageParam) =>
      last.hasMore ? lastPageParam + last.data.length : undefined,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
  };

  const pinMutation = useMutation({
    mutationFn: (note: Note) => updateNote(note.id, { pinned: !note.pinned }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось изменить заметку')),
  });

  const restoreMutation = useMutation({
    mutationFn: (note: Note) => updateNote(note.id, { archived: false }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(toRussianError(err, 'Не удалось вернуть заметку')),
  });

  const rows = notes.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Заметки"
        subtitle="Журнал идей, наблюдений и ссылок. Открывается как запись, редактируется по желанию."
        actions={
          <Button onClick={() => setDrawer({ note: null, startInEdit: true })}>
            Новая заметка
          </Button>
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
        <div className="ml-auto flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
          <button
            type="button"
            onClick={() => setArchivedOnly(false)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              !archivedOnly
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Актуальные
          </button>
          <button
            type="button"
            onClick={() => setArchivedOnly(true)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              archivedOnly
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-900'
            }`}
          >
            Архивные
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {notes.isPending ? <LoadingRows rows={6} /> : null}
      {notes.isError ? (
        <ErrorState
          message={toRussianError(notes.error, 'Не удалось загрузить заметки')}
          onRetry={() => void notes.refetch()}
        />
      ) : null}

      {!notes.isPending && !notes.isError ? (
        rows.length === 0 ? (
          <Card>
            <CardTitle>{archivedOnly ? 'Архив пуст' : 'Заметок нет'}</CardTitle>
            <CardDescription>
              {archivedOnly
                ? 'Удалённые заметки появятся здесь.'
                : 'Запишите идею, наблюдение или ссылку, чтобы вернуться к ней позже.'}
            </CardDescription>
            {!archivedOnly ? (
              <Button className="mt-4" onClick={() => setDrawer({ note: null, startInEdit: true })}>
                Новая заметка
              </Button>
            ) : null}
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((note) => (
              <Card
                key={note.id}
                className={`flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-emerald-300 ${
                  note.archivedAt ? 'opacity-60' : ''
                }`}
                onClick={() => setDrawer({ note })}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                    <NotebookIcon />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-base font-semibold text-zinc-900">
                        {note.title}
                      </span>
                      {note.pinned ? <Badge tone="info">Закреплена</Badge> : null}
                      {note.archivedAt ? <Badge tone="neutral">Архив</Badge> : null}
                      {note.images.length > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-zinc-500"
                          title={`Вложений: ${note.images.length}`}
                        >
                          <PaperclipIcon className="h-3.5 w-3.5" />
                          {note.images.length}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Создана {formatDate(note.createdAt)} · обновлена {formatDate(note.updatedAt)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className={`h-8 w-8 p-0 ${
                      note.pinned ? 'text-emerald-700' : 'text-zinc-400 hover:text-zinc-700'
                    }`}
                    aria-label={note.pinned ? 'Открепить заметку' : 'Закрепить заметку'}
                    title={note.pinned ? 'Открепить' : 'Закрепить'}
                    onClick={(event) => {
                      event.stopPropagation();
                      pinMutation.mutate(note);
                    }}
                  >
                    <PinIcon filled={note.pinned} />
                  </Button>
                  {note.archivedAt ? (
                    <Button
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      aria-label="Вернуть заметку"
                      title="Вернуть"
                      onClick={(event) => {
                        event.stopPropagation();
                        restoreMutation.mutate(note);
                      }}
                      disabled={restoreMutation.isPending}
                    >
                      <UndoIcon />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="h-8 w-8 p-0 text-zinc-500 hover:text-red-700"
                      aria-label="Удалить заметку"
                      title="Удалить"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDrawer({ note, startWithDelete: true });
                      }}
                    >
                      <TrashIcon />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    aria-label="Изменить заметку"
                    title="Изменить"
                    onClick={(event) => {
                      event.stopPropagation();
                      setDrawer({ note, startInEdit: true });
                    }}
                  >
                    <PencilIcon />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {notes.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            onClick={() => void notes.fetchNextPage()}
            disabled={notes.isFetchingNextPage}
          >
            {notes.isFetchingNextPage ? 'Загружаю…' : 'Загрузить ещё'}
          </Button>
        </div>
      ) : null}

      {drawer ? (
        <NoteDrawer
          note={drawer.note}
          startInEdit={drawer.startInEdit}
          startWithDelete={drawer.startWithDelete}
          onClose={() => setDrawer(null)}
          onSaved={() => invalidate()}
          onImagesChanged={invalidate}
          onDeleted={() => {
            invalidate();
            setDrawer(null);
          }}
        />
      ) : null}
    </div>
  );
}
