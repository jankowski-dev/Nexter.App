import { Input } from '@/components/ui/input';
import { useState, type InputHTMLAttributes } from 'react';
import { evaluateExpression } from '@/lib/expression';

export function ExpressionInput({
  value,
  onChange,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [invalid, setInvalid] = useState(false);

  function commit(): void {
    const evaluated = evaluateExpression(value);
    if (evaluated !== null) {
      setInvalid(false);
      if (evaluated !== value) onChange(evaluated);
      return;
    }

    setInvalid(Boolean(value.trim()) && /[+\-*/()]/.test(value));
  }

  return (
    <div>
      <Input
        {...props}
        type="text"
        inputMode="text"
        value={value}
        className={className}
        aria-invalid={invalid || undefined}
        onBlur={(event) => {
          props.onBlur?.(event);
          commit();
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        onChange={(event) => {
          setInvalid(false);
          onChange(event.target.value);
        }}
      />
      {invalid ? (
        <span className="mt-1 block text-xs text-red-700">
          Проверьте выражение. Можно использовать + − × ÷ и скобки.
        </span>
      ) : null}
    </div>
  );
}
