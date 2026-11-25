import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ReactNode } from 'react';

export function SettingsPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} subtitle={description} />
      {children}
    </div>
  );
}

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {description ? <CardDescription>{description}</CardDescription> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="block text-sm text-zinc-600">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <span className="shrink-0 text-xs text-zinc-500">{suffix}</span> : null}
      </div>
      {hint ? <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm text-zinc-600">
      {label}
      <Input
        className="mt-1"
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <label className="block text-sm text-zinc-600">
      {label}
      <Select
        className="mt-1"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {hint ? <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

export function ToggleField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm text-zinc-700">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

export function SettingsSaveBar({
  pending,
  saved,
  error,
  onSave,
}: {
  pending: boolean;
  saved: boolean;
  error: string | null;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm">
        {error ? <span className="text-red-700">{error}</span> : null}
        {!error && saved ? <span className="text-emerald-700">Сохранено</span> : null}
      </div>
      <Button onClick={onSave} disabled={pending}>
        {pending ? 'Сохраняю…' : 'Сохранить настройки'}
      </Button>
    </div>
  );
}
