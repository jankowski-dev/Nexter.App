import { ApiError } from './api';

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Требуется вход. Войдите заново.',
  INVALID_CREDENTIALS: 'Неверный email или пароль.',
  TOTP_REQUIRED: 'Введите код двухфакторной аутентификации.',
  TOTP_INVALID: 'Неверный код. Попробуйте ещё раз.',
  RATE_LIMITED: 'Слишком много попыток. Подождите и попробуйте снова.',
  VALIDATION_ERROR: 'Проверьте введённые данные.',
  FORBIDDEN: 'Действие запрещено. Обновите страницу и попробуйте снова.',
  NOT_FOUND: 'Запись не найдена.',
  CONFLICT: 'Действие уже выполнено.',
  IMPORT_CONFLICT: 'Импорт конфликтует с уже загруженными данными. Откройте историю импортов.',
  NEGATIVE_BALANCE: 'Импорт привёл бы к отрицательному балансу кошелька.',
  INSUFFICIENT_LOTS: 'Недостаточно лотов для списания.',
  INTERNAL_ERROR: 'Внутренняя ошибка сервера. Попробуйте позже.',
};

const reasonMessages: Record<string, string> = {
  INVALID_SETUP_TOKEN: 'Неверный setup token.',
  ALREADY_INITIALIZED: 'Nexter уже настроен.',
  SETUP_DISABLED: 'Первый запуск отключён на сервере.',
  TOTP_ALREADY_ENABLED: 'Двухфакторная аутентификация уже включена.',
  TOTP_NOT_STARTED: 'Сначала начните настройку двухфакторной аутентификации.',
  TOTP_NOT_ENABLED: 'Двухфакторная аутентификация не включена.',
  TOTP_NOT_CONFIGURED: 'Двухфакторная аутентификация не настроена.',
  TOTP_SETUP_REQUIRED: 'Сначала завершите настройку двухфакторной аутентификации.',
  RECOVERY_CODE_INVALID: 'Неверный recovery code.',
  INVALID_PASSWORD: 'Неверный пароль.',
  AUTH_ENCRYPTION_KEY: 'Сервер не настроен для двухфакторной аутентификации.',
};

function reasonFrom(error: ApiError): string | undefined {
  if (
    typeof error.details === 'object' &&
    error.details !== null &&
    'reason' in error.details &&
    typeof (error.details as { reason?: unknown }).reason === 'string'
  ) {
    return (error.details as { reason: string }).reason;
  }

  return undefined;
}

export function apiErrorReason(error: unknown): string | undefined {
  return error instanceof ApiError ? reasonFrom(error) : undefined;
}

export function toRussianError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const reason = reasonFrom(error);

    if (reason && reasonMessages[reason]) {
      return reasonMessages[reason];
    }

    return messages[error.code] ?? fallback;
  }

  return fallback;
}
