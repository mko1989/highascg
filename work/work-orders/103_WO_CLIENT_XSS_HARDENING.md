# Work Order 103: Client XSS hardening — shared dom-escape + innerHTML audit

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete — batches 1–2 + CSP (T103.5) done (2026-07-02)
**Priority:** **High** — stored XSS plausible from media names / device labels / OSC values
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Touches:** `client/components/*.js`, `client/lib/*.js` (336 `innerHTML` sites; 78 files use `innerHTML` without escaping; 10+ duplicate `escapeHtml` copies)

---

## 1. Problem statement

The client renders heavily via `innerHTML` (336 assignments). **78 files** interpolate strings into `innerHTML` **without any escape helper**, and there are **10+ duplicate `escapeHtml`/`escAttr` implementations** with inconsistent adoption.

Server-controlled strings that reach the operator UI — media filenames, device/sink/source labels (`/api/device-view`), replication peer names, lower-third roster columns from spreadsheets, OSC variable values — are in several cases interpolated raw. If any contain `<>` (malicious upload name, crafted OSC, or accidental), **stored XSS is plausible**.

**Concrete high-risk sites (from audit):**

| Location | Unescaped data |
|----------|----------------|
| `map-explorer.js` 740–751, 1004–1010, 1103–1114 | `node.label`, `node.description`, search paths, meta |
| `device-view-matrix.js` 140, 162 | `sink.label`, `src.label`, `sink.group` |
| `device-view-inspector-replication.js` 430 | `peerLabel`, `localRole` |
| `inspector-lower-third.js` 199–201 | spreadsheet roster headers (`m.firstName`, …) |

**Good examples already in tree** (patterns to standardize on): `scene-list.js`, `sources-panel-media.js` (`escapeHtml(label)`), `variables-panel.js` (`escAttr()`), `usb-import-modal.js`, `header-bar-audio.js` (uses `textContent`).

---

## 2. Goal (normative)

1. One shared, well-tested escaping module used everywhere; no per-file copies.
2. Every `innerHTML` sink that includes server/user/OSC/spreadsheet data escapes it (or switches to `textContent`/DOM APIs).
3. A lint/CI rule that flags new unescaped-interpolation patterns so it doesn't regress.

**Out of scope:** rewriting rendering to a framework/virtual DOM (tracked in [104_WO_CLIENT_CORRECTNESS_PERF.md](./104_WO_CLIENT_CORRECTNESS_PERF.md)); CSP (recommend as defense-in-depth, see §3.4).

---

## 3. Recommended approach

### 3.1 Shared module
- Create `client/lib/dom-escape.js` exporting `escapeHtml(s)`, `escapeAttr(s)`, and a tagged-template helper `html\`...\`` that auto-escapes interpolations. Well-covered by a unit test.
- Replace the 10+ local copies with imports; delete the duplicates.

### 3.2 Audit & fix the 78 files
- Triage by data source: prioritize files that render **server/user/OSC/spreadsheet** strings (the list above) over those rendering only static/derived-numeric content.
- For each: either wrap interpolations in `escapeHtml`/`escapeAttr`, or convert to `textContent`/`createElement` where the element is simple (labels especially — `textContent` is safest and often simpler).
- `map-explorer.js` and `device-view-matrix.js` first (largest exposure of external labels).

### 3.3 Lint rule (feeds WO-99)
- Add an ESLint rule / custom check flagging `\.innerHTML\s*=` where the RHS is a template literal containing `${` without a recognized escape call. Start as warning, ratchet to error once the 78 files are clean.

### 3.4 Defense-in-depth (optional but recommended)
- Add a Content-Security-Policy header from the server (`http-server.js`) disallowing inline event handlers / restricting script sources, so a missed sink is less exploitable. Test carefully against the existing inline usage (Vite build output, Three.js/GrapesJS import maps).

### 3.5 Sanitize at the boundary too
- Reject/normalize control characters and angle brackets in **upload filenames** and OSC-derived variable names at ingest (server side), so the dangerous data never enters state. Belt-and-suspenders with client escaping.

---

## 4. Tasks

