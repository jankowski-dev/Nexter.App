import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListToolbar, TabGroup } from '@/components/ui/list-toolbar';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingRows } from '@/components/ui/states';
import { fetchNotes, updateNote } from '@/lib/api';
import { toRussianError } from '@/lib/error-messages';
import { formatDate } from '@/lib/format';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { Note } from '@nexter/contracts';
import { NotebookIcon, PaperclipIcon, PencilIcon, PinIcon, TrashIcon } from '@/components/ui/icons';
import { NoteDrawer } from './note-drawer';

interface DrawerState {
  note: Note | null;
  startInEdit?: boolean;
  startWithDelete?: boolean;
}

export function NotesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'updated' | 'created'>('updated');
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notes = useInfiniteQuery({
    queryKey: ['notes', search],
    queryFn: ({ pageParam }) =>
      fetchNotes({
        search: search || undefined,
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

  const rows = notes.data?.pages.flatMap((page) => page.data) ?? [];
  const sortedRows = [...rows].sort((left, right) => {
    const field = sort === 'updated' ? 'updatedAt' : 'createdAt';
    return right[field].localeCompare(left[field]);
  });

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

      <ListToolbar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Поиск по заголовку, тексту и тегам"
      >
        <TabGroup
          value={sort}
          onChange={setSort}
          ariaLabel="Сортировка заметок"
          options={[
            { value: 'updated', label: 'По изменению' },
            { value: 'created', label: 'По созданию' },
          ]}
        />
      </ListToolbar>

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
        sortedRows.length === 0 ? (
          <Card>
            <CardTitle>Заметок нет</CardTitle>
            <CardDescription>
              Запишите идею, наблюдение или ссылку, чтобы вернуться к ней позже.
            </CardDescription>
            <Button className="mt-4" onClick={() => setDrawer({ note: null, startInEdit: true })}>
              Новая заметка
            </Button>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedRows.map((note) => (
              <Card
                key={note.id}
                className="flex cursor-pointer flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-emerald-300"
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
                      {note.attachmentCount > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-zinc-500"
                          title={`Вложений: ${note.attachmentCount}`}
                        >
                          <PaperclipIcon className="h-3.5 w-3.5" />
                          {note.attachmentCount}
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
