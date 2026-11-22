# Nexter AI: как устроен исследовательский контур

**Инженерное руководство. Версия 1.3 — 23 ноября 2026.**

Версия 1.3 добавляет settlement после каждого 10-дневного цикла: holdout 45 дней, три цикла по 15 дней, активные и положительные блоки.

Это не руководство пользователя и не описание дашборда. Цель — объяснить, как работает внутренний механизм: откуда берутся свечи, как строится walk-forward, как считается P&L, почему поиск отсеивает варианты, что такое OOS и holdout, как появляется рекомендация и как её проверяет paper-бот. Аналогия — «как устроен двигатель внутреннего сгорания», а не «как выглядит приборная панель».

Система работает **только в рекомендательном режиме**. AI не запускает и не останавливает роботов, не перераспределяет бюджет и не подписывает транзакции. Все действия с деньгами и запуск paper-ботов остаются за владельцем. Приватные ключи и seed-фразы никогда не попадают на сервер.

<div class="callout">
<strong>Главная мысль.</strong> AI-контур — это аналитик и исследователь, а не исполнитель. Он предлагает стратегии и параметры, объясняет метрики и оставляет решение человеку.
</div>

## Содержание

1. Большая картина
2. Данные
3. Исследовательский цикл
4. Вселенная и профиль
5. Генерация вариантов
6. Walk-forward
7. Движок бэктеста
8. Стратегии и индикаторы
9. Воронка поиска
10. Быстрый поисковый движок
11. Фильтры и скоринг
12. Holdout
13. Исполнение на следующей свече
14. Рекомендации
15. Риск-слой
16. Paper-боты
17. Инвалидация
18. Надёжность и безопасность
19. Разобранные примеры
20. Формулы и глоссарий
21. Приложение

<div class="page-break"></div>

## 1. Большая картина

Система состоит из пяти крупных частей.

<figure class="diagram">
<svg viewBox="0 0 920 300" role="img" aria-label="Архитектура Nexter">
<rect x="20" y="30" width="190" height="80" rx="10" fill="#ecfdf5" stroke="#059669"/>
<text x="115" y="60" text-anchor="middle" font-size="16" font-weight="700">Web SPA</text>
<text x="115" y="82" text-anchor="middle" font-size="12">русский UI, USD</text>
<text x="115" y="99" text-anchor="middle" font-size="12">портфель, AI, роботы</text>
<rect x="365" y="30" width="190" height="80" rx="10" fill="#eff6ff" stroke="#2563eb"/>
<text x="460" y="60" text-anchor="middle" font-size="16" font-weight="700">Nest API</text>
<text x="460" y="82" text-anchor="middle" font-size="12">REST, auth, audit</text>
<text x="460" y="99" text-anchor="middle" font-size="12">AI, swap, bots</text>
<rect x="710" y="30" width="190" height="80" rx="10" fill="#f5f3ff" stroke="#7c3aed"/>
<text x="805" y="60" text-anchor="middle" font-size="16" font-weight="700">Postgres</text>
<text x="805" y="82" text-anchor="middle" font-size="12">ledger, candles</text>
<text x="805" y="99" text-anchor="middle" font-size="12">ai_*, bot_*</text>
<rect x="365" y="170" width="190" height="80" rx="10" fill="#fffbeb" stroke="#d97706"/>
<text x="460" y="200" text-anchor="middle" font-size="16" font-weight="700">Worker threads</text>
<text x="460" y="222" text-anchor="middle" font-size="12">поиск вариантов</text>
<text x="460" y="239" text-anchor="middle" font-size="12">6 воркеров</text>
<rect x="20" y="170" width="190" height="80" rx="10" fill="#f8fafc" stroke="#64748b"/>
<text x="115" y="200" text-anchor="middle" font-size="16" font-weight="700">Viber-бот</text>
<text x="115" y="222" text-anchor="middle" font-size="12">напоминания</text>
<text x="115" y="239" text-anchor="middle" font-size="12">аудио-заметки</text>
<line x1="210" y1="70" x2="365" y2="70" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>
<line x1="555" y1="70" x2="710" y2="70" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>
<line x1="460" y1="110" x2="460" y2="170" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>
<line x1="210" y1="210" x2="365" y2="210" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/>
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 1. API — единственная точка записи; воркеры только считают, Viber-бот только читает задачи и присылает заметки.</figcaption>
</figure>

- **Web SPA** — русский интерфейс. Показывает данные, поиск, рекомендации, роботов, задачи, заметки, финансы. Не хранит секретов.
- **Nest API** — авторизация владельца, аудит, ledger, swap-исполнение, AI-контур, paper-боты, фоновые процессы.
- **Postgres** — единственный источник истины: свечи, сделки, лоты, AI-артефакты, рекомендации, роботы, аудит.
- **Worker threads** — CPU-пул внутри API-процесса. Считает бэктесты вариантов; не пишет в базу.
- **Viber-бот** — отдельный процесс: напоминания о задачах и приём аудио-заметок. Не управляет торговлей.

<div class="callout">
<strong>Advisory vs executable.</strong> AI-рекомендация, метрики, near-miss и телеметрия — advisory. Ledger, swap-ордера, подписи и переводы — executable и требуют отдельного подтверждения владельца. Paper-боты исполняются только на виртуальных деньгах.
</div>

## 2. Данные

