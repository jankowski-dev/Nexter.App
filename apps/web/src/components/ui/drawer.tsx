import { cn } from '@/lib/utils';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { useEffect, useRef, type ReactNode } from 'react';

export function Drawer({
  open,
  onClose,
  title,
  titleIcon,
  description,
  children,
  footer,
  wide = false,
  size,
  inert = false,
  closeDisabled = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  titleIcon?: ReactNode;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  size?: 'md' | 'lg' | 'third';
  inert?: boolean;
  closeDisabled?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useBodyScrollLock(open);

  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  }, [onClose, closeDisabled]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !closeDisabledRef.current) onCloseRef.current();
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

  const resolvedSize = size ?? (wide ? 'lg' : 'md');

  return (
    <div
      className="dialog-overlay-enter fixed inset-0 z-50 bg-zinc-900/30"
      role="presentation"
      aria-hidden={inert || undefined}
      inert={inert || undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'drawer-panel-enter ml-auto flex h-full flex-col border-l border-zinc-200 bg-white shadow-2xl outline-none',
          resolvedSize === 'md' && 'w-full max-w-xl',
          resolvedSize === 'lg' && 'w-full max-w-3xl',
          resolvedSize === 'third' && 'w-full sm:w-1/3 sm:min-w-[420px] sm:max-w-[720px]',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-900">
              {titleIcon}
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Закрыть"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
