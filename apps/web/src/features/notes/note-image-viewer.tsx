import { Button } from '@/components/ui/button';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { useEffect } from 'react';
import type { NoteImage } from '@nexter/contracts';

export function NoteImageViewer({
  images,
  index,
  onChange,
  onClose,
}: {
  images: NoteImage[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];

  useBodyScrollLock(Boolean(image));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        event.preventDefault();
        onClose();
      }
      if (event.key === 'ArrowLeft' && index > 0) {
        event.stopImmediatePropagation();
        onChange(index - 1);
      }
      if (event.key === 'ArrowRight' && index < images.length - 1) {
        event.stopImmediatePropagation();
        onChange(index + 1);
      }
    }

    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [images.length, index, onChange, onClose]);

  if (!image) return null;

  return (
    <div
      className="dialog-overlay-enter fixed inset-0 z-[70] flex items-center justify-center bg-zinc-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр фото"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        aria-label="Закрыть просмотр"
        className="absolute right-5 top-4 rounded-full bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
        onClick={onClose}
      >
        ✕
      </button>

      {index > 0 ? (
        <Button
          variant="secondary"
          className="absolute left-4 h-10 w-10 rounded-full p-0"
          onClick={() => onChange(index - 1)}
          aria-label="Предыдущее фото"
        >
          ←
        </Button>
      ) : null}

      <img
        src={image.dataUrl}
        alt={image.name}
        className="image-enter max-h-[86vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />

      {index < images.length - 1 ? (
        <Button
          variant="secondary"
          className="absolute right-4 h-10 w-10 rounded-full p-0"
          onClick={() => onChange(index + 1)}
          aria-label="Следующее фото"
        >
          →
        </Button>
      ) : null}

      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
        {index + 1} / {images.length}
      </div>
    </div>
  );
}