<figure class="diagram">
<svg viewBox="0 0 920 290" role="img" aria-label="Конвейер данных">
<rect x="20" y="30" width="170" height="64" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="105" y="56" text-anchor="middle" font-size="14" font-weight="700">GeckoTerminal</text>
<text x="105" y="76" text-anchor="middle" font-size="11">пул, OHLCV</text>
<rect x="210" y="30" width="170" height="64" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="295" y="56" text-anchor="middle" font-size="14" font-weight="700">CoinGecko</text>
<text x="295" y="76" text-anchor="middle" font-size="11">история, изменения</text>
<rect x="400" y="30" width="170" height="64" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="485" y="56" text-anchor="middle" font-size="14" font-weight="700">DexScreener</text>
<text x="485" y="76" text-anchor="middle" font-size="11">цена, 24ч</text>
<rect x="590" y="30" width="170" height="64" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="675" y="56" text-anchor="middle" font-size="14" font-weight="700">Binance</text>
<text x="675" y="76" text-anchor="middle" font-size="11">OHLCV fallback</text>
<rect x="330" y="140" width="260" height="70" rx="10" fill="#ecfdf5" stroke="#059669"/>
<text x="460" y="168" text-anchor="middle" font-size="15" font-weight="700">market_candles</text>
<text x="460" y="190" text-anchor="middle" font-size="11">1h / 4h / 1d, source, quality, gaps</text>
<rect x="330" y="235" width="260" height="40" rx="8" fill="#f8fafc" stroke="#64748b"/>
<text x="460" y="260" text-anchor="middle" font-size="12">coverage: ok / partial / stale / missing</text>
<line x1="105" y1="94" x2="370" y2="140" stroke="#334155" stroke-width="2" marker-end="url(#a2)"/>
<line x1="295" y1="94" x2="430" y2="140" stroke="#334155" stroke-width="2" marker-end="url(#a2)"/>
<line x1="485" y1="94" x2="470" y2="140" stroke="#334155" stroke-width="2" marker-end="url(#a2)"/>
<line x1="675" y1="94" x2="550" y2="140" stroke="#334155" stroke-width="2" marker-end="url(#a2)"/>
<line x1="460" y1="210" x2="460" y2="235" stroke="#334155" stroke-width="2" marker-end="url(#a2)"/>
<defs><marker id="a2" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 2. Несколько источников сводятся в один ряд свечей; качество и пропуски сохраняются как метаданные.</figcaption>
</figure>

**Свечи.** `market_candles` хранит `open/high/low/close/volume_usd`, `source` и `quality`. Для AI используются 1h и 4h; 1d — только контекст режима. История ограничена 180 днями; после 45-дневного holdout на поиск остаётся 135 дней, поэтому число фолдов 3–7.

**Качество.** `quality='ok'` — нормальная свеча. `synthetic` означает, что биржа/источник отдал только дневную точку или неполный OHLC. Synthetic-свеча не доказывает внутридневной low/high, поэтому стоп-лосс в бэктесте срабатывает по закрытию, а тейк-профит — по порогу. Это консервативно и не создаёт фиктивных внутридневных сделок.

**Пропуски.** Coverage показывает `syntheticCandles` и `maxGapCandles`. Если данных меньше 140 дней, поиск завершается на шаге данных с понятной ошибкой, а не на середине бэктеста. Пропуски и synthetic — известный риск H6: система их показывает, но не «дорисовывает» рынок.

## 3. Исследовательский цикл

<figure class="diagram">
<svg viewBox="0 0 920 220" role="img" aria-label="Цикл исследования">
<rect x="20" y="60" width="170" height="80" rx="10" fill="#ecfdf5" stroke="#059669"/>
<text x="105" y="92" text-anchor="middle" font-size="15" font-weight="700">Данные</text>
<text x="105" y="114" text-anchor="middle" font-size="11">coverage, 140–180д</text>
<rect x="220" y="60" width="190" height="80" rx="10" fill="#eff6ff" stroke="#2563eb"/>
<text x="315" y="92" text-anchor="middle" font-size="15" font-weight="700">Поиск</text>
<text x="315" y="114" text-anchor="middle" font-size="11">screen → folds → holdout</text>
<rect x="440" y="60" width="190" height="80" rx="10" fill="#f5f3ff" stroke="#7c3aed"/>
<text x="535" y="92" text-anchor="middle" font-size="15" font-weight="700">Рекомендации</text>
<text x="535" y="114" text-anchor="middle" font-size="11">TTL, лимиты, риски</text>
<rect x="660" y="60" width="230" height="80" rx="10" fill="#fffbeb" stroke="#d97706"/>
<text x="775" y="92" text-anchor="middle" font-size="15" font-weight="700">Черновики роботов</text>
<text x="775" y="114" text-anchor="middle" font-size="11">созданы, но не запущены</text>
<line x1="190" y1="100" x2="220" y2="100" stroke="#334155" stroke-width="2" marker-end="url(#a3)"/>
<line x1="410" y1="100" x2="440" y2="100" stroke="#334155" stroke-width="2" marker-end="url(#a3)"/>
<line x1="630" y1="100" x2="660" y2="100" stroke="#334155" stroke-width="2" marker-end="url(#a3)"/>
<defs><marker id="a3" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 3. Один клик запускает четыре шага; старт роботов остаётся ручным.</figcaption>
</figure>

Цикл — это удобная обёртка над поиском. Шаги: `data` → `search` → `recommendations` → `drafts`. Каждый шаг пишет статус, сообщение и процент; цикл можно отменить. При потере прогресса более чем на 10 минут цикл прерывается, жёсткий предел — 90 минут. После рестарта API зависшие шаги помечаются, а не остаются «вечно running».

