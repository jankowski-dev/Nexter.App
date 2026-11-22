export interface CategoryColorOption {
  value: string;
  label: string;
  dotClassName: string;
}

export const categoryColorOptions: CategoryColorOption[] = [
  { value: 'green', label: 'Зелёный', dotClassName: 'bg-emerald-500' },
  { value: 'red', label: 'Красный', dotClassName: 'bg-red-500' },
  { value: 'orange', label: 'Оранжевый', dotClassName: 'bg-orange-500' },
  { value: 'yellow', label: 'Жёлтый', dotClassName: 'bg-amber-400' },
  { value: 'blue', label: 'Голубой', dotClassName: 'bg-sky-500' },
  { value: 'purple', label: 'Фиолетовый', dotClassName: 'bg-violet-500' },
  { value: 'pink', label: 'Розовый', dotClassName: 'bg-pink-500' },
  { value: 'brown', label: 'Коричневый', dotClassName: 'bg-amber-700' },
  { value: 'gray', label: 'Серый', dotClassName: 'bg-zinc-400' },
];

export const categoryColorClass: Record<string, string> = {
  ...Object.fromEntries(categoryColorOptions.map((option) => [option.value, option.dotClassName])),
  default: 'bg-zinc-300',
};

/**
 * Hex values mirror the Tailwind palette used by `categoryColorClass`. They
 * are needed for SVG segments, where a utility class cannot colour a stroke.
 */
export const categoryColorHex: Record<string, string> = {
  green: '#10b981',
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#fbbf24',
  blue: '#0ea5e9',
  purple: '#8b5cf6',
  pink: '#ec4899',
  brown: '#b45309',
  gray: '#a1a1aa',
  default: '#d4d4d8',
};

/** Colourful fallback for categories that have not picked a palette colour. */
export const categoryFallbackPalette = [
  '#10b981',
  '#0ea5e9',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
] as const;

export function categoryColorLabel(value: string | null | undefined): string {
  return categoryColorOptions.find((option) => option.value === value)?.label ?? 'Серый';
}
