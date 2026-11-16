import { Select } from '@/components/ui/select';

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const presets = [
  { value: '09:00', label: '09:00' },
  { value: '12:00', label: '12:00' },
  { value: '18:00', label: '18:00' },
];

function splitTime(value: string): { hour: string; minute: string } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return { hour: '', minute: '' };
  return { hour: match[1] as string, minute: match[2] as string };
}

export function TimeField({
  value,
  onChange,
  disabled = false,
  ariaLabel = 'Время',
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const { hour, minute } = splitTime(value);

  function update(nextHour: string, nextMinute: string) {
    if (!nextHour && !nextMinute) {
      onChange('');
      return;
    }
    onChange(`${nextHour || '00'}:${nextMinute || '00'}`);
  }

  return (
    <div>
      <div className="mt-1 flex items-center gap-1.5" role="group" aria-label={ariaLabel}>
        <Select
          aria-label={`${ariaLabel}: часы`}
          className="h-10 w-[72px]"
          value={hour}
          disabled={disabled}
          onChange={(event) => update(event.target.value, minute)}
        >
          <option value="">--</option>
          {hours.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <span className="text-zinc-400">:</span>
        <Select
          aria-label={`${ariaLabel}: минуты`}
          className="h-10 w-[72px]"
          value={minute}
          disabled={disabled}
          onChange={(event) => update(hour, event.target.value)}
        >
          <option value="">--</option>
          {minutes.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="h-10 rounded-lg px-2 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          onClick={() => onChange('')}
          disabled={disabled || !value}
          title="Убрать время"
        >
          Сбросить
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {presets.map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
              value === preset.value
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : 'border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-800'
            }`}
            onClick={() => onChange(preset.value)}
            disabled={disabled}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