В `Настройки → ИИ` задаётся дневной лимит циклов (1–200, по умолчанию 20) или `Не ограничивать`; значение хранится в `ai_profiles.model_settings.cycleLimit`. Большой прогон 100k/200k считается одним циклом. При исчерпании лимита API возвращает `429 AI_CYCLE_LIMIT`, а не запускает усечённый поиск.

Поиск выполняется в durable-очереди `ai_jobs`: job захватывается через `FOR UPDATE SKIP LOCKED`, получает heartbeat и при падении процесса возвращается в очередь. Это защищает от потери длинного прогона. Тесты и разработка используют inline-путь.

## 4. Вселенная и профиль

AI-профиль задаёт бюджет, лимиты и расписание. Вселенная — список токенов с разрешёнными таймфреймами. По умолчанию новые AI-токены получают 1h+4h; 1d хранится как контекст, но не участвует в поиске.

Вселенная — это membership-строки `ai_profile_tokens`. Кнопка удаления убирает строку из вселенной и пишет аудит; свечи, артефакты, история поисков, кандидаты и роботы не удаляются. Завершённый прогон в истории скрывается мягко (`summary.hidden`), а активный прогон удалить нельзя (`409 AI_SEARCH_RUN_ACTIVE`).

Профиль ограничивает:

- бюджет AI-роботов;
- число одновременных роботов;
- максимальную долю инвестированного капитала;
- максимальную экспозицию на токен;
- дневной лимит убытка;
- максимальное число черновиков за цикл.

Бюджет — не «cash на бирже», а виртуальный лимит paper-режима. Реальный ledger и реальные свопы живут отдельно и не смешиваются с AI-бюджетом.

## 5. Генерация вариантов

Вариант — это пара `(strategyKey, params)`. Реестр стратегий содержит 12 AI-eligible стратегий; `static_limit` исключён, потому что он ручной и привязан к абсолютным ценам.

Генератор:

- берёт `paramFields` каждой стратегии: min, max, step, integer;
- использует seeded `mulberry32` — один seed даёт один и тот же набор;
- делит бюджет поровну между стратегиями;
- дедуплицирует параметры внутри стратегии;
- проверяет `parseParams` через Zod;
- ограничивает запрос 200 000 вариантами; UI предлагает 100k и 200k.

Поэтому «5 000 вариантов» — это 5 000 исходных предложений. Воронка затем отсеивает часть дешёвыми проверками, а не считает 5 000 полных восьмифолдовых бэктестов вслепую. Для больших прогонов доступны 100k и 200k; если уникальное пространство параметров стратегии исчерпано раньше, генератор вернёт меньше, и артефакт покажет фактическое число.

## 6. Walk-forward

<figure class="diagram">
<svg viewBox="0 0 920 260" role="img" aria-label="Walk-forward и holdout">
<rect x="30" y="70" width="600" height="42" rx="6" fill="#eff6ff" stroke="#2563eb"/>
<text x="330" y="96" text-anchor="middle" font-size="13">180 дней истории: 8 фолдов по 10 дней OOS</text>
<rect x="30" y="130" width="600" height="42" rx="6" fill="#ecfdf5" stroke="#059669"/>
<text x="330" y="156" text-anchor="middle" font-size="13">последние 45 дней — holdout, 3 цикла по 15 дней</text>
<rect x="650" y="70" width="240" height="102" rx="8" fill="#fffbeb" stroke="#d97706"/>
<text x="770" y="96" text-anchor="middle" font-size="13" font-weight="700">Один фолд</text>
<text x="770" y="118" text-anchor="middle" font-size="11">60д train-контекст</text>
<text x="770" y="136" text-anchor="middle" font-size="11">2д purge</text>
<text x="770" y="154" text-anchor="middle" font-size="11">10д OOS + warmup</text>
<line x1="30" y1="185" x2="630" y2="185" stroke="#334155" stroke-width="2"/>
<line x1="30" y1="180" x2="30" y2="190" stroke="#334155" stroke-width="2"/>
<line x1="630" y1="180" x2="630" y2="190" stroke="#334155" stroke-width="2"/>
<text x="30" y="205" font-size="11">старт 180д</text>
<text x="630" y="205" font-size="11">конец поиска</text>
<text x="650" y="205" font-size="11">holdout: 45 дней</text>
</svg>
<figcaption>Рис. 4. Фолды идут по истории; holdout — последние 45 дней и никогда не используется для отбора.</figcaption>
</figure>

Один фолд:

- 60 дней train-контекста (нужны для «медленных» индикаторов);
- 2 дня purge, чтобы не смешивать train и OOS;
- 10 дней OOS;
- warmup до 15 дней / минимум 240 свечей, чтобы stateful-стратегии стартовали «тёплыми».

Для 140–180 дней число фолдов 3–7 (180 дней → 7). Минимум сделок — `max(5, floor(folds))`; минимум положительных фолдов — `max(2, ceil(0.625 * folds))`. Так короткая история не требует невозможного числа сделок.

Holdout — отдельные 45 дней с собственным warmup-префиксом. Он не используется ни для screen, ни для probe, ни для бюджета, ни для локального уточнения. Это единственная финальная проверка. Внутри 45 дней — три цикла по 15 дней: 10 дней теста и 5 дней settlement.

