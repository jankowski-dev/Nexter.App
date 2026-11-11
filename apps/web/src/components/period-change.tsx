import { LiveValue } from '@/components/ui/live-value';
import { formatPct, pnlTone } from '@/lib/format';

export function PeriodChange({ value }: { value: string | null }) {
  const display = value ? formatPct(value) : '—';

  return (
    <td className={`py-2 pr-3 text-right font-mono tabular-nums ${pnlTone(value)}`}>
      <LiveValue value={display}>{display}</LiveValue>
    </td>
  );
}
