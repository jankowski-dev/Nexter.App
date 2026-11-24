import { Select } from '@/components/ui/select';
import { sandboxRunPickerOptions } from './sandbox-selection';
import type { SandboxRunSummary } from '@nexter/contracts';

/**
 * Shared run picker across `Обзор`, `Журнал` and `Отчёты`.
 *
 * Options list non-archived runs only; a deep-linked archived run stays
 * selectable read-only. The status is part of the option label so the owner
 * never has to guess why controls are missing.
 */
export function SandboxRunPicker({
  runs,
  selectedRunId,
  onChange,
  disabled = false,
}: {
  runs: readonly SandboxRunSummary[];
  selectedRunId: string | null;
  onChange: (runId: string) => void;
  disabled?: boolean;
}) {
  const options = sandboxRunPickerOptions(runs, selectedRunId);
  if (options.length === 0) return null;

  return (
    <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
      Запуск
      <Select
        aria-label="Выбор запуска песочницы"
        className="w-full sm:w-80"
        value={selectedRunId ?? ''}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
      >
        {selectedRunId === null ? <option value="">Выберите запуск</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