## 7. Движок бэктеста

<figure class="diagram">
<svg viewBox="0 0 920 280" role="img" aria-label="Состояния движка бэктеста">
<rect x="20" y="90" width="150" height="70" rx="10" fill="#f8fafc" stroke="#64748b"/>
<text x="95" y="118" text-anchor="middle" font-size="14" font-weight="700">Cash</text>
<text x="95" y="140" text-anchor="middle" font-size="11">1000 USD</text>
<rect x="230" y="90" width="170" height="70" rx="10" fill="#ecfdf5" stroke="#059669"/>
<text x="315" y="118" text-anchor="middle" font-size="14" font-weight="700">Buy fill</text>
<text x="315" y="140" text-anchor="middle" font-size="11">fee + slippage</text>
<rect x="460" y="90" width="170" height="70" rx="10" fill="#eff6ff" stroke="#2563eb"/>
<text x="545" y="118" text-anchor="middle" font-size="14" font-weight="700">Position</text>
<text x="545" y="140" text-anchor="middle" font-size="11">amount, avg cost</text>
<rect x="690" y="90" width="200" height="70" rx="10" fill="#fffbeb" stroke="#d97706"/>
<text x="790" y="113" text-anchor="middle" font-size="13" font-weight="700">Exit</text>
<text x="790" y="133" text-anchor="middle" font-size="11">TP / SL / strategy / end</text>
<text x="790" y="150" text-anchor="middle" font-size="11">cash + realized P&amp;L</text>
<line x1="170" y1="125" x2="230" y2="125" stroke="#334155" stroke-width="2" marker-end="url(#a4)"/>
<line x1="400" y1="125" x2="460" y2="125" stroke="#334155" stroke-width="2" marker-end="url(#a4)"/>
<line x1="630" y1="125" x2="690" y2="125" stroke="#334155" stroke-width="2" marker-end="url(#a4)"/>
<path d="M790 160 L790 220 L95 220 L95 160" fill="none" stroke="#334155" stroke-width="2" marker-end="url(#a4)"/>
<text x="400" y="245" text-anchor="middle" font-size="11">следующая сделка или конец периода</text>
<defs><marker id="a4" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 5. Деньги, позиция и P&L считаются в Decimal; индикаторы и решения — в native-числах.</figcaption>
</figure>

Движок считает:

- начальный капитал (1000 USD в поиске);
- комиссию 25 bps и слиппедж 10 bps на каждой стороне;
- размер позиции `initialCapital / maxAdds` (или всю сумму для одноуровневых стратегий);
- среднюю цену и `buyCount`;
- стоп-лосс и тейк-профит: synthetic — по закрытию/порогу, real — open/low/high с гэпом;
- принудительное закрытие в конце периода;
- equity curve, максимальную просадку, total return, win rate, profit factor, buy-and-hold.

Деньги всегда Decimal. Это важно: цена, комиссия, размер и P&L не должны «плыть» из-за бинарных дробей. Native-числа используются только там, где не принимаются финансовые решения: индикаторы, сравнения и предварительная оценка.

## 8. Стратегии и индикаторы

В реестре 12 AI-eligible стратегий:

| Стратегия           | Ключ                   | Идея                | Вход                              | Выход                        |
| ------------------- | ---------------------- | ------------------- | --------------------------------- | ---------------------------- |
| Импульсный пробой   | `momentum_breakout`    | SMA + 24ч импульс   | fast > slow и рост ≥ порога       | TP/SL или fast < slow        |
| Возврат к среднему  | `mean_reversion`       | отклонение от SMA   | цена ниже SMA на %                | возврат к SMA, TP/SL         |
| Сетка в диапазоне   | `grid_range`           | ступени ниже якоря  | цена ниже rolling high на шаг     | TP/SL или ступень вверх      |
| Откат в тренде      | `trend_pullback`       | тренд + откат       | fast > slow и откат к fast        | TP/SL или слом тренда        |
| Докупка на просадке | `dca_dip`              | усреднение          | просадка от якоря                 | TP/SL                        |
| Трейлинг-стоп       | `trailing_stop`        | пробой + трейлинг   | пробой rolling high               | hard stop / trailing         |
| Защитная сетка      | `crash_protected_grid` | сетка + crash-режим | ступени ниже HWM                  | TP/SL / crash close / resume |
| Пробой Дончиана     | `donchian_breakout`    | канал               | пробой верхнего канала            | нижний канал, TP/SL          |
| Возврат к Bollinger | `bollinger_reversion`  | полосы              | ниже нижней полосы                | средняя, TP/SL               |
| Выход из сжатия     | `squeeze_breakout`     | сжатие + пробой     | bandwidth ≤ порога и пробой upper | средняя, TP/SL               |
| Неудавшийся пробой  | `failed_breakout`      | ложный пробой       | возврат выше пробитой поддержки   | TP/SL                        |
| Дневная средняя     | `daily_average`        | дневные low/high    | цена ≤ среднего low − буфер       | средний high + буфер, TP/SL  |

Stateful-стратегии (`trailing_stop`, `crash_protected_grid`, `failed_breakout`) прогревают состояние на warmup-свечах без сделок. Иначе HWM/peak/breakdown начинались бы с нуля и первый фолд был бы нечестным.

