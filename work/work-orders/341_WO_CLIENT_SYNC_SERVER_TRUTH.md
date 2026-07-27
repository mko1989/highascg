# WO-341 — client sync redesign: server state is the truth, only user interaction writes

**Source:** owner 2026-07-26 evening — "the whole sync system between clients needs to be reviewed
and fixed. both of them are controling same server, both should display live state of the server,
every new call from wherever becomes the truth. but only actual user interaction."

**Status: kill list IMPLEMENTED 2026-07-27 (items 1–7); item 8 = observe-then-decide.**

## Kill-list implementation (2026-07-27)

1. `_persist(meta)` tracks whether any contribution in the 1s window was LOCAL; an all-remote
   window emits `persisted {remote:true}` and the deck-sync/autosave listener skips it.
2. Resync/reconnect no longer schedules a deck sync — only SEEDING a fresh server (no project)
   pushes (`serverWasFresh` gate in server-project-sync.js).
3. The ws import dispatches `project-loaded {detail:{remote:true}}`; the app listener skips it.
4. Heartbeat + rects nudge KEPT, classified in-code as server-initiated reads of per-client
   layout (no shared state, no echo path) — see operator-gui-mode-report.js header.
5. Editor `softChange` handler now render-only for remote-tagged events (a remote import
   mid-edit-session used to trigger a preview push).
6. `sceneState.ingestRemoteDeckScenes` — the `scene.deck` broadcast upserts into the client deck
   as REMOTE data (remote-tagged 'imported', skips the locally-edited look, deletions still via
   project_sync), then re-applies the last scene.live; deck convergence no longer waits for a
   project save.
7. Server stamps `scene.live` change broadcasts with a monotonic `seq`; clients detect a gap
   (dropped frame on a backed-up socket) and re-pull via refreshSceneLiveFromServer.
8. OPEN — observe: with 1–5 dead, idle-session autosave cadence should drop to zero (acceptance
   drill below); only if stale_rev noise persists, implement the server-side base-rev acceptance.


## The principle (owner's, verbatim intent)

1. The SERVER is the single source of truth for live state, deck, and project.
2. Every client renders server state reactively and NEVER discards or suppresses it — if it cannot
   apply an update yet, it holds it until it can (converge, don't drop).
3. Only actual user interaction writes shared state. Reactions to incoming server data (imports,
   broadcasts, timers, reconnects) must be structurally unable to write back.
4. Last user action wins, from whichever client, immediately.

## Fixed already (commits 06934d3, fbecbda, 6f8f5da, c51a967, 560f7e2)

- **Stale-by-one broadcasts:** all `liveSceneState.setChannel` sites now awaited before
  `broadcastSceneLive` (the write was serialized into a later microtask; the broadcast read the
  previous map — non-initiators were deterministically one take behind). Live-verified.
- **Dropped scene.live converges:** clients remember the last `scene.live` payload and re-apply it
  after each `project_sync` import (the unknown-scene-id guard used to drop it forever).
- **Echo loops #1–3 killed via `{remote:true}` event tagging:** `imported` from silent ws imports,
  `previewScene`/`softChange` from `applyServerLiveChannels`, `softChange` from ws `mixer_update` —
  write-back listeners (deck sync, autosave flush) skip remote-tagged events.
- Deck-sync echo guards are 2 s TTL windows, server caches only after successful merge.
- Preview-recall teardown no longer kills the just-staged producer on the bank-less bus.

## Remaining violations (from the write-path inventory — the kill list)

1. **The 1 s `persisted` timer chain (hardest):** ws `scene.live` → `_softSave` → `_persist` (1 s
   timer) → `'persisted'` → deck sync + autosave flush (`client/lib/scene-state.js:154-156`,
   `client/app.js:275`). The timer erases the remote origin. Fix direction: thread the origin
   through `_persist`/`_softSave` meta into the `persisted` emit (already plumbed for softChange),
   or make `persisted` never write and move that write to explicit user-action sites.
2. **Reconnect/bootstrap deck resends:** `server-project-sync.js:145` schedules a deck sync after
   every resync — a reconnect is not user interaction. Should be read-only (adopt server state).
3. **`project-loaded` → deck sync** (`app.js:289`): fires after remote imports too; tag the event
   with its origin like `imported`.
4. **Operator-layout writes without interaction:** the 60 s heartbeat re-POST
   (`operator-gui-mode-report.js:339`) and the server-nudge reaction (`:336`,
   `operatorGuiRectsWanted`) — both are server-driven client writes. The nudge is arguably a
   legitimate REQUEST for rects; if kept, mark it as such in the design (server-initiated read).
5. **`pushEditsToPgmLive` chaining off `softChange`** (`scenes-preview-runtime.js:282`) — verify it
   can only fire during an actual edit session (editingSceneId gate) and never from remote-tagged
   events; border push off `softChange` (`scenes-editor.js:355`) same.
6. **No `scene.deck` ingestion on clients:** a look created on client A reaches B only via the
   debounced `project_sync` after a save. Until then B drops scene.live for that look (mitigated by
   the converge-on-import fix, but the deck itself lags). Design: ingest the `scene.deck` broadcast
   (`ws-server.js:405`) into `sceneState.scenes` as REMOTE data (no write-back), making deck
   convergence independent of project saves.
7. **Silent ws frame drop:** `'change'` is in `SKIP_WHEN_BUFFERED_EVENTS` (`ws-server.js:60`) — a
   backed-up client (>8 MB) loses `scene.live` permanently (periodic full-state is disabled,
   `wsBroadcastMs=0`). Add a cheap seq/heartbeat: server stamps `scene.live` with a counter;
   clients detect a gap and GET the current state.
8. **Autosave rev interleave** (the visible "sync errors"): two clients autosaving alternately each
   go stale-by-one (bounded retry, self-healing, but noisy and widens race windows). With loops 1–3
   dead, autosaves should only fire from local edits; verify the cadence drops, then consider
   server-side: accept an autosave whose BASE rev equals the stored rev even when content differs
   only in server-merged fields (operatorCompose etc.), or exclude server-merged fields from the
   client's payload entirely.

## Acceptance

- Idle two-client session (kiosk + laptop, same project): ZERO `scene_deck_sync` messages, ZERO
  autosave POSTs, ZERO `stale_rev` lines over 10 minutes.
- A take/preview/edit from either client is visible on the other within one broadcast (<300 ms),
  including looks created seconds earlier on the other client.
- Kill a client's socket mid-edit: on reconnect it adopts server state (no write on reconnect) and
  its next USER action syncs normally.
- Instrumentation: every client→server write logs its trigger origin (user event vs derived) at
  debug level during the transition, so violations are visible in the journal.

## Constraints

- Do not regress the WO-334 storm protection (TTL windows stay).
- `flushSceneDeckSync` before takes stays unconditional (pre-take correctness).
- LIVE box; changes land incrementally, each with a two-client verification pass.
