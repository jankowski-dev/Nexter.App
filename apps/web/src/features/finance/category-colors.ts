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

export function categoryColorLabel(value: string | null | undefined): string {
  return categoryColorOptions.find((option) => option.value === value)?.label ?? 'Серый';
}