«Дневная средняя» группирует историю по полным UTC-дням и считает средний (или медианный) low/high за `lookbackDays` (5–60, по умолчанию 20). Вход — цена не выше среднего low минус `entryBufferPct`; выход — не ниже среднего high плюс `exitBufferPct` или TP/SL. `useMedian` переключает среднее на медиану. Неполные дни игнорируются; пока полных дней меньше lookback, стратегия держит позицию. Live-бот загружает по одной котировке в час за период хранения, чтобы накопить полные дни.

## 9. Воронка поиска

<figure class="diagram">
<svg viewBox="0 0 920 300" role="img" aria-label="Воронка поиска">
<rect x="20" y="20" width="880" height="38" rx="6" fill="#eff6ff" stroke="#2563eb"/>
<text x="460" y="44" text-anchor="middle" font-size="14" font-weight="700">100 000 предложений</text>
<rect x="120" y="78" width="680" height="38" rx="6" fill="#ecfdf5" stroke="#059669"/>
<text x="460" y="102" text-anchor="middle" font-size="13">Signal screen: 59 110 (40.9% отсеяно, 0 false negatives)</text>
<rect x="180" y="136" width="560" height="38" rx="6" fill="#f8fafc" stroke="#64748b"/>
<text x="460" y="160" text-anchor="middle" font-size="13">Probe: выключен (терял 18.3% OOS)</text>
<rect x="220" y="194" width="480" height="38" rx="6" fill="#fffbeb" stroke="#d97706"/>
<text x="460" y="218" text-anchor="middle" font-size="13">Full 8 folds: 59 110 (бюджет выключен)</text>
<rect x="300" y="252" width="320" height="38" rx="6" fill="#f5f3ff" stroke="#7c3aed"/>
<text x="460" y="276" text-anchor="middle" font-size="13">OOS 2 987 → holdout 50 → рекомендации</text>
</svg>
<figcaption>Рис. 6. Дешёвые этапы отсеивают только то, что не может пройти, либо помечают контрольную выборку.</figcaption>
</figure>

**Signal screen.** Для стратегий, где реальный вход требует сигнала, считается число входных сигналов по всем фолдам. Если оно меньше минимума сделок, вариант не может пройти — это безопасное необходимое условие. На 200 000 вариантов screen занимает ~115 секунд и отсеивает 40.9%; на 100 000 — ~57 секунд при той же доле. В контрольном пилоте false negatives — 0. Grid/DCA/crash/failed breakout и «Дневная средняя» не скринятся: там докупки, дневные уровни и состояние могут увеличить число входов.

**Probe.** Однофолдовый тест «есть ли хотя бы одна сделка». Он дешёвый, но теряет 18.3% реальных OOS-прошедших; внутри `squeeze_breakout` — 47.8%, потому что в первом фолде может не быть сжатия. Поэтому probe выключен по умолчанию. Воронка поддерживает его для экспериментов и контрольную выборку.

**Бюджет.** Если выживших больше лимита, берётся детерминированная равномерная выборка. После native-движка бюджет выключен по умолчанию: 100k пилот полностью оценил 59 110 выживших за 21.5 минуты на 4 воркерах (22 мс/вариант). Это важно для принципа «без потерь»; на 6 production-воркерах 100k занимает ~15 минут, 200k — ~30 минут.

**Контроль.** Из каждого отсеянного этапа берётся до 50 вариантов и полностью оценивается. Они никогда не становятся рекомендациями; отчёт показывает, сколько прошло бы OOS, и оценку полноты. Это защита от «тихого» отсева хороших кандидатов.

## 10. Быстрый поисковый движок

<figure class="diagram">
<svg viewBox="0 0 920 250" role="img" aria-label="Fast engine и Decimal parity">
<rect x="20" y="50" width="260" height="130" rx="10" fill="#ecfdf5" stroke="#059669"/>
<text x="150" y="78" text-anchor="middle" font-size="15" font-weight="700">Native слой</text>
<text x="150" y="102" text-anchor="middle" font-size="11">SMA, rolling high/low</text>
<text x="150" y="122" text-anchor="middle" font-size="11">Bollinger, band width</text>
<text x="150" y="142" text-anchor="middle" font-size="11">entry / exit / state</text>
<text x="150" y="162" text-anchor="middle" font-size="11">equity, drawdown</text>
<rect x="330" y="50" width="260" height="130" rx="10" fill="#eff6ff" stroke="#2563eb"/>
<text x="460" y="78" text-anchor="middle" font-size="15" font-weight="700">Decimal слой</text>
<text x="460" y="102" text-anchor="middle" font-size="11">cash, position, amount</text>
<text x="460" y="122" text-anchor="middle" font-size="11">cost basis, fills</text>
<text x="460" y="142" text-anchor="middle" font-size="11">fees, slippage</text>
<text x="460" y="162" text-anchor="middle" font-size="11">total return</text>
<rect x="640" y="50" width="250" height="130" rx="10" fill="#fffbeb" stroke="#d97706"/>
<text x="765" y="78" text-anchor="middle" font-size="15" font-weight="700">Ambiguity fallback</text>
<text x="765" y="102" text-anchor="middle" font-size="11">|a-b| ≤ 1e-11</text>
<text x="765" y="122" text-anchor="middle" font-size="11">только этот фолд</text>
<text x="765" y="142" text-anchor="middle" font-size="11">Decimal-движок</text>
<text x="765" y="162" text-anchor="middle" font-size="11">агрегат точный</text>
<line x1="280" y1="115" x2="330" y2="115" stroke="#334155" stroke-width="2" marker-end="url(#a5)"/>
<line x1="590" y1="115" x2="640" y2="115" stroke="#334155" stroke-width="2" marker-end="url(#a5)"/>
<defs><marker id="a5" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 7. Native считает быстро; Decimal отвечает за деньги; спорные сравнения пересчитываются точно.</figcaption>
</figure>

