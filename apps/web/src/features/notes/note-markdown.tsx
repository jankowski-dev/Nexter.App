import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useRef, type ClipboardEvent, type ReactNode } from 'react';
import { htmlToMarkdown } from './note-format';

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\((?:https?:\/\/)[^)\s]+\))/g;

function inlineNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const position = match.index ?? 0;
    if (position > last) nodes.push(text.slice(last, position));
    const token = match[0];

    if (token.startsWith('**')) {
      nodes.push(<strong key={`b-${index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={`c-${index}`} className="rounded bg-zinc-100 px-1 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      nodes.push(
        link ? (
          <a
            key={`l-${index}`}
            href={link[2]}
            target="_blank"
            rel="noreferrer noopener"
            className="text-emerald-700 underline underline-offset-2"
          >
            {link[1]}
          </a>
        ) : (
          token
        ),
      );
    } else {
      nodes.push(<em key={`i-${index}`}>{token.slice(1, -1)}</em>);
    }

    last = position + token.length;
    index += 1;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function lineNodes(line: string, index: number): ReactNode {
  if (line.startsWith('### ')) {
    return (
      <h3 key={index} className="mt-4 text-base font-semibold text-zinc-900">
        {inlineNodes(line.slice(4))}
      </h3>
    );
  }
  if (line.startsWith('## ')) {
    return (
      <h2 key={index} className="mt-4 text-lg font-semibold text-zinc-900">
        {inlineNodes(line.slice(3))}
      </h2>
    );
  }
  if (line.startsWith('# ')) {
    return (
      <h1 key={index} className="mt-4 text-xl font-semibold text-zinc-900">
        {inlineNodes(line.slice(2))}
      </h1>
    );
  }
  if (line.startsWith('> ')) {
    return (
      <blockquote key={index} className="border-l-2 border-emerald-300 pl-3 text-zinc-600 italic">
        {inlineNodes(line.slice(2))}
      </blockquote>
    );
  }
  if (line.startsWith('- ')) {
    return (
      <div key={index} className="flex gap-2 text-zinc-700">
        <span className="text-emerald-600">•</span>
        <span>{inlineNodes(line.slice(2))}</span>
      </div>
    );
  }
  if (/^\d+\.\s/.test(line)) {
    return (
      <div key={index} className="flex gap-2 text-zinc-700">
        <span className="text-zinc-400">{line.match(/^\d+/)?.[0]}.</span>
        <span>{inlineNodes(line.replace(/^\d+\.\s/, ''))}</span>
      </div>
    );
  }
  if (!line.trim()) return <div key={index} className="h-2" />;
  return (
    <p key={index} className="whitespace-pre-wrap text-zinc-700">
      {inlineNodes(line)}
    </p>
  );
}

export function NoteMarkdown({ value }: { value: string }) {
  if (!value.trim()) return <p className="text-[15px] text-zinc-500">Заметка пока пустая.</p>;

  return (
    <div className="space-y-1 text-[15px] leading-relaxed">
      {value.split(/\r?\n/).map((line, index) => lineNodes(line, index))}
    </div>
  );
}

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end) || placeholder;
  const value = `${textarea.value.slice(0, start)}${before}${selected}${after}${textarea.value.slice(end)}`;

  return {
    value,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

export function NoteEditor({
  value,
  onChange,
  onImprove,
  onRevert,
  improving = false,
  canRevert = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onImprove?: () => void;
  onRevert?: () => void;
  improving?: boolean;
  canRevert?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(before: string, after: string, placeholder: string): void {
    const textarea = ref.current;
    if (!textarea) return;
    const next = wrapSelection(textarea, before, after, placeholder);
    onChange(next.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const html = event.clipboardData.getData('text/html');
    if (!html.trim()) return;
    const markdown = htmlToMarkdown(html);
    if (!markdown) return;
    const textarea = event.currentTarget;
    event.preventDefault();
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${value.slice(0, start)}${markdown}${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const position = start + markdown.length;
      textarea.setSelectionRange(position, position);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1">
        {[
          ['**', '**', 'жирный', 'B', 'font-semibold'],
          ['*', '*', 'курсив', 'I', 'italic'],
          ['## ', '', 'Заголовок', 'H2', ''],
          ['- ', '', 'пункт', '•', ''],
          ['> ', '', 'цитата', '❝', ''],
          ['`', '`', 'код', '</>', 'font-mono'],
        ].map(([before, after, placeholder, label, className]) => (
          <button
            key={label}
            type="button"
            aria-label={placeholder}
            title={placeholder}
            onClick={() => apply(before, after, placeholder)}
            className={`h-7 min-w-7 rounded-md px-1.5 text-xs text-zinc-600 hover:bg-white hover:text-zinc-900 ${className}`}
          >
            {label}
          </button>
        ))}
        <Button
          type="button"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => apply('[', '](https://)', 'ссылка')}
        >
          Ссылка
        </Button>
        {onImprove ? (
          <Button
            type="button"
            variant="secondary"
            className="ml-auto h-7 px-2 text-xs"
            disabled={improving || !value.trim()}
            onClick={onImprove}
          >
            {improving ? 'Улучшаю…' : 'Улучшить текст'}
          </Button>
        ) : null}
        {canRevert && onRevert ? (
          <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={onRevert}>
            Вернуть исходный
          </Button>
        ) : null}
      </div>
      {canRevert ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-1.5 text-xs text-emerald-800">
          ИИ отредактировал текст. Проверьте его и сохраните или верните исходный вариант.
        </div>
      ) : null}
      <Textarea
        ref={ref}
        className="min-h-[45vh] w-full border-0 bg-transparent font-sans text-[15px] leading-relaxed shadow-none focus:border-0 focus:ring-0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={handlePaste}
        placeholder="Пиши как в журнале: мысли, наблюдения, ссылки, списки…"
        aria-label="Текст заметки"
      />
    </div>
  );
}
