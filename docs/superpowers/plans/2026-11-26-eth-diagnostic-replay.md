# ETH diagnostic replay implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a research-only ETH/BSC 180-day diagnostic pack: per-bar engine state, a readable PDF chart with numbered bars and action markers, a manual annotation CSV and a join report that explains missed entries/exits.

**Architecture:** Add a pure diagnostics module to `@nexter/sandbox-core` that consumes the existing `runPaperFromCandles` result (`report`, `result`, `events`) and emits JSON/CSV/SVG. Add a thin `apps/api/scripts/replay-diagnostics.mjs` that reads a candle JSONL, runs the existing paper pipeline, writes the artifacts and embeds the SVG pages into a PDF via the API's existing `pdfmake` dependency. No production route, schema or Stage 3 change.

**Tech Stack:** TypeScript strict, Vitest, existing `@nexter/sandbox-core` replay/paper engine, Node ESM, `pdfmake`, `psql` for the read-only candle export.

**Spec:** `docs/superpowers/specs/2026-11-26-eth-diagnostic-replay-design.md`

## Global Constraints

- Research only: no Stage 3 runs, defaults, report hashes, live runner or production API changes.
- Deterministic: same candle JSONL + settings + seed must produce byte-identical diagnostics and SVG.
- Money remains decimal strings; chart/indicator math may use numbers, but no ledger values are recomputed.
- Do not import `apps/*` from `packages/sandbox-core`.
- Do not claim RSI/EMA/trend score are engine state; they are research indicators computed from candles.
- Generated ETH artifacts go under the gitignored `out/` directory, not into git.
- The first data source is ETH/BSC token `bsc:0x2170ed0880ac9a755fd29b2688956bd959f933f8`, 1h, 180 days.

## Review Focus

- Duplicate or missing event timestamps across bars must not shift diagnostics onto the wrong candle.
- CSV fields containing commas, quotes or newlines must round-trip.
- Annotation timestamps outside the replay window must appear as unmatched, never crash or attach to the wrong bar.
- Flat or single-bar price ranges must not divide by zero in the SVG.
- A 4,320-bar replay must not exceed memory or produce an unreadable chart; split into 15-day pages.
- Late/gapped candles must be labelled, not silently treated as continuous.

---

### Task 1: Diagnostics types and builder

**Files:**

- Create: `packages/sandbox-core/src/diagnostics/types.ts`
- Create: `packages/sandbox-core/src/diagnostics/build.ts`
- Create: `packages/sandbox-core/src/diagnostics/build.test.ts`
- Modify: `packages/sandbox-core/src/index.ts` (export `./diagnostics`)

**Interfaces:**

- Consumes: `Candle`, `SandboxEvent`, `RunReport`, `IntentRecord`, `EquityPoint` from existing core types.
- Produces: `BarDiagnostic`, `BuildBarDiagnosticsInput`, `buildBarDiagnostics(input): BarDiagnostic[]`.

- [ ] **Step 1: Write the failing test**

Test a 3-bar synthetic input with one `regime.evaluated`, one `strategy.evaluated`, one `risk.checked`, one intent and one equity point. Assert:

- three rows with `barIndex` 0..2;
- the regime/strategy/risk fields appear only on the matching bar;
- `positionAmount` carries forward after a `ledger.entry`;
- unknown events are ignored.