CPU-профиль показал, что 85–90% времени старого движка — Decimal.js: `finalise`, конструктор, `parseDecimal`, `mul`, `plus`, `minus`, `pow`. Индикаторы — ~3%, Zod — ~0.3%. Поэтому массовый поиск переведён на native-числа, а денежная арифметика оставлена в Decimal.

Ключевые решения:

- Все 12 стратегий имеют native-реализацию входа/выхода/состояния.
- Cash, позиция, amount, cost basis и fill считаются в Decimal — иначе полная покупка на весь кэш может «сломаться» на одном ulp.
- Стоп/тейк используют тот же Decimal-коэффициент, что и эталон (`avgCost.mul(1 ± pct / 100)`).
- Сравнение в пределах `1e-11` относительно помечается как спорное; пересчитывается только этот фолд.
- Для «Дневной средней» дневные low/high считаются один раз на фолд, а вход/выход — за O(1): **37 мс/вариант вместо 2.9 с** на Decimal, с точным parity.
- `AI_SEARCH_FAST_ENGINE=0` — полный откат на Decimal.

Проверки: all-strategy parity в `same-close` и `next-open`, включая «Дневную среднюю»; focused daily parity 20/20. Скорость: 25x raw, 7.8x end-to-end. Пилоты: 20k — 11 078 screen survivors, 687 OOS, 517 с; 50k — 27 716 survivors, 641 с full eval, 1 597 OOS, 674 с total на 4 воркерах; 100k — 59 110 full evals, 2 987 OOS, 21.5 мин full, 22.4 мин total на 4 воркерах; 200k generation/screen — 200 000 вариантов за 3.6 с, 118 213 survivors за 115 с, 147 МБ RSS.

## 11. Фильтры и скоринг

После полного OOS варианта проверяются:

1. `trades >= minTrades`;
2. медиана OOS > 0;
3. `positiveFolds >= minPositiveFolds`;
4. максимальная просадка ≤ 20%;
5. худший фолд ≥ −15%.

Policy score = медиана OOS − 0.5 × максимальная просадка. Это не «магическая формула», а способ поставить более устойчивый вариант выше более волатильного при равной доходности.

Фильтры не ослабляются. «Мало сделок» — самый частый отказ; это нормально: стратегия, которая почти не торгует, не может доказать устойчивость.

## 12. Holdout

Holdout — последние 45 дней, отдельно от поиска. Сначала идёт warmup, затем оценка. К финальной проверке допускаются до **50** кандидатов: по одному лучшему от каждой стратегии, затем по второму и так далее (round-robin), остаток добирается по policy score. Так один trend-режим не занимает все слоты.

45 дней делятся на три последовательных цикла по 15 дней: 10 дней теста и 5 дней settlement. В settlement новые входы запрещены; открытые позиции могут выйти по стопам/тейкам/трейлингу, после чего закрываются принудительно. Следующий цикл начинается с нулевой позиции, состояние стратегии сохраняется.

Holdout делится на три блока по 10 дней. Отказ:

- отрицательный общий holdout return;
- holdout drawdown > 20%;
- меньше двух положительных 15-дневных циклов;
- меньше двух циклов с открытой позицией (exposure);
- последний 15-дневный цикл отрицательный;
- policy score ≤ 0 после holdout.

Каждый цикл — 10 дней теста + 5 дней settlement, поэтому открытая минусовая позиция получает время выйти в ноль или плюс. Flat-блоки не считаются успехом: нужен реальный плюс минимум в двух циклах и открытая позиция минимум в двух. Top-50 — компромисс: 50 проверок повышают multiple testing по сравнению с 10, поэтому блок-гейт строже. Holdout не используется для выбора или ранжирования; near-miss показывает варианты, которые прошли OOS, но не прошли финальную проверку.

## 13. Исполнение на следующей свече

<figure class="diagram">
<svg viewBox="0 0 920 230" role="img" aria-label="Next-open execution">
<rect x="40" y="70" width="220" height="70" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="150" y="98" text-anchor="middle" font-size="13" font-weight="700">close i</text>
<text x="150" y="120" text-anchor="middle" font-size="11">сигнал стратегии</text>
<rect x="340" y="70" width="220" height="70" rx="8" fill="#ecfdf5" stroke="#059669"/>
<text x="450" y="98" text-anchor="middle" font-size="13" font-weight="700">open i+1</text>
<text x="450" y="120" text-anchor="middle" font-size="11">fill с fee/slippage</text>
<rect x="640" y="70" width="240" height="70" rx="8" fill="#fffbeb" stroke="#d97706"/>
<text x="760" y="98" text-anchor="middle" font-size="13" font-weight="700">внутри свечи i+1</text>
<text x="760" y="120" text-anchor="middle" font-size="11">SL/TP по low/high</text>
<line x1="260" y1="105" x2="340" y2="105" stroke="#334155" stroke-width="2" marker-end="url(#a6)"/>
<line x1="560" y1="105" x2="640" y2="105" stroke="#334155" stroke-width="2" marker-end="url(#a6)"/>
<defs><marker id="a6" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 8. Решение принимается по закрытию, но исполняется только на следующем открытии — без same-close look-ahead.</figcaption>
</figure>

