import { Button } from '@/components/ui/button';
import { useEffect, useRef } from 'react';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Удалить',
  cancelLabel = 'Нет',
  confirmAriaLabel,
  cancelAriaLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmAriaLabel?: string;
  cancelAriaLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCancelRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="dialog-overlay-enter fixed inset-0 z-[65] flex items-center justify-center bg-zinc-950/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="dialog-panel-enter w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-zinc-900">{title}</h3>
        <p className="mt-2 text-sm text-zinc-600">{description}</p>
        {error ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="ghost"
            aria-label={cancelAriaLabel ?? cancelLabel}
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="danger"
            aria-label={confirmAriaLabel ?? confirmLabel}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Удаляю…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