- [ ] **Step 2: Run it and verify it fails**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/build.test.ts`
Expected: fail because `./build` does not exist.

- [ ] **Step 3: Implement the builder**

`BarDiagnostic` fields: `barIndex`, `tokenId`, `timeframe`, `openTime`, `closeTime`, `open`, `high`, `low`, `close`, `volumeUsd`, `regime`, `regimeReason`, `fastSma`, `slowSma`, `longSma`, `atrPct`, `recentHigh`, `recentLow`, `drawdownPct`, `avgVolumeUsd`, `staleBars`, `strategyKey`, `signalAction`, `signalReason`, `confidence`, `riskWeight`, `riskDecision`, `riskReason`, `riskChecks`, `intentSide`, `intentStatus`, `intentReason`, `fillSide`, `fillPrice`, `fillStatus`, `positionAmount`, `equityUsd`, `cashUsd`, `equityDrawdownPct`.

Build event maps by `${clockTime}|${tokenId}|${eventType}`. Filter candles by token/timeframe, sort by open time. For each bar, pick the exact close-time events, the matching intent journal row(s), the matching equity point, and the latest ledger position at or before that close. Serialize `riskChecks` as `name:passed:detail` joined by `|`. Missing values are `null`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-core/src/diagnostics packages/sandbox-core/src/index.ts
git commit -m "feat(sandbox): build per-bar replay diagnostics"
```

---

### Task 2: Diagnostics CSV and annotation template

**Files:**

- Create: `packages/sandbox-core/src/diagnostics/csv.ts`
- Create: `packages/sandbox-core/src/diagnostics/csv.test.ts`

**Interfaces:**

- Consumes: `BarDiagnostic`.
- Produces: `DIAGNOSTIC_COLUMNS`, `renderDiagnosticsCsv(rows): string`, `renderAnnotationTemplate(): string`.

- [ ] **Step 1: Write the failing tests**

Assert the CSV header order, one row per diagnostic, and that a note/value containing `,`, `"` and `\n` is quoted and doubled correctly. Assert the annotation template is exactly:
`timestamp,expected_action,reason_code,note\n`.

- [ ] **Step 2: Run and verify failure**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/csv.test.ts`
Expected: fail because `./csv` does not exist.

- [ ] **Step 3: Implement**

`renderDiagnosticsCsv` writes the fixed column list, RFC-4180 escaping, `\n` row endings and a trailing newline. `renderAnnotationTemplate` writes only the header.

- [ ] **Step 4: Run and verify pass**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/csv.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-core/src/diagnostics/csv.ts packages/sandbox-core/src/diagnostics/csv.test.ts
git commit -m "feat(sandbox): export diagnostic CSV and annotation template"
```

---

### Task 3: Annotation parser and join report

**Files:**

- Create: `packages/sandbox-core/src/diagnostics/annotations.ts`
- Create: `packages/sandbox-core/src/diagnostics/annotations.test.ts`

**Interfaces:**

- Consumes: `BarDiagnostic` rows from Task 1.
- Produces: `parseAnnotationsCsv(text): Annotation[]`, `joinAnnotations(annotations, rows, toleranceMs?): JoinedAnnotation[]`, `renderAnnotationReport(joined): string`.

- [ ] **Step 1: Write the failing tests**

Cover:

- a valid quoted CSV row with a note containing a comma;
- invalid `expected_action` rejected with a clear error;
- an annotation within one bar of a row attaches to that row;
- an annotation outside the window returns `bar: null`;
- the Markdown report contains the timestamp, regime, signal, risk decision and top reason counts.

- [ ] **Step 2: Run and verify failure**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/annotations.test.ts`
Expected: fail because `./annotations` does not exist.

- [ ] **Step 3: Implement**

Allowed actions: `entry`, `exit`, `hold`, `no-trade`. Parse ISO timestamps or epoch milliseconds. Join to the nearest diagnostic by absolute close-time difference; default tolerance `2 * 3600_000` ms. `renderAnnotationReport` outputs a Russian Markdown summary plus a table; unmatched annotations are listed separately. Aggregate `reason_code` counts and blocked risk-check names.

- [ ] **Step 4: Run and verify pass**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/annotations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-core/src/diagnostics/annotations.ts packages/sandbox-core/src/diagnostics/annotations.test.ts
git commit -m "feat(sandbox): join manual annotations to replay bars"
```

---

### Task 4: Research indicators and SVG chart pages

**Files:**

