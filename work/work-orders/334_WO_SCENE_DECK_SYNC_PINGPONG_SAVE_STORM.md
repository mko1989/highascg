# WO-334 — scene_deck_sync ping-pong drives a project save/push storm

**Source:** owner report 2026-07-26 — log flooded with `[project] pushed llkk.json → bridge (/home/casparcg/bridge/projects/)` every ~170 ms.

**Status: diagnosed, not fixed.** Written 2026-07-26 from live journal evidence; the storm is episodic (burst 16:57:5x–16:58:06, quiet since), so it will recur.

## Verified current state (2026-07-26)

1. Journal (`journalctl -u highascg`) shows incoming WS `scene_deck_sync` messages at ~170–180 ms cadence, **strictly alternating between two payload sizes (8283 / 8259 bytes)** — two deck states ping-ponging, almost certainly two GUI clients (kiosk + laptop) echoing each other. A burst ran for minutes and stopped at 16:58:06.
2. `[project] pushed llkk.json → bridge` lines ride at the exact same cadence. The push only logs when file content actually changed (`copyIfExists` mtime/size guard, `src/engine/project-volume-sync.js:285-298`), so a full project persist with changed content happened ~6×/s.
3. The deck-sync persist itself is NOT the pusher: it is debounced 750 ms (`SCENE_DECK_SYNC_DEBOUNCE_MS`, `src/engine/project-scenes.js:28-30`) and always runs `pushVolumes:false` (`project-scenes.js:47`). The only persist callers with volume push enabled are the HTTP save/autosave handlers (`src/api/routes-data-project-handlers.js:65,136,340,360,441`) and `new-project.js:93`. So a client was ALSO POSTing project saves at ~6/s.
4. Server chain: `src/server/ws-server.js:384-397` — `scene_deck_sync` → `mergeDeckSyncIntoProject` (stamps fresh `savedAt`, `src/engine/project-scenes.js:292-334`) → `broadcast('change', { path: 'scene.deck' })` to ALL clients. That broadcast is the suspected ping-pong fuel.
5. Client side (Haiku subagent survey — **verify these lines at pickup**): autosave is debounced 3000 ms (`client/app.js:226`) but several triggers flush immediately (`sceneState.on('persisted')` app.js:273, `imported` :259, editing-end :270). The path by which an incoming `scene.deck` change broadcast leads to an immediate outgoing save and/or a re-sent `scene_deck_sync` was not pinned down — that is task 1.

## Fix direction

1. Client: find the `scene_deck_sync` sender and add an echo guard — after applying a remote `scene.deck` change, do not re-send a deck sync unless local content genuinely differs from what was just applied (content hash compare, not object identity). This kills the ping-pong at the source.
2. Client: remote-applied changes must never take the immediate-flush autosave path; they should not mark the project dirty at all (same rule WO-329B established server-side).
3. Server (defense in depth): per-connection coalescing on `scene_deck_sync` — drop a payload identical to the last one applied within a short window, and rate-limit merges to ~1/s per client with a warn log naming the client.
4. Log hygiene: coalesce repeated `[project] pushed <slug>` lines for the same slug within a few seconds into one line with a count.

## Acceptance

- Two GUI clients open on the same project, both idle: journal shows no sustained `scene_deck_sync` traffic (occasional singles are fine) and no repeated `pushed <slug>.json` lines.
- Deck edits still replicate between the two clients within ~1 s.
- `rev` no longer climbs while idle (it was at 685 on llkk after the burst).

## Constraints

- Do not weaken WO-329B last-write-wins semantics or the unchanged-content no-op guard (`projectContentEquals`, `project-scenes.js:202`).
- Client changes need `npm run build:client` + kiosk reload; repoint any smoke tests that grep moved source text.
