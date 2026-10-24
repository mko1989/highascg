# WO-746 — One shared project across linked servers (WO-732 P2 = WO-712 R5 = the WO-670 piece never built)

**Status: IN PROGRESS — BUILT, OFF (25.10.26). Proven offline (merge 9, gates 19, e2e smoke 6, `run-cluster-e2e --scenario=show` 10/10 on three sandbox servers) and deployed on this box with sharing off (live `GET /api/cluster` → `show.on: false`; the Devices toggle asks before switching on, Cancel leaves it off). Switching it on, on both boxes, is the owner's call (both are on-air). Detachable: see "How to remove".**

## Investigation

- Owner decision **WO-712 D2** (23.10): *"Duties first, shared project next … both work on the same project makes it
  required, not optional."* WO-670 answer 2 asked for it too.
- State on 24.10, after WO-732:
  - Links are mutual and self-repairing (WO-732 P1).
  - Any client can cable any linked server (WO-732 P3b).
  - Each server still runs **its own** project. Screen destinations therefore have different ids per box: this box
    has PGM/PRV 1 + 2, .4 has only the Operator GUI (WO-732 P3b screenshots). A "shared destination" cannot match
    across them, so takes are not forwarded ("no shared destination is cabled there", on .4's card for this box).
- Design already written (WO-712 R5, WO-732 plan P2): the master pushes the show over the signed cluster channel,
  by revision with epoch fencing; device-local slices are stripped; each server keeps its own cables.
- Findings that shaped the build (25.10):
  - **Every project write goes through one function**: `persistProject` (`src/engine/project-scenes.js`): operator
    saves, autosave, look edits, loads. One hook there sees every change; `web_project` in persistence is the
    in-memory current project (`src/cluster/shared-show-ctx.js` `current()`).
  - **Size**: the largest project on this box is 6.7 MB; `stableJson` + sha256 of it ≈ 56 ms. Sending it per
    autosave is not acceptable → item-level deltas against a show the receiver holds, the whole show only once.
    The HTTP body cap is 10 MB and `postJson`'s default timeout 5 s → `cluster-call.js` `call()` gained a
    per-call `timeoutMs` (30 s for a whole show).
  - **The signed call has two lists** (WO-712): `info` (not locked by accept_remote) and `actions` (locked).
    A push from the master is information; an edit proposed to the master is an action, so "Linked servers may
    press here" off on the master locks remote edits out, as it does remote takes.
  - **Device-local data**: `hardwareConfig` (device graph, cables, Caspar wiring, screen ports) and stream keys
    differ per box; `rev`, `savedAt`, `slug`, `streaming`, and `_`-keys are local bookkeeping
    (`show-merge.js` `VOLATILE`). Screen destinations ARE shared (that is the point: same ids on both boxes).
  - **Caspar**: `screenDestinations` is not in the recycle signature (WO-747), so taking a show never restarts
    Caspar; when the taken destinations ask for a different channel layout than the running casparcg.config, the
    server must say so instead (G10).
  - **Syncthing** syncs `projects/`: backups the feature writes must stay box-local (`.stignore`).
- Owner questions, taken with the recommended answers (the build lets either be changed in one place):
  1. The follower's project at first sync: **backed up** (`projects/_cluster/<slug>.before-share-<time>.json`),
     then replaced.
  2. Edits on a follower: **sent to the master and merged** (3-way, per item, master wins on a conflict).

## What was done

The master is the single writer. Gates G1–G10 are written in the header of `src/cluster/shared-show.js`; every gate
is a named test.

- `src/cluster/show-merge.js` (new) — the show as data: `showOf` (strip device-local + volatile), `hashShow`, `diff`
  / `apply` (item-level ops: arrays whose items all have a unique `id` are keyed by id, so a look, timeline or cell
  is one item; ops are set / delete / order), `merge3` (base, ours = master, theirs: non-overlapping changes both
  stay, overlapping paths keep ours and are reported), `intoProject` (a taken show + this box's own slices).
  Why item-level and not a JSON patch: two operators on two different looks must both survive (G7), and the
  conflict report must name the look.
- `src/cluster/shared-show.js` (new) — `createSharedShow(deps)`: pure logic, every side effect injected (so the
  same code runs in the in-memory harness and on the server).
  - Master: on every own write / tick, push to each peer — a delta if the peer acked a base it still holds, else
    a probe, `need_full` → the whole show at once (first sync 27 ms in the sandbox run). Refusing peers are
    retried at the heartbeat (5 s), never sent the whole show blindly.
  - `show.push` receiver (follower): gates in order — off / pair 409, is master 409, not the claimed master
    403, epoch 409, stale rev 409, own edit in flight 202, same 200, base check → `need_full`, hash verify,
    backup (`before-share` first time, `diverged` when local edits the master never had would be lost), commit.
  - `show.propose` (master): epoch, base lookup (current show or the last 48 in history), hash verify, merge,
    commit as an own write (which pushes to the others); the answer carries the ops theirs → merged so the
    proposer converges without a second push.
  - Follower edit: the write hook diffs against `local` (primed before the edit), queues behind the one in flight
    (fast typing folds into one proposal), retries on network / 5xx / epoch moves, backs up + reverts on a refusal.
    A follower proposes only once it holds a master show (found on the live box: .4 has no `show.propose` yet;
    without this every local edit would be refused and backed up).
  - `view()` for `GET /api/cluster` `show` and WS `cluster:show`.
- `src/cluster/shared-show-ctx.js` (new) — the real deps: `commitShow` = `persistProject` + screen destinations
  applied only when they changed + artnet + project-sync broadcast, **no Caspar call** (pinned by a smoke);
  `backupProject` → `projects/_cluster/`; `casparLayoutDiffers` compares the `<video-mode>` sequence of the
  generated (or override) config with the file Caspar runs.
- `src/api/routes-cluster.js` — `showOf(ctx)` (lazy), `show.push` into `info`, `show.propose` into `actions`,
  `tick()` in afterPoll, `show` in `GET /api/cluster`, `POST /api/cluster/show {on}` (400 unless boolean).
- `src/engine/project-scenes.js` — one line before `persistProject` returns: `ctx._clusterShow?.written()`.
- `src/cluster/cluster-call.js` — `call(…, { timeoutMs })`, `callMaster(action, args, opts)`.
- `.stignore` — `/projects/_cluster` (**mirror on the Mac**: `.stignore` does not sync).
- Godot: `cluster_model.gd` `show_line` / `show_warns`; `cluster_panel.gd` "Share the show" beside "Linked servers
  may press here" — switching on asks first (Kit.confirm: "its own project is saved first … Caspar is not
  restarted"), off is direct; one muted status line under the master line, warning colour when the operator must
  act (conflict / refused edit, Caspar layout differs, hot-backup pair). Minimal: nothing shows while it is off.
- Harnesses:
  - `tools/e2e/shared-show-harness.js` — N servers in one process with real ed25519 signed calls
    (`cluster-call.js`), a fake network with `cut` / `heal`, a controllable clock, `restart()` (memory gone,
    store + project kept), `settle()` (polls until quiet for longer than a heartbeat).
  - `tools/e2e/shared-show-scenario.js` + `run-cluster-e2e.js --scenario=show` — real sandbox servers over HTTP,
    operators as API clients (GET project → change → POST save, retry once on 409), refused against live nodes.
- Repointed (not weakened) pins: `smoke-wo712-exchange` and `smoke-wo723-duties-from-config` (the info line gained
  `...showOf(ctx).info`). API contract docs regenerated (the new route).

## What was VERIFIED

- `smoke-wo746-show-merge` 9/9 — diff/apply round trips, keyed arrays, order + add, volatile/device-local stripped,
  merge3 both-sides, conflicts named.
- `smoke-wo746-shared-show-gates` 19/19 (three servers, real signed calls): G1 off by default; G1 one side off
  (probe, heartbeat, then takes it once switched on); G1 on here but not on the master — nothing proposed or
  backed up (fails without the `!held` guard: checked); switching on acts at once; G8 + G9 first take backs up and
  keeps cables, Caspar, stream key; master edit as a delta; follower edit merged and reaching the third; G7 three
  operators on three looks; G7 same look (master's stays, follower's kept as a file, both say so); fast typing;
  G6 accept_remote off; G3 non-master push; G4 split network (old master cannot overwrite; its edits backed up as
  `diverged`); G4 old-epoch proposal waits and goes again; G5 replayed push; G2 hot-backup pair; follower restart;
  master restart; switching off.
- `smoke-wo746-shared-show-e2e` 6/6 — wiring pins (persist hook position, info/actions/tick/route, .stignore,
  `commitShow` has no Caspar call) + the 3-sandbox scenario + live nodes refused.
- `node tools/e2e/run-cluster-e2e.js --scenario=show` → 10 pass, 0 failed (25.10 00:45): converge after switching
  on 28 ms, master edit 13 ms, follower edit 13 ms, three concurrent 20 ms, same-look 14 ms.
- Godot: 21649 passed / 0 failed (`test_show_line` new); boot check OK.
- Clean-export gates: repo-integrity, max-lines, unwired, boot, format rc=0; test:ci after the two pin repoints
  and the contract regen: only WO-498 (export-only) expected — see the commit.
- Live on this box (25.10 00:46, server restarted on the new code, kiosk restarted, WO-730 way):
  `GET /api/cluster` → `"show": {"on": false, "role": "off", …}`; `POST /api/cluster/show {"on":"yes"}` → 400;
  Devices → Servers shows "Share the show" unchecked and no status line; clicking it opens the confirm, Cancel
  leaves it unchecked, `show.on` still false, nothing posted.
- **Not verified (owner QA):** sharing switched on between the two real boxes (.4 also needs this release
  first: it has no `show.push` / `show.propose` yet — until then this box, if switched on, just keeps its own show).

## How to remove (detachable)

1. Delete `src/cluster/show-merge.js`, `shared-show.js`, `shared-show-ctx.js`, `tools/e2e/shared-show-*.js`,
   `tools/smoke/smoke-wo746-*.test.js` and their three lines in `tools/ci/offline-test-files.js`.
2. `src/engine/project-scenes.js`: the `ctx._clusterShow?.written()` line.
3. `src/api/routes-cluster.js`: the two requires, `showOf`, the spreads in `info` / `actions`, the afterPoll
   tick, `show` in `full()`, the `/api/cluster/show` route; repoint the two pins back; regenerate the contract.
4. `run-cluster-e2e.js`: the `--scenario=show` branch. Godot: `_share` / `_show_l` / `_set_share` in
   `cluster_panel.gd`, `show_line` / `show_warns` + `test_show_line`.
5. Harmless to keep: `cluster-call.js` `timeoutMs` / `callMaster` opts, the `.stignore` line, `projects/_cluster/`
   backups (box-local files). The `clusterShow` key in persistence is ignored once the code is gone.

## Switching it on (owner checklist)

1. Both boxes on this release (.4: Updates pane). Mirror `/projects/_cluster` into the Mac's `.stignore`.
2. Off air. On the master first: Devices → Servers → "Share the show" → OK. Then on the other box.
3. The other box's line reads "Show shared from the master · in step"; its old project is in
   `projects/_cluster/*.before-share-*.json`. If it says "Caspar layout differs", press Apply Caspar config.
4. Off again: untick it — the server keeps the shared show as its own project and takes nothing more.
