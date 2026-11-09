# ADR 0023 — Light/dark themes and dashboard block design

## Status

Accepted for UI-9 (2026-11-10).

## Context

The owner wants a softer, more visual interface inspired by modern finance dashboards: large rounded blocks, icon tiles, a thicker equity line, and a dark theme that is graphite rather than pure black. The app already has a light theme with emerald accents and a dense utility-class styling approach.

A full redesign of every page in one step would be risky and would delay the functional fixes. The goal is a coherent visual system that can be applied incrementally without changing data, accounting, or security behavior.

## Decision

- **Two themes.** `data-theme="light"` (default) and `data-theme="dark"` are switched from the header. The choice is stored in `localStorage` under `nexter-theme` and applied by `/theme.js` before React mounts to avoid a flash of the wrong theme. The script is an external same-origin file because the CSP forbids inline scripts.
- **Graphite dark palette.** Dark uses `#202329` for the app background, `#2a2d33` for surfaces, `#31353c` for muted surfaces, and `#444a53` for borders. It is deliberately not pure black.
- **Token bridge.** `styles.css` defines CSS variables for background, surface, border, and text. Existing Tailwind utility classes are mapped to those variables under `[data-theme='dark']`, so all current pages become dark without duplicating `dark:` variants. Light theme values remain unchanged.
- **Component refresh.** Cards use 2xl radii and a soft depth shadow; buttons, inputs, selects, and textareas use xl radii and a wider focus ring; page titles are larger; the navigation uses rounded pills.
- **Dashboard blocks.** The dashboard is rebuilt around icon-tiled KPI cards: four primary metrics (capital, total P&L, realized, unrealized), four compact cash/gas/fee metrics, and six quality metrics. Each block has a soft accent tile, a small uppercase label, a large tabular value, and a muted hint.
- **Hero equity chart.** The equity curve is a full-width `hero-glow` card with a thicker 4 px emerald line, a stronger area gradient, theme-aware grid lines, and a 320 px plot. The monthly table and the monthly P&L bars remain below it.
- **No data changes.** The redesign consumes the existing dashboard/report APIs. No new metrics, no accounting changes, no migrations, and no third-party analytics or assets.

## Consequences

- The dark theme applies to existing pages through the bridge; pages that use custom colors outside the common palette may need individual follow-up polish.
- Theme preference is local to the browser profile, not stored on the server. This is acceptable for a single-owner app and avoids adding a settings migration.
- The thicker chart line and taller card layout trade some density for readability, which matches the owner's request.
- Future components should use the CSS variables or the shared `Card`/`Button`/`Input` primitives so both themes stay consistent.
