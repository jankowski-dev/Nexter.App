import { cn } from '@/lib/utils';

export type NexterLogoState = 'idle' | 'ok' | 'error';

const rays = [
  {
    soft: true,
    transform: 'matrix(-0.792567 0.611508 0.611508 0.792567 53.5035 -3.22378)',
  },
  {
    soft: true,
    x: 192.009,
    y: -3.22378,
    width: 16.0168,
    height: 113.119,
    transform: 'rotate(37.6521 192.009 -3.22378)',
  },
  {
    transform: 'matrix(-1.00105 0 0 1.00105 119.905 77.8612)',
  },
  {
    x: 147.63,
    y: 87.8717,
    width: 16.0168,
    height: 113.119,
  },
  {
    x: 125.607,
    y: 77.8612,
    width: 16.0168,
    height: 113.119,
  },
  {
    transform: 'matrix(-1.00105 0 0 1.00105 97.8821 87.8717)',
  },
  {
    soft: true,
    transform: 'matrix(-0.792567 0.611508 0.611508 0.792567 31.4803 6.78673)',
  },
  {
    soft: true,
    x: 214.032,
    y: 6.78673,
    width: 16.0168,
    height: 113.119,
    transform: 'rotate(37.6521 214.032 6.78673)',
  },
] as const;

export function NexterLogo({
  lit = 0,
  state = 'idle',
  refreshing = false,
  className,
}: {
  lit?: number;
  state?: NexterLogoState;
  refreshing?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={cn(
        'nexter-logo',
        state === 'ok' && 'is-ok',
        state === 'error' && 'is-error',
        refreshing && 'is-refreshing',
        className,
      )}
      viewBox="0 0 246 210"
      role="img"
      aria-label={refreshing ? 'Nexter — синхронизация данных' : 'Nexter'}
    >
      <g>
        {rays.map((ray, index) => (
          <rect
            key={index}
            className={cn(
              'nexter-ray',
              'soft' in ray && ray.soft && 'nexter-ray--soft',
              index < lit && 'is-lit',
            )}
            width={'width' in ray ? ray.width : 16}
            height={'height' in ray ? ray.height : 113}
            x={'x' in ray ? ray.x : undefined}
            y={'y' in ray ? ray.y : undefined}
            rx={8}
            transform={'transform' in ray ? ray.transform : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
