# WO-419 — Review 2026-08-03 "fix first" rows 6, 7, 10: autosave latches, dead USB-import API, logs-modal leak

**Status: DONE (2026-08-04 — all three implemented; new smoke 3/3; suite 1809/2, reds are the WO-415 config drift. Client rebuilt + kiosk reloaded; server restarted 04.08 and row 7 VERIFIED live: `GET /api/usb/drives` → 200 `{ok:true,...}`, was 404)**

Owner handed back the open-items list from the WO-418 session ("still open after this…"), which
included "rows 6, 7, and 10" as the batch offered for this session. Rows 8–9 (exFAT
staleness/atomicity, config-load defaults amplifier) are NOT here — they are entangled with the
WO-415 hardening options that change field-kit workflow and stay parked on the owner's pick.
All three findings were verified by the review (row 7 proven LIVE: 404 on all three paths).

## Investigation

Re-verified in source before fixing; nothing had drifted since the review:

1. **Row 6 — three one-way autosave latches** (`client/lib/server-project-sync.js`,
   `client/lib/project-load.js`):
   - 6a. `clearProjectGoneOnServer()` was exported but called by NOTHING — after one 410
     `project_gone`, autosave + deck sync stayed dead for the whole kiosk session even after the
     operator did exactly what the header message told them (Save As).
   - 6b. `shouldResyncOnWsConnect()` returned `synced && age > 2500` — inverted for the failure
     case: a client whose bootstrap/resync FAILED (`synced=false`, e.g. kiosk F5 landing in the
     `kill -TERM` deploy window) never resynced on any later WS connect. `resyncFromServer`
     resets `synced` BEFORE the attempt, so one mid-resync failure latched it permanently.
   - 6c. The fresh-server seeding branch in `bootstrapFromServer` was unreachable: GET
     `/api/project` answers `200 {}` on a fresh box, `normalizeProjectPayload({})` → null, the
     client fell through to POST `/api/project/load` which 404s ("No project stored") and
     throws — so `markServerProjectSynced()` never ran and nothing autosaved until an explicit
     Save.
2. **Row 7 — USB import API entirely dead** (`src/api/router.js:291-294` vs
   `src/api/routes-usb-ingest.js:349-355`): router registered `/api/usb-ingest/*` but the
   handler's route table and the client (`usb-import-modal.js`) both use `/api/usb/*` → every
   endpoint 404. ALSO found while fixing: the dispatcher strips the query string from the path
   before route matching (`router-dispatch.js:43`), but `handle()` re-parsed the query from its
   `pathWithQuery` argument — which the registration filled with the already-stripped path, so
   even with the prefix fixed, `GET /api/usb/browse?driveId=…` would have seen an empty query.
3. **Row 10 — logs-modal toggle leak** (`client/components/logs-modal.js`): the connection-eye
   click toggles the modal, but the toggle-close path did a bare `existing.remove()`; only the
   ✕ button ran `close()` (stop 2 s poll, remove `log_line` WS listener, filter cleanup). Every
   eye-click close leaked an interval fetching ~500 Caspar log lines forever plus a WS
   subscription appending into a detached `<pre>`.

## What was done

1. `server-project-sync.js` — `markServerProjectSynced()` now clears `projectGone`: every
   caller is either an operator action that produced a real server project again (Save /
   Save As / Load / New / file import) or an adoption of server truth (bootstrap/resync), each a
   legitimate exit from the WO-311 latch. The never-called `clearProjectGoneOnServer` deleted
   (unwired-exports baseline shrunk 693→691). The WO-311 latch itself (410 → stop pushing) is
   untouched — its smoke still passes unmodified.
   `shouldResyncOnWsConnect()` rewritten: offline or bootstrap-in-flight → false; NOT synced →
   **true** (retry on reconnect); synced → the same 2.5 s freshness window. The new
   `bootstrapInFlight` flag (set/cleared inside `bootstrapFromServer`) preserves what the old
   inverted gate accidentally provided: no double-bootstrap when the WS connects while init()'s
   bootstrap is still running (`resyncPromise` only dedupes resyncs against each other, not
   against the initial bootstrap).
   `project-load.js` — `fetchProjectFromServer()` returns the `200 {}` fresh-server marker
   as-is instead of falling through to the throwing POST; bootstrap's seeding branch is now
   reachable. Other callers: `default-project.js` treats `{}` as `isEmptyStoredProject` (skip
   forced save — correct), `project-files.js` legacy-`current` paths can only see `{}` on a
   fresh box where the legacy id cannot exist.
2. `router.js` — registration flipped to `/api/usb/*` (GET+POST), passing the dispatcher's
   parsed `query` through; dead `/api/usb-ingest` exact-path registrations dropped.
   `routes-usb-ingest.js` — `handle(method, p, query, …)` takes the parsed query instead of
   re-parsing a path that no longer carries one.
3. `logs-modal.js` — module-level `activeModalClose` stores the per-open `close()`; the toggle
   path calls it (falling back to `remove()` only if unset), `close()` nulls it. To stay under
   the 500-line gate the pure `parseMarkdownBasic()` (shortcuts-tab renderer) moved to
   `client/lib/logs-modal-shared.js` — the file's existing helper module — unchanged.

New `tools/smoke/smoke-wo419-review-rows-6-7-10.test.js` (added to the curated list):
functional row-7 probes (`handle()` matches `/api/usb/import-status`, rejects the old prefix;
`RouteRegistry` wildcard + query pass-through) + source pins for the router registration, the
three latch exits, and the toggle-close path.

## What was VERIFIED

- New smoke 3/3. Suite **1809 pass / 2 fail** — the 2 are `smoke-wo237-monitor-channel…`
  reading the WO-415-clobbered box config, red before this WO. WO-311's autosave-no-resurrect
  smoke passes UNMODIFIED (the latch contract is preserved, only its exit is wired).
- 500-line gate clean (logs-modal split), unwired-exports baseline shrunk with `--update`
  (693→691: the deleted latch exit + `ACTIVE_SLUG_KEY`, wired by WO-418's smoke).
- Client rebuilt to `dist-web` and kiosk reloaded (F5) — rows 6/10 are live on the box.
- Row 7 VERIFIED live 04.08 post-restart: `GET /api/usb/drives` → 200 `{ok:true,drives:[],unmounted:[]}` (was 404).
- Rows 8–9 (exFAT staleness/atomicity + config-load defaults amplifier — WO-415 hardening
  options), the auth-off exposure note, and engine §3 (batch double-execution) remain open on
  owner decisions.