- Create: `packages/sandbox-core/src/diagnostics/series.ts`
- Create: `packages/sandbox-core/src/diagnostics/series.test.ts`
- Create: `packages/sandbox-core/src/diagnostics/chart-svg.ts`
- Create: `packages/sandbox-core/src/diagnostics/chart-svg.test.ts`

**Interfaces:**

- Consumes: `BarDiagnostic[]`, `ChartMarker[]`.
- Produces: `emaSeries(closes, period)`, `rsiSeries(closes, period)`, `renderChartPages({ rows, markers, barsPerPage, title }): string[]`.

- [ ] **Step 1: Write the failing series tests**

Assert EMA aligns with SMA on a constant series, RSI is 100 on a strictly rising series and 0 on a strictly falling series, and short inputs return `null`s without throwing.

- [ ] **Step 2: Run and verify failure**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/series.test.ts`
Expected: fail because `./series` does not exist.

- [ ] **Step 3: Implement series helpers**

Use the standard EMA seed from the first SMA and Wilder-style RSI with a simple average seed. Return index-aligned `(number | null)[]`.

- [ ] **Step 4: Run and verify pass**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/series.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing chart tests**

Assert:

- one page for 360 rows and two pages for 361 with `barsPerPage: 360`;
- the SVG contains `<svg`, candle colors, regime labels, bar-index labels, volume and RSI panels;
- a marker appears on the page containing its bar;
- a flat price series does not throw or produce `NaN`.

- [ ] **Step 6: Run and verify failure**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/chart-svg.test.ts`
Expected: fail because `./chart-svg` does not exist.

- [ ] **Step 7: Implement the SVG builder**

Each page is 1600×900: title/legend, price panel with candles, EMA24/EMA168, stop/take lines if present and action markers; regime background bands; volume panel; RSI14 panel with 30/70 guides; time and bar-index labels every 24 bars. Escape text. Use fixed decimal formatting and guard zero ranges.

- [ ] **Step 8: Run and verify pass**

Run: `npx pnpm@10.20.0 --filter @nexter/sandbox-core test -- src/diagnostics/chart-svg.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/sandbox-core/src/diagnostics/series.ts packages/sandbox-core/src/diagnostics/series.test.ts packages/sandbox-core/src/diagnostics/chart-svg.ts packages/sandbox-core/src/diagnostics/chart-svg.test.ts
git commit -m "feat(sandbox): render diagnostic replay chart pages"
```

---

### Task 5: Research export script and PDF

**Files:**

- Create: `apps/api/scripts/replay-diagnostics.mjs`
- Modify: `apps/api/package.json` (add `"diagnostics": "pnpm --filter @nexter/sandbox-core build && node scripts/replay-diagnostics.mjs"`)

**Interfaces:**

- Consumes: `@nexter/sandbox-core` built exports, `pdfmake` and `pdfmake/fonts/Roboto` from the API package.
- Produces: `diagnostics.json`, `diagnostics.csv`, `annotations.csv`, `chart.pdf`, `chart/*.svg`, `summary.md`.

- [ ] **Step 1: Add the script skeleton and `--help`**

Parse `--candles <jsonl>`, `--out <dir>`, `--token <id>`, `--from <iso>`, `--to <iso>`, `--seed 7`, `--initial-capital 1000.00`, `--settings <json>`, `--annotate <csv>` and `--help`. Unknown flags fail with usage.

- [ ] **Step 2: Run `--help`**

Run: `npx pnpm@10.20.0 --filter @nexter/api diagnostics -- --help`
Expected: usage text, exit 0.

- [ ] **Step 3: Implement export**

Load candles with `loadJsonlCandles`, filter by token/timeframe and optional window, build `PaperRunConfig` from `DEFAULT_SETTINGS`/`DEFAULT_PAPER_SETTINGS`, run `runPaperFromCandles`, then write `diagnostics.json`, `diagnostics.csv`, `annotations.csv`, all SVG pages and `summary.md` (metrics, trades, drawdown, top blockers, file list, snapshot hash). Build markers from `report.intentJournal` and trades.

