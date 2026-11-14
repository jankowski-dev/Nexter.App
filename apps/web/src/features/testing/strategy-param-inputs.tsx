import { Input } from '@/components/ui/input';
import type { BotStrategyTemplate } from '@nexter/contracts';

export function StrategyParamInputs({
  template,
  values,
  onChange,
}: {
  template: BotStrategyTemplate;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {template.paramFields.map((field) => (
        <label key={field.key} className="block text-sm text-zinc-600">
          {field.label}
          <div className="mt-1 flex items-center gap-2">
            <Input
              type="number"
              min={field.min}
              max={field.max}
              step={field.step ?? (field.integer ? 1 : 'any')}
              value={values[field.key] ?? ''}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
            {field.unit ? <span className="text-xs text-zinc-500">{field.unit}</span> : null}
          </div>
          {field.hint ? (
            <p className="mt-1 text-[11px] leading-4 text-zinc-500">{field.hint}</p>
          ) : null}
        </label>
      ))}
    </div>
  );
}
