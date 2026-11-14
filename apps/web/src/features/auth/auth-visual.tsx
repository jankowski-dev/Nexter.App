import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { NexterLogoState } from '@/components/nexter-logo';

interface AuthVisualContextValue {
  lit: number;
  state: NexterLogoState;
  setLit: (value: number) => void;
  setState: (value: NexterLogoState) => void;
  reset: () => void;
}

const noop = () => undefined;

const AuthVisualContext = createContext<AuthVisualContextValue>({
  lit: 0,
  state: 'idle',
  setLit: noop,
  setState: noop,
  reset: noop,
});

export function AuthVisualProvider({ children }: { children: ReactNode }) {
  const [lit, setLitValue] = useState(0);
  const [state, setStateValue] = useState<NexterLogoState>('idle');

  const value = useMemo<AuthVisualContextValue>(
    () => ({
      lit,
      state,
      setLit: (value) => setLitValue(Math.max(0, Math.min(12, value))),
      setState: setStateValue,
      reset: () => {
        setLitValue(0);
        setStateValue('idle');
      },
    }),
    [lit, state],
  );

  return <AuthVisualContext.Provider value={value}>{children}</AuthVisualContext.Provider>;
}

export function useAuthVisual(): AuthVisualContextValue {
  return useContext(AuthVisualContext);
}