Audit H5 подтвердил look-ahead: решение и исполнение на одном close. Аблация на gap-фикстуре: 130.44% → 120.78%, DD 9.40 → 10.24, PF 10.92 → 9.62. На 1h-данных эффект меньше, но он односторонний.

Модель:

- сигнал на close `i` попадает в очередь;
- fill на `open[i+1]` с теми же fee/slippage;
- стоп/тейк остаются внутридневными;
- pending исполняется до защитных проверок свечи;
- решение на последней свече игнорируется, позиция закрывается в конце периода;
- гейты `maxAdds`/наличие позиции перепроверяются при исполнении.

AI-поиск и holdout по умолчанию `next-open`. Бэктесты ручных стратегий/PDF пока остаются `same-close` до отдельной перебазировки. Откат: `AI_SEARCH_EXECUTION=same-close` или `execution: "same-close"` в запросе.

## 14. Рекомендации

Рекомендация содержит:

- стратегию и параметры;
- OOS median/mean/worst, DD, trades, positive folds, stability;
- holdout return;
- policy score;
- suggested allocation;
- invalidation rules;
- TTL (срок жизни).

Владелец может принять рекомендацию, отклонить её или создать черновик робота. Черновик **не запускается автоматически**. AI не меняет бюджет, не останавливает роботов и не перераспределяет позиции.

## 15. Риск-слой

Перед созданием черновика проверяется:

- свободные worker slots;
- свободный AI-бюджет;
- максимальная инвестированная доля;
- per-bot allocation;
- per-token exposure.

Если лимит не позволяет, черновик пропускается с причиной. Это не ошибка, а нормальная защита. Риск-слой не «дорисовывает» доходность и не ослабляет лимиты.

## 16. Paper-боты

<figure class="diagram">
<svg viewBox="0 0 920 260" role="img" aria-label="Paper bot runner">
<rect x="20" y="40" width="170" height="70" rx="8" fill="#f8fafc" stroke="#64748b"/>
<text x="105" y="68" text-anchor="middle" font-size="13" font-weight="700">Tick 60s</text>
<text x="105" y="90" text-anchor="middle" font-size="11">advisory lock</text>
<rect x="220" y="40" width="170" height="70" rx="8" fill="#eff6ff" stroke="#2563eb"/>
<text x="305" y="68" text-anchor="middle" font-size="13" font-weight="700">Quote</text>
<text x="305" y="90" text-anchor="middle" font-size="11">свежесть, цена</text>
<rect x="420" y="40" width="170" height="70" rx="8" fill="#ecfdf5" stroke="#059669"/>
<text x="505" y="68" text-anchor="middle" font-size="13" font-weight="700">Decision</text>
<text x="505" y="90" text-anchor="middle" font-size="11">strategy evaluate</text>
<rect x="620" y="40" width="170" height="70" rx="8" fill="#fffbeb" stroke="#d97706"/>
<text x="705" y="68" text-anchor="middle" font-size="13" font-weight="700">Fill</text>
<text x="705" y="90" text-anchor="middle" font-size="11">paper, fee/slippage</text>
<rect x="220" y="150" width="570" height="70" rx="8" fill="#f5f3ff" stroke="#7c3aed"/>
<text x="505" y="178" text-anchor="middle" font-size="13" font-weight="700">Position / equity snapshot / trade &amp; event journal</text>
<text x="505" y="200" text-anchor="middle" font-size="11">owner-only start/stop; invalidation advisory</text>
<line x1="190" y1="75" x2="220" y2="75" stroke="#334155" stroke-width="2" marker-end="url(#a7)"/>
<line x1="390" y1="75" x2="420" y2="75" stroke="#334155" stroke-width="2" marker-end="url(#a7)"/>
<line x1="590" y1="75" x2="620" y2="75" stroke="#334155" stroke-width="2" marker-end="url(#a7)"/>
<line x1="505" y1="110" x2="505" y2="150" stroke="#334155" stroke-width="2" marker-end="url(#a7)"/>
<defs><marker id="a7" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#334155"/></marker></defs>
</svg>
<figcaption>Рис. 9. Paper-бот живёт на виртуальных деньгах; реальные ключи и ledger не участвуют.</figcaption>
</figure>

Бот тикает раз в 60 секунд под advisory lock. Он читает свежие котировки, вызывает стратегию, исполняет paper-fill, обновляет позицию и equity snapshot, пишет trade/event journal. Owner-only start/stop. Если рекомендация истекла или стратегия сломана, бот может быть остановлен/помечен, но автоматического перераспределения нет.

## 17. Инвалидация

Инвалидация — advisory-сигналы:

- drawdown;
- дневной убыток;
- устаревшая котировка;
- стоп/тейк;
- истёкший горизонт;
- отрицательный P&L;
- ошибка бота;
- отсутствующая рекомендация.

Монитор не останавливает бота сам. Он показывает `review`/`stop` и причину; решение остаётся за владельцем.

## 18. Надёжность и безопасность

