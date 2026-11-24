export class NonJsonValueError extends Error {
  constructor(path: string, detail: string) {
    super(`Non-JSON value at ${path}: ${detail}`);
    this.name = 'NonJsonValueError';
  }
}

/**
 * Rejects values that a JSON round-trip would silently change or drop.
 *
 * Event payloads are hashed through `stableStringify`, so a `Date`, `Map`,
 * `Set`, class instance, function, symbol, bigint, non-finite number or
 * circular reference would either collapse to `undefined`/`{}` or break the
 * canonical form. `undefined` stays allowed on purpose: it normalizes to
 * `null`, which is the Stage 1A round-trip behaviour the golden hashes pin.
 */
export function assertJsonValue(value: unknown, path = '$'): void {
  walk(value, path, new WeakSet<object>());
}

function walk(value: unknown, path: string, seen: WeakSet<object>): void {
  if (value === null || value === undefined) return;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return;
    case 'number':
      if (!Number.isFinite(value)) throw new NonJsonValueError(path, 'non-finite number');
      return;
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new NonJsonValueError(path, `unsupported ${typeof value}`);
    default:
      break;
  }

  const container = value as object;
  if (seen.has(container)) throw new NonJsonValueError(path, 'circular reference');
  seen.add(container);
  try {
    if (Array.isArray(container)) {
      // `forEach`/`map` skip holes, which would let a sparse array through as if
      // the missing slots were absent. JSON serializes a hole as `null`, so walk
      // by index and reject the hole explicitly.
      for (let index = 0; index < container.length; index += 1) {
        if (!(index in container)) {
          throw new NonJsonValueError(`${path}[${index}]`, 'sparse array hole');
        }
        walk(container[index], `${path}[${index}]`, seen);
      }
      return;
    }
    const prototype = Object.getPrototypeOf(container) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new NonJsonValueError(path, `unsupported object type ${describe(container)}`);
    }
    for (const [key, item] of Object.entries(container)) {
      walk(item, `${path}.${key}`, seen);
    }
  } finally {
    // Only cycles are rejected; the same object may appear twice.
    seen.delete(container);
  }
}

function describe(value: object): string {
  return Object.prototype.toString.call(value).slice(8, -1) || 'object';
}
