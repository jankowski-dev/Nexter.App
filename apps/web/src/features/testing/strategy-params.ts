import type { BotStrategyParamField } from '@nexter/contracts';

export function paramsToForm(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, value === null ? '' : String(value)]),
  );
}

export function formToParams(
  fields: BotStrategyParamField[],
  values: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.key];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Поле «${field.label}» должно быть числом.`);
    }
    if (field.integer && !Number.isInteger(parsed)) {
      throw new Error(`Поле «${field.label}» должно быть целым числом.`);
    }
    if (field.min !== undefined && parsed < field.min) {
      throw new Error(`Поле «${field.label}» не может быть меньше ${field.min}.`);
    }
    if (field.max !== undefined && parsed > field.max) {
      throw new Error(`Поле «${field.label}» не может быть больше ${field.max}.`);
    }
    result[field.key] = parsed;
  }
  return result;
}
