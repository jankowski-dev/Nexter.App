export const UNAUTHORIZED_EVENT = 'nexter:unauthorized';

export function notifyUnauthorized(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
