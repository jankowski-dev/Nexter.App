# Owner remarks — November 2026

Status: completed 2026-11-16. PR #158 merged as `2351d771`; deployment `6c4620e6-ec63-440b-92c2-553a7a03c469`; bundle `assets/index-9E6BajE_.js`; bot deployment `6c0f99f1-3c95-4fdd-9108-1339aecd2156`.

| #   | Item                                            | Status                                                                                                                             |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Explain the header chain toggle                 | Done: tooltip/aria text and interface settings card clarify that it selects the wallet/execution network, not the portfolio filter |
| 2   | Bot testing inside a modal, remove `/testing`   | Done: `beside` backtest drawer prefilled from the bot form; route and nav removed                                                  |
| 3   | Trailing Stop strategy                          | Done: `trailing_stop` strategy, ADR 0055                                                                                           |
| 4   | Backtest data collection lag / misleading error | Done: specific `BACKTEST_*` codes and messages; provider failures no longer surface as generic `VALIDATION_ERROR`                  |
| 5   | Task time input                                 | Done: hour/minute selects with presets and reset                                                                                   |
| 6   | Average rate difference from market             | Done: percent under `Средний курс` in consolidated cards                                                                           |
| 7   | Viber notifications for tasks                   | Done: bot API + rewritten Nexter.Bot, ADR 0058                                                                                     |
| 8   | System and DB backup approach                   | Recommendation documented in runbooks; production cron/R2 setup remains an owner decision                                          |
| 9   | Auto-lock after 5 minutes idle                  | Done: default 5 minutes, configurable, requires a PIN                                                                              |
| 10  | Settings section for interface/behaviour        | Done: `Настройки → Интерфейс и поведение` (theme, idle lock, wallet chain)                                                         |

## Notes

- No migrations.
- Viber reminder deduplication is process-local; a restart inside the five-minute window can resend one reminder.
- The old standalone `/testing` page is gone; old bookmarks are not redirected.
