import { cn } from '@/lib/utils';
import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
  size,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: 'md' | 'lg' | 'xl';
}) {
  const resolvedSize = size ?? (wide ? 'lg' : 'md');
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }

    document.addEventListener('keydown', onKeyDown);
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay-enter fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/30 p-0 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'dialog-panel-enter max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-zinc-200 bg-white p-5 shadow-2xl outline-none sm:rounded-xl',
          resolvedSize === 'md' && 'sm:max-w-xl',
          resolvedSize === 'lg' && 'sm:max-w-3xl',
          resolvedSize === 'xl' && 'sm:max-w-5xl',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}
