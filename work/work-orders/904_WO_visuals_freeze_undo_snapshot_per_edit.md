# WO-904 — Changing any Visuals value froze the output: a whole-show undo snapshot on every edit tick

**Area:** godot-client
**Status: DONE (31.10.26 — real client probe through the read-only proxy, ProjectSync + undo live: slider drag 80 → 40 ms/frame, 4 edits a frame 194 → 41 ms (idle 40); undo / quick edit / Ctrl+Z / redo steps correct; Godot --test 25291/0, --check OK; smoke 4/4. On-air stall log after the fix is owner-QA on the real faders)**

## Owner report (31.10.26)
"when moving the fader the whole visual stops moving" · "basically changing any value live, stops the output. only
master fader works as expected."

## 1. Investigation
- Read-only stall logger on `/dev/shm/highascg-visuals` (header seq @96, 10 ms sampling) while the owner moved values:
  14:23:51–14:24:08 nine stalls of **0.8–2.0 s**, one every ~2 s. Journal of that window: nothing server-side.
- The earlier freeze probe (MIDI CCs, slider, project echoes) showed no stall — it had isolated ProjectSync
  (`project_gone = true`), and `ProjectSync.mark_dirty()` returns before `edited.emit()` then.
- Every Visuals value edit ends in `visuals_tab.gd _store()` → `ProjectSync.mark_dirty()` → `edited` →
  **`core/project_undo.gd _on_edit()` → `history.record(Model.snapshot(Store.project), …)`** (WO-642). `snapshot` =
  `JSON.stringify(JSON.parse_string(JSON.stringify(p)))` of the whole show.
- Measured on the box: the live project `mhp_harder.json` canon = 598 208 bytes in **37–40 ms** (pixelMappings 216 KB,
  pixelMappingProposal 236 KB, fixtures 91 KB) — per edit, on the main thread.
- Real client, probe with sync + undo live (writes swallowed by `tools/dev/readonly-proxy.js`): idle 40 ms/frame,
  slider drag one edit/frame **80 ms**, four edits/frame (MIDI CCs are not input-accumulated — an APC40 fader sends
  several a frame) **194 ms**; the same drag with undo disconnected 41 ms. The master fader is not a project edit,
  hence "only master works".

## 2. What was done
- **`core/project_undo.gd`** — `_on_edit` only marks the edit and restarts a 0.3 s settle timer; when edits settle,
  `_snap_async` takes `Model.detached(Store.project)` (deep copy without bookkeeping, ~5 ms) and canon()s it on a
  `WorkerThreadPool` task; `_process` collects it into the history. Undo / redo `_flush()` first (timer stopped, task
  awaited, a still-pending edit snapshotted synchronously) so Ctrl+Z right after an edit still undoes it. A rebase
  (load / remote sync) bumps `_gen` so a snapshot taken before it is dropped. The step is stamped with the burst's
  FIRST edit time (`_edit_ms`), so the model's 600 ms coalescing means what it did before (a late stamp merged a
  quick edit into the previous drag — caught by the probe).
- **`core/project_undo_model.gd`** — `detached(p)`.
- Alternatives not taken: dropping project undo for Visuals (loses Ctrl+Z on looks / layers); a cheaper canon (the
  parse round trip is what makes restored floats compare equal — WO-642 test).

## 3. What was VERIFIED
- Probe (scratch tree = live tree + `--probe-freeze`, Xvfb, `HIGHASCG_SERVER` → read-only proxy): drag 40.0–40.8 ms,
  drag ×4 40.5–41.6 ms, idle 40.2 ms. Undo sequence: drag → settle → `can_undo`; quick edit + immediate undo → back to
  the drag end (0.39); second undo → before the drag (0.89); redo → 0.39.
- `tests/test_project_undo_model.gd test_detached_snapshot_on_a_worker_matches` (worker canon of a detached copy ==
  snapshot(), unaffected by later edits); Godot `--test` 25291 passed / 0 failed; `--check` boot OK.
- `tools/smoke/smoke-wo904-undo-snapshot-off-edit-path.test.js` 4/4.
- Owner-QA: move layer / parameter faders (UI and APC40) while on air — the output keeps moving.