- Пул БД ограничен; долгие запросы не должны исчерпывать соединения.
- Поиск и цикл можно отменить; stale recovery помечает зависшие шаги.
- `ai_jobs` — durable-очередь с heartbeat и `FOR UPDATE SKIP LOCKED`.
- `audit_log` append-only; приложение не имеет UPDATE/DELETE.
- Бэкапы: PITR + ежедневный шифрованный дамп + off-site retention. RPO 1 час, RTO 4 часа.
- Приватные ключи/seed никогда не на сервере; swap выше $500 требует step-up TOTP.
- CSRF/Origin проверки; production отклоняет отсутствующий Origin/Referer.
- AI-страницы и рекомендации owner-only.
- Health-уведомления ботов имеют кулдаун 6 часов на бота и причину. Повторный `A → B → A` не присылает `A` снова; recovery отправляется только после реально отправленного stop. Живой статус при этом остаётся на странице AI и в read-only health endpoint (ADR 0079).
- Удаление токена из вселенной и скрытие завершённого прогона не удаляют свечи, артефакты, кандидатов и рекомендации; действия пишутся в аудит (ADR 0080).

## 19. Разобранные примеры

**Пример A: 0 рекомендаций.** Токен падал последние 30 дней. Screen отсеял 810 из 5 000; полный OOS прошли 409; top-50 holdout все ушли в минус. Итог — 0. Это не сбой: политика сознательно консервативна. Near-miss показывает, что именно не прошло.

**Пример B: near-miss.** Сетка/докупка дали положительный OOS, но holdout −36% или DD > 90%. Это типичный режимный провал; рекомендацией не становится.

**Пример C: рекомендация.** Вариант прошёл OOS median > 0, 5+ положительных фолдов, DD ≤ 20%, worst ≥ −15%, затем holdout > 0, минимум 2 положительных цикла, минимум 2 активных цикла, последний цикл неотрицателен и policy > 0. Создаётся кандидат с allocation и invalidation rules; черновик робота ждёт ручного старта.

**Пример D: риск-лимит.** Свободных worker slots нет или token exposure уже на максимуме. Черновик пропускается с причиной; это не ошибка поиска.

**Пример E: масштаб.** 50k вариантов: screen 27 716 за 32 с, full 8 folds 641 с на 4 воркерах, 1 597 OOS, 674 с total. На production 6 воркерах ~7.5 минуты. 100k: 59 110 выживших, 2 987 OOS, 21.5 мин full на 4 воркерах (~15 мин на 6). 200k: ровно 200 000 сгенерировано за 3.6 с, 118 213 прошли screen за 115 с; полный прогон ~30 мин на 6 воркерах.

## 20. Формулы и глоссарий

- **Return** = (final equity − initial) / initial × 100.
- **Max drawdown** = max по equity curve от пика до впадины, %.
- **Median OOS** = медиана доходностей фолдов.
- **Stability** = positive folds / folds × 100.
- **Policy score** = median OOS − 0.5 × max drawdown.
- **Fee** = 25 bps на сторону; **slippage** = 10 bps на сторону.
- **Allocation** = min(worker allocation, token exposure cap, free budget).
- **OOS** — out-of-sample, 10-дневный фолд после train/purge.
- **Holdout** — последние 45 дней: три цикла по 10 дней теста + 5 дней settlement, финальная проверка.
- **Near-miss** — прошёл OOS, но не holdout/фильтр; не рекомендация.

## 21. Приложение

**Ключевые файлы.**

- `apps/api/src/modules/ai-trading/ai-search.service.ts` — оркестрация поиска, воронка, holdout.
- `ai-search.evaluate.ts` — fold-агрегация и fast/Decimal dispatch.
- `ai-search.signals.ts` — native-индикаторы и signal screen.
- `ai-search.funnel.ts` — stage/control/recall.
- `ai-search.pool.ts`, `ai-search.worker.ts` — worker pool.
- `ai-fast-backtest.ts`, `ai-fast-strategies.ts`, `ai-fast-compare.ts` — native-движок.
- `apps/api/src/modules/trading-bots/backtest/backtest.engine.ts` — Decimal-движок.
- `apps/api/src/modules/trading-bots/strategies/index.ts` — реестр стратегий.
- `apps/web/src/features/ai-trading/ai-trading-page.tsx` — AI UI.

**Env.**

- `AI_SEARCH_WORKERS` — размер пула (production 6).
- `AI_SEARCH_PROBE_FOLDS` — 0 по умолчанию.
- `AI_SEARCH_FULL_BUDGET` — 0 (без лимита) по умолчанию.
- `AI_SEARCH_CONTROL_SAMPLE` — 50.
- `AI_SEARCH_FAST_ENGINE` — 0 отключает native.
- `AI_SEARCH_EXECUTION` — `next-open` по умолчанию, `same-close` откат.

**ADR.** 0071–0082: AI control center, recommendation-only, Binance fallback, one-click cycle, worker pool, funnel, fast engine, next-open, health-notification cooldown, universe/history deletion, holdout top-50 and 10-day blocks, settlement per cycle and active blocks.

**Аудит.** H1 (holdout warmup) исправлен; H4 (stateful warmup) исправлен; H5 (look-ahead) исправлен next-open; H2 (top-10) заменён диверсифицированным top-50; H2b (граница holdout) исправлен settlement-циклами и active-block gate; H3/H6 (данные/наблюдаемость) — coverage/variantMetrics; H7/H8/H9 — арифметика/генерация/статистика проверены; H10 — 0 рекомендаций статистически правдоподобен. Пороги не ослаблялись.

**Воспроизводимость.** Пилоты: `scripts/ai-staged-pilot.mjs`, `scripts/ai-screen-pilot.mjs`; PDF: `node scripts/docs/build-ai-engineering-guide.mjs`. Секреты и production-данные не используются.
