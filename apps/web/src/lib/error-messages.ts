import { ApiError } from './api';

export class ClientValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClientValidationError';
  }
}

const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Требуется вход. Войдите заново.',
  INVALID_CREDENTIALS: 'Неверный email или пароль.',
  TOTP_REQUIRED: 'Введите код двухфакторной аутентификации.',
  TOTP_INVALID: 'Неверный код. Попробуйте ещё раз.',
  TOTP_REPLAY: 'Этот код уже использован. Дождитесь следующего и попробуйте снова.',
  RATE_LIMITED: 'Слишком много попыток. Подождите и попробуйте снова.',
  VALIDATION_ERROR: 'Проверьте введённые данные.',
  BACKTEST_INSUFFICIENT_DATA:
    'Недостаточно исторических данных для этого токена. Попробуйте период короче или другой токен.',
  AI_NOT_CONFIGURED: 'ИИ не настроен. Включите модуль и задайте API-ключ в настройках.',
  AI_PROVIDER_ERROR: 'DeepSeek вернул ошибку. Попробуйте позже.',
  AI_RATE_LIMITED: 'DeepSeek временно ограничил запросы. Попробуйте через минуту.',
  AI_UNAUTHORIZED: 'DeepSeek отклонил API-ключ. Проверьте ключ в настройках.',
  AI_INVALID_RESPONSE: 'ИИ вернул ответ в неожиданном формате. Попробуйте ещё раз.',
  BOT_STATIC_LIMIT_SINGLE_TOKEN: 'Для стратегии «Статичный лимит» выберите ровно один токен.',
  BOT_STATIC_LIMIT_PRICES: 'Укажите три положительные цены: стоп ниже цены покупки, тейк выше неё.',
  AUDIO_UNSUPPORTED: 'Этот формат аудио не поддерживается.',
  AUDIO_TOO_LARGE:
    'Аудио больше допустимого размера. Увеличьте лимит в настройках ИИ или отправьте файл короче.',
  SANDBOX_DISABLED: 'Песочница временно выключена на сервере.',
  SANDBOX_RUN_NOT_FOUND: 'Запуск песочницы не найден.',
  SANDBOX_RUN_NOT_DRAFT: 'Изменять и запускать можно только черновик.',
  SANDBOX_RUN_STATE_CHANGED: 'Состояние запуска изменилось. Обновите список и повторите.',
  SANDBOX_RUN_NO_TOKENS: 'Выберите хотя бы один токен для запуска.',
  SANDBOX_RUN_CAPITAL_INVALID: 'Начальный капитал должен быть больше нуля.',
  SANDBOX_RUN_NOT_RUNNING: 'Запуск не работает, действие недоступно.',
  SANDBOX_RUN_NOT_PAUSED: 'Запуск не на паузе, действие недоступно.',
  SANDBOX_RUN_NOT_ACTIVE: 'Остановить можно только работающий или приостановленный запуск.',
  SANDBOX_RUN_NOT_TERMINAL:
    'В архив можно отправить только остановленный запуск или запуск с ошибкой.',
  SANDBOX_RUN_TOKEN_NOT_FOUND: 'Токен не входит в состав этого запуска.',
  SANDBOX_COVERAGE_MISSING:
    'Недостаточно истории 1h для выбранных токенов. Обновите данные и попробуйте снова.',
  SANDBOX_COVERAGE_PARTIAL:
    'История 1h неполная. Запуск возможен только с явным подтверждением сниженной уверенности.',
  SANDBOX_POSITION_NOT_FOUND: 'Открытая позиция по этому токену не найдена.',
  SANDBOX_CLOSE_ALREADY_PENDING: 'Закрытие этой позиции уже запрошено и ждёт следующего бара.',
  SANDBOX_REPORT_NOT_READY:
    'Отчёт пока недоступен: сохранённое состояние не прошло проверку целостности.',
  SANDBOX_TOKEN_NOT_FOUND: 'Токен не найден в песочнице.',
  SANDBOX_TOKEN_DISABLED: 'Токен отключён в песочнице.',
  SANDBOX_TOKEN_EXISTS: 'Этот токен уже добавлен в песочницу.',
  SANDBOX_TOKEN_KEY_INVALID: 'Некорректный ключ токена песочницы.',
  SANDBOX_TOKEN_CONTRACT_MISMATCH: 'Адрес контракта не совпадает с ключом токена.',
  SANDBOX_REPLAY_NOT_FOUND: 'Исторический прогон не найден.',
  SANDBOX_REPLAY_INVALID_STATUS:
    'Действие недоступно для текущего состояния прогона. Обновите список и повторите.',
  SANDBOX_REPLAY_COVERAGE_MISSING:
    'Недостаточно истории 1h для окна прогона. Обновите данные и попробуйте снова.',
  SANDBOX_REPLAY_WINDOW_TOO_SHORT:
    'Полное окно не покрыто. Подтвердите сокращённое окно или обновите данные.',
  SANDBOX_REPLAY_TOKEN_NOT_FOUND: 'Некоторые токены отсутствуют в песочнице.',
  SANDBOX_REPLAY_CAPITAL_INVALID: 'Начальный капитал должен быть больше нуля.',
  SANDBOX_REPLAY_STATE_INVALID: 'Сохранённое состояние прогона повреждено.',
  SANDBOX_REPLAY_NOT_COMPLETED: 'Отчёт доступен только для завершённого прогона.',
  BACKTEST_DATA_UNAVAILABLE:
    'Не удалось получить исторические данные. Попробуйте ещё раз через минуту.',
  FORBIDDEN: 'Действие запрещено. Обновите страницу и попробуйте снова.',
  NOT_FOUND: 'Запись не найдена.',
  CONFLICT: 'Действие уже выполнено.',
  IMPORT_CONFLICT: 'Импорт конфликтует с уже загруженными данными. Откройте историю импортов.',
  NEGATIVE_BALANCE: 'Импорт привёл бы к отрицательному балансу кошелька.',
  INSUFFICIENT_LOTS: 'Недостаточно лотов для списания.',
  TRADE_ASSET_NOT_ALLOWED: 'Покупка доступна только для токенов из группы «Избранное».',
  TRADE_GROUP_REQUIRED: 'Выберите ордер, из которого продаёте.',
  TRADE_GROUP_NOT_FOUND: 'Ордер не найден.',
  TRADE_GROUP_CLOSED: 'Ордер уже закрыт.',
  TRADE_GROUP_ASSET_MISMATCH: 'Ордер относится к другому токену.',
  TRADE_AMOUNT_EXCEEDS_REMAINING: 'Сумма больше остатка по ордеру.',
  TRADE_ACCOUNT_CHAIN_MISMATCH: 'Кошелёк и токен находятся в разных сетях.',
  TRADE_IDEMPOTENCY_CONFLICT:
    'Этот запрос уже был выполнен с другими данными. Обновите форму и повторите.',
  INTERNAL_ERROR: 'Внутренняя ошибка сервера. Попробуйте позже.',
  SWAP_STEP_UP_REQUIRED: 'Для этой суммы нужен свежий код TOTP.',
  SWAP_APPROVAL_REQUIRED: 'Сначала подтвердите approval токена в кошельке.',
  SWAP_INSUFFICIENT_BALANCE: 'На кошельке недостаточно токенов для этой суммы.',
  SWAP_INSUFFICIENT_GAS_BALANCE: 'На кошельке недостаточно нативной монеты (BNB/ETH) для газа.',
  SWAP_DEADLINE_PASSED: 'Срок действия сборки истёк. Запросите новую котировку.',
  SWAP_EXECUTION_DISABLED: 'Исполнение для этой сети выключено на сервере.',
  SWAP_SIMULATION_FAILED: 'Симуляция не прошла. Обновите котировку и попробуйте снова.',
  SWAP_GAS_TOO_HIGH:
    'Стоимость газа выше настроенного лимита. Попробуйте позже или измените сумму.',
  SWAP_GAS_MISSING: 'Провайдер не вернул стоимость газа. Обновите котировку.',
  SWAP_PROVIDER_UNAVAILABLE: 'Провайдер обмена временно недоступен. Попробуйте позже.',
  SWAP_PROVIDER_ERROR: 'Провайдер обмена вернул ошибку. Попробуйте ещё раз через несколько секунд.',
  SWAP_QUOTE_FAILED:
    'Провайдер не смог рассчитать маршрут для этой суммы. Попробуйте другую сумму или пару.',
  SWAP_RATE_LIMITED:
    'Провайдер ограничил частоту запросов. Подождите 10–15 секунд и попробуйте снова.',
  SWAP_DISABLED: 'Свопы временно отключены.',
  SWAP_STATE_INVALID: 'Состояние ордера изменилось. Запросите новую котировку.',
  SWAP_CLOSE_GROUP_NOT_FOUND: 'Одна или несколько выбранных сделок не найдены. Обновите список.',
  SWAP_CLOSE_GROUP_CLOSED: 'Одна из выбранных сделок уже закрыта. Обновите список.',
  SWAP_CLOSE_GROUP_ASSET_MISMATCH:
    'Выбранные сделки относятся к разным токенам. Закрывайте их отдельными группами.',
  SWAP_CLOSE_AMOUNT_MISMATCH: 'Сумма закрытия изменилась. Обновите список сделок и повторите.',
  SWAP_CLOSE_GROUP_CHANGED: 'Остаток по сделке изменился. Обновите список и повторите.',
  SWAP_CLOSE_GROUP_BUSY:
    'По одной из сделок уже есть активный ордер закрытия. Дождитесь его завершения.',
  SWAP_CLOSE_OUTPUT_NOT_CASH: 'Закрытие возможно только в USDC/USDT.',
  SWAP_CLOSE_ASSET_INVALID: 'Этот актив нельзя закрыть через swap.',
  SWAP_APPROVAL_NOT_REQUIRED: 'Разрешение уже не требуется. Продолжайте подпись.',
  SWAP_TOKEN_NOT_ALLOWED: 'Токен не входит в swap allowlist.',
  SWAP_WALLET_NOT_ALLOWED: 'Адрес кошелька не входит в allowlist.',
  SWAP_BUILD_FAILED:
    'Провайдер не смог собрать транзакцию для этого маршрута. Попробуйте другую пару или сумму.',
  SWAP_VALIDATION_FAILED:
    'Сборка не прошла проверку безопасности. Попробуйте другую пару или сумму.',
  SWAP_PRICE_IMPACT_TOO_HIGH:
    'Цена слишком сильно изменится из-за размера суммы. Уменьшите сумму или выберите другую пару.',
  RECONCILIATION_DISABLED: 'Сверка с сетью выключена на сервере.',
  RECONCILIATION_NO_ADDRESSES: 'Сначала добавьте watch-only адрес кошелька.',
  RECONCILIATION_FAILED: 'Не удалось выполнить сверку с сетью. Попробуйте позже.',
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
  SWAP_INSUFFICIENT_GAS_BALANCE: 'На кошельке недостаточно нативной монеты (BNB/ETH) для газа.',
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
  if (error instanceof ClientValidationError) {
    return error.message;
  }

  if (error instanceof ApiError) {
    const reason = reasonFrom(error);

    if (reason && reasonMessages[reason]) {
      return reasonMessages[reason];
    }

    return messages[error.code] ?? fallback;
  }

  return fallback;
}
