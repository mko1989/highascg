# WO-116 — Split client CSS files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Complete (T116.0–T116.4)  
**Priority:** **Medium** (mechanical splits)

**Touches:** `client/styles/*.css`, `client/styles.css` import chain

---

## 1. Problem

| Lines | File |
|------:|------|
| 702 | `client/styles/08c-modals-misc.css` |
| 595 | `client/styles/01a-base-theme-header-connection.css` |
| 545 | `client/styles/06c-inspector-effects-pip.css` |
| 525 | `client/styles/02c-timeline-multiview-sources-sidebar.css` |

---

## 2. Split plan

Use the existing `@import` pattern in `client/styles.css` — **do not** inline new CSS into unrelated files.

### 2.1 `08c-modals-misc.css` (702)

Split by modal family:

| New file | Content |
|----------|---------|
| `08c1-modals-led-test.css` | `.led-test-modal*` |
| `08c2-modals-logs-settings.css` | logs modal, settings fragments in this file |
| `08c3-modals-misc-shared.css` | shared modal chrome if any |

Replace `08c-modals-misc.css` with `@import` hub (≤ 20 lines).

### 2.2 `01a-base-theme-header-connection.css` (595)

| New file | Content |
|----------|---------|
| `01a1-base-theme-tokens.css` | CSS variables, root theme |
| `01a2-header-bar.css` | header bar, connection status, LED test strip |
| `01a3-workspace-chrome.css` | remaining layout chrome from 01a |

### 2.3 `06c-inspector-effects-pip.css` (545)

| New file | Content |
|----------|---------|
| `06c1-inspector-pip.css` | PiP overlay inspector |
| `06c2-inspector-effects.css` | effect catalog UI |
| `06c3-inspector-lt-roster.css` | lower-third roster mapping fields |

### 2.4 `02c-timeline-multiview-sources-sidebar.css` (525)

| New file | Content |
|----------|---------|
| `02c1-timeline-sidebar.css` | timeline-specific sidebar |
| `02c2-multiview-sidebar.css` | multiview sidebar |
| `02c3-sources-sidebar.css` | sources panel sidebar width/scroll |

---

## 3. Tasks

- [x] **T116.0** Split 08c modals; verify LED test + logs modals visually unchanged.
- [x] **T116.1** Split 01a header/theme; verify header + connection pill.
- [x] **T116.2** Split 06c inspector effects/PiP/LT roster.
- [x] **T116.3** Split 02c sidebar bundle.
- [x] **T116.4** Update parent `@import` files; no file > 500 lines.

---

## 4. Verification

Visual spot-check in browser after `npm run dev:client`. No JS changes expected.

---

## Work Log

### 2026-07-03 — WO-116 splits complete

- **08c-modals-misc.css** (703 → 5-line hub): `08c1` LED test, `08c2` load-project + buttons, `08c3` USB import, `08c4` reconcile/banners
- **01a-base-theme-header-connection.css** (596 → 4-line hub): `01a1` tokens, `01a2` header bar (+ header-audio from 08c), `01a3` connection chrome
- **06c-inspector-effects-pip.css** (546 → 4-line hub): `06c1` PiP, `06c2` effects, `06c3` presets + LT roster
- **02c-timeline-multiview-sources-sidebar.css** (526 → 4-line hub): `02c1` timeline, `02c2` multiview, `02c3` sources + streaming
- **Files over 500:** 26 → 22 (all four WO-116 targets cleared)

### 2026-07-03 — Created

- **Instructions for Next Agent:** Start with 08c — sections are already named by modal class prefix.