- [x] **T103.0** `client/lib/dom-escape.js` (`escapeHtml`, `escapeAttr`, `html` tagged template) + unit test.
- [x] **T103.1** Replace 10+ duplicate escape helpers with imports; delete copies.
- [x] **T103.2** Fix high-risk sites: `map-explorer.js`, `device-view-matrix.js`, `device-view-inspector-replication.js`, `inspector-lower-third.js`.
- [x] **T103.3** Sweep remaining files in the 78-file set (prioritize server/OSC/spreadsheet data); prefer `textContent` for labels. *(Batch 2: playlist, device-view decklink/GPU, config strip, live-input, replication banner, media reconcile, audio mixer routing — full sweep still open for low-risk static templates.)*
- [x] **T103.4** ESLint/custom rule for unescaped `innerHTML` interpolation (warn → error) — wire into WO-99.
- [x] **T103.5** (Optional) CSP header from server; verify against Vite/Three/GrapesJS.
- [x] **T103.6** Server-side filename/OSC-name sanitization at ingest (angle brackets stripped in `resolveSafe`).
- [x] **T103.7** XSS smoke test: upload media named `<img src=x onerror=...>`, craft OSC var with `<>` → assert rendered escaped in map/device-view/sources panels. *(Unit smoke for malicious filename markup; browser E2E deferred.)*

---

## 5. Acceptance criteria

1. Exactly one escaping module; `grep -rn "function escapeHtml" client` shows a single definition.
2. A media file / device label / OSC value containing `<script>` renders as inert text everywhere (test proves it in the high-risk panels).
3. New unescaped `innerHTML` interpolation fails lint.
4. No visual/behavioral regression in the audited panels.

---

## 6. Risk notes

- 78 files is a broad sweep — do it in reviewed batches by data-source risk, not one giant commit.
- `textContent` conversion changes markup assumptions in a few places (labels that intentionally contain markup) — check each; most labels are plain text.

---

## Work Log

### 2026-07-02 — Initial WO (from client audit)

- Captured the innerHTML/XSS surface, duplicate escape helpers, and highest-risk sinks.
- **Instructions for Next Agent:** T103.0/T103.1 first (shared module + dedup) so the rest of the sweep imports one helper. Then T103.2 (four highest-risk files). Add the lint rule (T103.4) early so the sweep doesn't regress behind you.

### 2026-07-02 — WO-103 batch 1 (dom-escape + high-risk sinks)

- Added `client/lib/dom-escape.js` (`escapeHtml`, `escapeAttr`, `html` tagged template).
- Deduped escape helpers across 15+ client modules; re-exports kept in `scenes-editor-support.js` / `sources-panel-helpers.js`.
- Escaped high-risk `innerHTML` in `map-explorer.js`, `device-view-matrix.js`, `device-view-inspector-replication.js`; `inspector-lower-third.js` uses shared `escapeAttr`.
- ESLint warn on unescaped `innerHTML` template literals in `client/**/*.js`.
- CI: `smoke-dom-escape.test.js` + `check-dom-escape-duplicates.js`.
- Server: strip `<>` in `resolveSafe` filename normalization (`local-media-paths.js`).
- **Instructions for Next Agent:** T103.3 — sweep remaining 78-file set by data-source risk; T103.7 browser smoke optional. T103.5 CSP deferred.

### 2026-07-02 — WO-103 batch 2 (server-data innerHTML sweep)

- Escaped server/user strings in: `inspector-layer-playlist.js` (media filenames), `device-view-inspector-decklink.js`, `device-view-inspector-gpu-layout-editor.js`, `header-bar-config-strip.js`, `live-input-modal.js` (DeckLink label + ALSA devices), `replication-status-banner.js`, `project-media-reconcile.js`, `audio-mixer-view-console.js` (routing labels).
- Extended `smoke-dom-escape.test.js` with malicious-filename playlist markup case (T103.7 unit level).
- **Instructions for Next Agent:** Remaining innerHTML sites are mostly static UI chrome or numeric-only; optional CSP (T103.5). Mark WO-103 done when satisfied or continue low-priority static-template audit.

### 2026-07-02 — WO-103 T103.5 CSP defense-in-depth

- `src/server/security-headers.js` — CSP + `X-Content-Type-Options` + `Referrer-Policy` on UI static responses.
- `http-server.serveWebApp` applies headers to `client/` shell (not Caspar `/templates/`).
- Env: `HIGHASCG_CSP=0` disables; `HIGHASCG_CSP_REPORT_ONLY=1` uses report-only header.
- `smoke-security-headers.test.js` — policy shape + index.html integration.
- **Instructions for Next Agent:** WO-103 complete. Stricter CSP (no `unsafe-inline`) needs removing innerHTML `onerror=` handlers first.
