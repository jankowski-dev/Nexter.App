import { Decimal } from 'decimal.js';

type Token = { type: 'number'; value: Decimal } | { type: 'op'; value: string };

function tokenize(value: string): Token[] | null {
  const normalized = value.replace(/,/g, '.');
  if (!/^[0-9.+\-*/()]+$/.test(normalized)) return null;

  const tokens: Token[] = [];
  let index = 0;

  while (index < normalized.length) {
    const char = normalized[index] as string;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let end = index;
      while (end < normalized.length && /[0-9.]/.test(normalized[end] as string)) end += 1;
      const raw = normalized.slice(index, end);
      if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
      tokens.push({ type: 'number', value: new Decimal(raw) });
      index = end;
      continue;
    }

    if ('+-*/()'.includes(char)) {
      tokens.push({ type: 'op', value: char });
      index += 1;
      continue;
    }

    return null;
  }

  return tokens;
}

function toRpn(tokens: Token[]): Token[] | null {
  const output: Token[] = [];
  const stack: Token[] = [];
  const precedence: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  let previous: Token | null = null;

  for (const token of tokens) {
    if (token.type === 'number') {
      output.push(token);
    } else if (token.value === '(') {
      stack.push(token);
    } else if (token.value === ')') {
      while (stack.length > 0 && stack[stack.length - 1]?.value !== '(') {
        const popped = stack.pop();
        if (popped) output.push(popped);
      }
      if (stack.pop()?.value !== '(') return null;
    } else {
      const unary =
        (token.value === '-' || token.value === '+') &&
        (previous === null ||
          (previous.type === 'op' && previous.value !== ')') ||
          (previous.type === 'op' && previous.value === ')'));
      if (unary) {
        output.push({ type: 'number', value: new Decimal(0) });
      }

      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (!top || top.type !== 'op' || top.value === '(') break;
        if ((precedence[top.value] ?? 0) < (precedence[token.value] ?? 0)) break;
        const popped = stack.pop();
        if (popped) output.push(popped);
      }
      stack.push(token);
    }

    previous = token;
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    if (!popped || popped.value === '(' || popped.value === ')') return null;
    output.push(popped);
  }

  return output;
}

function evaluateRpn(tokens: Token[]): Decimal | null {
  const stack: Decimal[] = [];

  for (const token of tokens) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (!left || !right) return null;

    if (token.value === '+') stack.push(left.plus(right));
    else if (token.value === '-') stack.push(left.minus(right));
    else if (token.value === '*') stack.push(left.times(right));
    else if (token.value === '/') {
      if (right.isZero()) return null;
      stack.push(left.div(right));
    } else {
      return null;
    }
  }

  return stack.length === 1 ? (stack[0] as Decimal) : null;
}

/**
 * Evaluates a small arithmetic expression typed in a money field.
 * Returns null when the input is not a valid expression.
 */
export function evaluateExpression(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const tokens = tokenize(trimmed.replace(/\s+/g, ''));
  if (!tokens || tokens.length === 0) return null;

  const rpn = toRpn(tokens);
  if (!rpn) return null;

  const result = evaluateRpn(rpn);
  if (!result || !result.isFinite()) return null;

  const fixed = result.toFixed(8);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

export function normalizeAmountInput(value: string): string {
  return evaluateExpression(value) ?? '';
}
