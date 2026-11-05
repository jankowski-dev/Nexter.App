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
  SWAP_STEP_UP_REQUIRED: 'Для этой суммы нужен свежий код TOTP.',
  SWAP_APPROVAL_REQUIRED: 'Сначала подтвердите approval токена в кошельке.',
  SWAP_INSUFFICIENT_BALANCE: 'На кошельке недостаточно токенов для этой суммы.',
  SWAP_DEADLINE_PASSED: 'Срок действия сборки истёк. Запросите новую котировку.',
  SWAP_EXECUTION_DISABLED: 'Исполнение выключено на сервере до финального review.',
  SWAP_SIMULATION_FAILED: 'Симуляция не прошла. Обновите котировку и попробуйте снова.',
  SWAP_GAS_TOO_HIGH:
    'Стоимость газа выше настроенного лимита. Попробуйте позже или измените сумму.',
  SWAP_PROVIDER_UNAVAILABLE: 'BSC RPC или провайдер временно недоступен.',
  SWAP_RATE_LIMITED: 'Слишком много запросов к провайдеру. Попробуйте позже.',
  SWAP_DISABLED: 'Свопы временно отключены.',
  SWAP_STATE_INVALID: 'Состояние ордера изменилось. Запросите новую котировку.',
  SWAP_BUILD_FAILED:
    'Провайдер не смог собрать транзакцию для этого маршрута. Попробуйте другую пару или сумму.',
  SWAP_VALIDATION_FAILED:
    'Сборка не прошла проверку безопасности. Попробуйте другую пару или сумму.',
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
  SWAP_SIMPLE_MODE_NOT_ALLOWED:
    'Маршрут использует simple mode Kyber; сейчас он не поддерживается. Попробуйте другую пару или сумму.',
  SWAP_TOKEN_MISMATCH: 'Маршрут не совпал с парой токенов. Обновите котировку.',
  SWAP_RECIPIENT_MISMATCH: 'Получатель в calldata не совпал с кошельком. Обновите котировку.',
  SWAP_AMOUNT_MISMATCH: 'Сумма в calldata не совпала с котировкой. Обновите котировку.',
  SWAP_MIN_OUT_MISMATCH: 'Minimum output в calldata вне допустимых границ. Обновите котировку.',
  SWAP_EXECUTOR_NOT_ALLOWED: 'Executor не входит в allowlist. Обновите котировку.',
  SWAP_APPROVE_TARGET_NOT_ALLOWED: 'Approve target не входит в allowlist. Обновите котировку.',
  SWAP_RECEIVER_MISMATCH: 'Получатели входа не прошли проверку. Обновите котировку.',
  SWAP_FEE_NOT_ALLOWED: 'В маршруте есть неожиданная комиссия. Обновите котировку.',
  SWAP_PERMIT_NOT_ALLOWED: 'Маршрут содержит неподдерживаемый permit.',
  SWAP_PARTIAL_FILL_NOT_ALLOWED: 'Partial-fill маршруты не поддерживаются.',
  SWAP_DEADLINE_INVALID: 'Deadline в calldata не прошёл проверку. Обновите котировку.',
  SWAP_CALLDATA_UNSUPPORTED: 'Kyber вернул неподдерживаемую функцию. Обновите котировку.',
  SWAP_SELECTOR_NOT_ALLOWED: 'Selector не входит в allowlist. Обновите котировку.',
  SWAP_AMOUNT_INVALID: 'Провайдер вернул некорректную сумму.',
  SWAP_TX_VALUE_MISMATCH: 'Transaction value не совпал с ожидаемым.',
  SWAP_GAS_TOO_HIGH: 'Стоимость газа выше настроенного лимита.',
  SWAP_GAS_MISSING: 'Провайдер не вернул стоимость газа.',
  SWAP_INSUFFICIENT_BALANCE: 'На кошельке недостаточно токенов для этой суммы.',
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
