# WO-329 — Project loading/saving robustness + two clients editing the same project

**Source:** todos24.07.26 — "Loading saving projects." / "Projects running on two clients."

> **Part A DONE 2026-07-24 (ff3e5f9 + 21f0fdf, verified live).** Server-issued monotonic rev.
>
> **Part B DONE 2026-07-25 — OWNER DECISION: neither Option 1 nor 2. "We need last write wins,
> but we also need the last write to be pushed to the other client."** Root cause of "changes
> just weren't updated from one client to the other" found and fixed: the AUTOSAVE path (where
> nearly all edits travel) never broadcast `project_sync` — only explicit Save/Load did — and a
> client whose rev went stale got log-only 409s forever (its edits never persisted again).
> Shipped: changed autosaves broadcast the stamped project; unchanged persists are full no-ops
> (no rev churn, no broadcast — `projectContentEquals`); on `stale_rev` the client adopts the
> server rev from the 409 body and re-pushes its current state (bounded at 3 consecutive
> conflicts) so the last writer truly wins; self-echo latch on changed autosaves; remote-sync
> toast throttled to 10 s. SERVER change — active on next node restart; client rebuilt (kiosk
> reload). Two-browser live verification still owed at that restart.

## Verified current state (2026-07-24, source read)

### Persistence
- Endpoints in `src/api/routes-data-project-handlers.js`: `POST /api/project/save` (~line 31),
  `POST /api/project/autosave` (~372, with the WO-311 anti-resurrection guard at ~386-408),
  `GET /api/project/load` (~156, merges autosave then broadcasts), `POST /api/project/new` (~213).
- Conflict check is `validateIncomingProject()` in `src/engine/project-scenes-persist.js`
  (~89-121): the incoming payload's **client wall-clock `savedAt`** must be >= the stored one,
  else 409 (`stale_saved_at`; also `empty_over_nonempty`, `unrelated_scene_set`). This is the
  exact mechanism behind the todos22 line-15 409 ("payload is older than the stored project"),
  which was diagnosed as clock skew (box had no NTP sync). The durable fix — a **server-issued
  monotonic `rev`** — is already proposed in a comment (~line 52 of project-scenes-persist.js)
  and NOT implemented.
- Client edits live **in-memory only** (`client/lib/project-state.js`); only the project NAME
  is in localStorage (`casparcg_project_name`). Autosave POSTs every ~3 s (`client/app.js`
  ~202-276). On 410 it latches autosave OFF; on 409 it only logs + fires an event — the
  operator gets no durable recovery path and keeps editing a doomed copy.

### Two clients
- Server broadcasts `project_sync` (debounced 150 ms, `src/api/routes-data-project-sync.js`)
  after save/autosave/merge. Every client's handler (`client/lib/app-ws-handlers.js` ~183-192)
  calls `projectState.importProject(..., { silent: true })` — a **whole-project overwrite**.
- Live deck edits also flow via WS `scene_deck_sync` → `mergeDeckSyncIntoProject()`
  (project-scenes-persist.js ~182-224, debounced 750 ms persist).
- Net behavior with two browsers on one project: **last-write-wins at whole-project
  granularity**. Client B's uncommitted in-memory edits are silently discarded every time
  client A's autosave round-trips. Nothing detects or reports the collision. There is no
  TODO in the code acknowledging this — the single-editor assumption is implicit.
- (Leader/follower replication — `mergeSharedProjectIntoLocal()` — exists but is a different,
  one-leader mechanism; it does not help two operator browsers.)

## Fix direction

Part A — kill the wall-clock 409 (do this first, small and load-bearing):
1. Server-issued monotonic `rev` on every stored project; save/autosave must echo the `rev`
   they were based on. Compare revs, not `savedAt`. Keep `savedAt` as display metadata only.
2. On rev mismatch, the server should return the CURRENT project in the 409 body so the
   client can offer "reload theirs / keep mine (save-as)" instead of a dead-end toast.
3. Preserve the WO-311 anti-resurrection and `empty_over_nonempty` guards exactly — they are
   orthogonal to the timestamp swap and must not regress. Extend their tests to rev-based flow.

Part B — make two clients survivable (scope decision for the owner, pick one):
- **Option 1 (cheap, honest):** advisory single-editor lock. First client to edit holds the
  edit lease (heartbeat over WS); other clients see the project read-only with "editing on
  <hostname>" and a takeover button. Last-write-wins disappears because only one writer exists.
- **Option 2 (real co-editing):** section-scoped merge — the project is already structured
  (scenes/looks, timelines, multiview, program output); merge `project_sync` per section and
  only overwrite sections the local client has NOT touched since its last ack'd autosave;
  touched-but-remote-changed sections surface a conflict chip in the UI.
- Recommendation: ship Option 1 now (it also fixes "projects running on two clients" for the
  realistic operator+laptop case), keep Option 2 as a follow-up WO if真 co-editing is wanted.

## Acceptance
- Two browsers, same project, box clock deliberately skewed ±2 h: zero 409s from skew; edits
  from the active editor persist; the passive client either sees read-only (Opt 1) or keeps
  its untouched sections (Opt 2). No silent loss of an edit made in the last 3 s window.
- Kill -TERM the node service mid-edit: reload recovers the autosave (existing behavior kept).
- 409 path (genuinely stale payload, e.g. stale tab after takeover): client shows the
  reload/save-as choice, never a log-only failure.
- Offline tests: rev compare table (fresh/equal/stale/missing-rev legacy payload), lock
  lease grant/expiry/takeover, anti-resurrection regression suite still green.
  `npm run test:ci` → 0 fail.

## Constraints
- Legacy payloads without `rev` (older tab open across the deploy) must not brick saving —
  one grace path: accept-once and stamp.
- Server restart must not reset `rev` backwards (persist it inside the project file).
- LIVE box: the autosave path is load-bearing for the running show — no behavior change to
  the happy path other than the compare field.
