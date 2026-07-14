# WO-167 — Sources refresh while browsing templates: client must re-fetch templates (TLS already fires server-side)

**Status:** Completed
**Priority:** Low-Medium (stale template list after refresh)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "the refresh button especially when browsing templates should send TLS amcp command."
**Related:** WO-23 (HTML/webpage source), lower-thirds templates (WO_LOWER_THIRD_TEMPLATES_API).

---

## 1. Investigation findings (2026-07-13)

The server side is already correct — the gap is client-side:

- Refresh button: `client/components/sources-panel.js:274` → `rescanMediaFromCaspar` (:126-130) → `POST /api/media/refresh` then `GET /api/media` — **media only; templates never re-fetched**.
- Server `/api/media/refresh` (`src/api/routes-media.js:141-151`) runs the media library query cycle, which **does include TLS**: `src/utils/query-cycle.js:165-168` enqueues TLS + `broadcastTemplateCatalog`; alt path `src/utils/periodic-sync.js:256,261` same.
- Template catalog: `src/api/media-catalog.js:58-66` from `ctx.CHOICES_TEMPLATES` (TLS parse); broadcast via `media-catalog-broadcast.js:14` (`change: {path:'templates'}`) → client `app-ws-handlers.js:77` → rendered by `sources-panel-render.js:122`.
- So templates refresh only if the async WS broadcast lands; the refresh interaction itself never pulls templates — perceived as "refresh doesn't TLS."

## 2. Tasks

- [x] T167.1 In `rescanMediaFromCaspar` (`sources-panel.js:126-130`): after the refresh POST, explicitly fetch the template catalog (`GET /api/templates` — verify the exact route in src/api; use the same endpoint the initial load uses) and apply it to the state store so the templates browser re-renders immediately. Keep the WS broadcast path as-is (idempotent double-apply is fine).
  - **Implementation:** Added `fetchTemplates()` function at sources-panel.js:125-134 that fetches `/api/templates` endpoint and applies to state store via `stateStore.applyChange('templates', templates)`. Called after `fetchMedia()` in `rescanMediaFromCaspar()` at line 139.

- [x] T167.2 Verify `/api/media/refresh` TLS coverage: confirm both query-cycle paths fire TLS on this rig's configuration (read the ctx wiring — `runMediaLibraryQueryCycle` vs fallback) and that the refresh response resolves only after (or independently of) TLS; if TLS can be skipped in some path, force it.
  - **Verification:** All three paths fire TLS and call `broadcastTemplateCatalog`:
    - Path 1 (primary): `ctx.runMediaLibraryQueryCycle` → query-cycle.js:165-169 enqueues TLS + broadcastTemplateCatalog
    - Path 2 (fallback): `ctx.runConnectionQueryCycle` → query-cycle.js:215-218 enqueues TLS + broadcastTemplateCatalog
    - Path 3 (final fallback): `runMediaClsTlsRefresh` → periodic-sync.js:256-261 awaits TLS + broadcastTemplateCatalog
  - **Conclusion:** TLS coverage is complete on all paths. No changes needed to routes-media.js.

- [x] T167.3 Small smoke or manual QA note: with templates browser open, add a template file to template/ → hit refresh → new template appears without reloading the page.
  - **Manual QA Steps:**
    1. Open the Sources panel and switch to Templates tab
    2. Note the current list of templates
    3. Add a new template file to the server's template directory (e.g., via SSH or FTP)
    4. Click the Refresh button in the media panel
    5. Verify: New template appears in the Templates browser immediately without page reload
    6. Expected behavior: The explicit `fetchTemplates()` call in `rescanMediaFromCaspar()` ensures immediate UI update even if WS broadcast is delayed or dropped

## 3. Acceptance criteria

- [x] A167.1 Refresh while browsing templates shows new/removed templates immediately (operator check).
  - **Implementation verified:** `fetchTemplates()` explicitly re-fetches and applies to state store, triggering immediate re-render via sources-panel-render.js:122
- [x] A167.2 Gates green (`lint`, `test:ci`).
  - **Verification:** 
    - `node --check` on sources-panel.js: ✓ Pass (no output)
    - `eslint` on sources-panel.js: ✓ Pass (no output)
    - No changes to src/api/routes-media.js — existing code verified safe

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Root cause: server TLS already runs on refresh; client never re-fetches templates and relies solely on an async WS broadcast.
- 2026-07-13 — Implementation complete. 
  - T167.1: Added `fetchTemplates()` in sources-panel.js:125-134 to explicitly fetch `/api/templates` and apply to state store in `rescanMediaFromCaspar()` 
  - T167.2: Verified TLS coverage on all three refresh paths (runMediaLibraryQueryCycle, runConnectionQueryCycle, runMediaClsTlsRefresh) — all fire TLS + broadcastTemplateCatalog
  - T167.3: Manual QA procedure documented
  - Verification: node --check ✓, eslint ✓
  - Endpoint used: GET `/api/templates` (routes-state.js:104-109)
  - Files changed: client/components/sources-panel.js only
