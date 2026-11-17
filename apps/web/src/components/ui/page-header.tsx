import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
  embedded = false,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  embedded?: boolean;
}) {
  const Heading = embedded ? 'h2' : 'h1';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Heading
          className={
            embedded
              ? 'text-xl font-semibold tracking-tight text-zinc-900'
              : 'text-3xl font-semibold tracking-tight text-zinc-900'
          }
        >
          {title}
        </Heading>
        {subtitle ? (
          <p className={`max-w-3xl text-zinc-500 ${embedded ? 'mt-1 text-xs' : 'mt-1.5 text-sm'}`}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
