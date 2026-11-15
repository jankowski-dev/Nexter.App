import { StrategyIcon } from './strategy-icon';

export function BotIcon({
  icon,
  strategyIcon,
  className = 'h-10 w-10',
  alt = '',
}: {
  icon: string | null | undefined;
  strategyIcon: string;
  className?: string;
  alt?: string;
}) {
  if (icon && /^data:image\/(png|jpeg|webp);base64,/.test(icon)) {
    return (
      <img
        src={icon}
        alt={alt}
        className={`${className} shrink-0 rounded-xl border border-zinc-200 bg-white object-cover`}
      />
    );
  }

  return <StrategyIcon icon={strategyIcon} className={className} />;
}