- [ ] **Step 4: Implement PDF**

Use the same `pdfmake` setup as `SandboxReplayPdfService` (Roboto, URL/local policies disabled/restricted). Add a cover page with identity/metrics/instructions, then one A3 landscape page per SVG chart. Write `chart.pdf` and assert the buffer starts with `%PDF`.

- [ ] **Step 5: Implement annotate mode**

With `--annotate`, read `diagnostics.json` and the CSV, call `parseAnnotationsCsv`/`joinAnnotations`/`renderAnnotationReport`, write `annotation-report.md`. Do not rerun the engine.

- [ ] **Step 6: Smoke test on a 200-bar synthetic JSONL**

Generate a deterministic 200-bar series, run export, verify all files exist, `diagnostics.csv` has 200 data rows, `chart.pdf` starts with `%PDF`, and a second run with the same input produces identical `diagnostics.csv` and SVG strings.

- [ ] **Step 7: Commit**

```bash
git add apps/api/scripts/replay-diagnostics.mjs apps/api/package.json
git commit -m "feat(research): export diagnostic replay pack and PDF"
```

---

### Task 6: ETH/BSC artifact and runbook

**Files:**

- Modify: `docs/runbooks/sandbox.md` (add a research-only section)
- Generated only: `out/eth-diagnostic-2026-11-26/*` (gitignored)

- [ ] **Step 1: Export candles read-only**

Use a temporary Railway Postgres tunnel and `psql` to write JSONL for token `bsc:0x2170ed0880ac9a755fd29b2688956bd959f933f8`, 1h, 2026-05-29..2026-11-26. The JSONL fields are `tokenId,timeframe,openTime,open,high,low,close,volumeUsd`. Do not write to the database.

- [ ] **Step 2: Run the exporter**

Run: `npx pnpm@10.20.0 --filter @nexter/api diagnostics -- --candles out/eth-bsc-1h.jsonl --out out/eth-diagnostic-2026-11-26 --token "$ETH_TOKEN_KEY"` (the key is the ETH/BSC token from `docs/sandbox/stage-3-baseline.md`)
Expected: 4,320 evaluation bars (or the exact covered window minus prefix), 12 chart pages, diagnostics/CSV/PDF/annotations/summary files.

- [ ] **Step 3: Verify**

Check `diagnostics.csv` row count, `chart.pdf` begins with `%PDF`, page count is 12, no `NaN`/`undefined` in CSV/SVG, and the summary reports the actual P/L, max drawdown and trade count.

- [ ] **Step 4: Document**

Add the export/run/annotate commands and artifact paths to `docs/runbooks/sandbox.md`. State that the pack is research-only and does not change Stage 3.

- [ ] **Step 5: Commit**

```bash
git add docs/runbooks/sandbox.md
git commit -m "docs(sandbox): document diagnostic replay pack"
```

---

### Task 7: Owner annotation pass (follow-up)

**Files:**

- Input: `out/eth-diagnostic-2026-11-26/annotations.csv`
- Output: `out/eth-diagnostic-2026-11-26/annotation-report.md`

- [ ] **Step 1: Owner marks at least 20 missed entries/exits**

Use the PDF page/bar numbers and timestamps; allowed actions are `entry|exit|hold|no-trade`.

- [ ] **Step 2: Run annotate mode**

Run: `npx pnpm@10.20.0 --filter @nexter/api diagnostics -- --annotate out/eth-diagnostic-2026-11-26/annotations.csv --out out/eth-diagnostic-2026-11-26`
Expected: a Markdown report with every mark matched to a bar, the engine state at that bar, top blockers and unmatched rows.

- [ ] **Step 3: Turn the report into 2–3 rule hypotheses**

For each dominant blocker, write a one-line change and run the exporter with a variant settings JSON. Compare P/L, trade count and max drawdown; keep only changes that survive ETH plus the five Stage 3 tokens.
