# WO-819 — Verify, test and commit the open work of 29.10 (WO-806/807/812/813/814/816/817 + docs)

**Area:** process
**Status: DONE (29.10 — 7 commits on main, every unit tested in a detached worktree at its own commit, CI green,
live PRV-only probe, GUI screenshots of the relaunched owner client, pixel-map GUI e2e 9/9)**

Owner request (via the session, 29.10): the uncommitted work of the day, grouped by work order, each unit verified at
the commit itself, committed with explicit paths, pushed, CI watched; record here.

## Investigation

- `git status` at 92601218: 64 modified tracked files + 30 untracked. Grouped by the WO numbers in the diffs and file
  names. Mixed files: `tools/ci/offline-test-files-2.js` (WO-807 / 813 / 814 lines), `docs/wiki/api/contract/http.md`
  (WO-813 layer-scrub row, WO-807 proposal rows, route count), `work/OPEN_ISSUES.md` (rows of 807, 812, 813 ×2, 814,
  816, 817). Split per unit by writing the unit's version of the file as a blob (`git hash-object -w` +
  `git update-index --cacheinfo`, a line-level partial apply of the working-tree diff against HEAD); http.md's count
  line was recomputed per unit (520 → 521 at WO-813, 524 at WO-807) and checked by `smoke-wo598-api-contract`
  (`gen-api-contract --check`) in each unit's offline run.
- Files outside the units, by owner: `src/system/video-surfaces.js` (exports `segmentFor`) and
  `tools/smoke/smoke-wo719-sandbox-guards.test.js` (pin) belong to WO-807 (the sandbox-safe sampler path);
  `godot/client/e2e/e2e_ui.gd` (`press_drag`, `reveal`) to WO-807's e2e; `client/components/scenes-shared.js` and
  `godot/client/features/live/live_tab.gd` (`--probe-select`) to WO-813; `tools/smoke/smoke-wo574-…` (expected batch
  order) to WO-814.
- Pre-check on the full tree: `check-unwired-exports` failed on 3 new orphan exports in `client/lib/clip-trim-model.js`
  (`msToFrame`, `outMs`, `snapMs`, used only inside the module) → `export` dropped (in the WO-813 commit). Local
  `eslint .` shows 393 errors only from the untracked build output `godot/export/web-demo/` (not in a checkout).
- WO-800: nothing of it was uncommitted (its `osc-state.js` change is WO-813's trim-out timing). No unit 7 commit.

## What was done (commits, oldest first)

| commit | subject |
|---|---|
| d45d894d | WO-813: look layer clip trim (compact Trim row, PRV scrub, trim-out timing) |
| 553344cb | WO-814: take order — look straight to PGM, PLAY last in the batch |
| 1ee51c22 | WO-816/817: look editor — drop exchanges a layer's media; audio-only layers list-only |
| 29d83f9b | WO-807: pixel map edge proposal, review modal and tooltip; GUI e2e |
| 79060d4a | WO-806: compact audio dock inputs as vertical fader columns |
| 65a90238 | WO-812: Previs "Projector beams" toggle |
| 6ddf3fa1 | docs: dev-mode note and README intro |

Not committed (not this work): `config/` (live runtime state), `next.md`, `godot/client/openxr_action_map.tres`,
`work/work-orders/820_WO_notchlc_native_gpu_decode.md` (the NotchLC agent's), `godot/export/` (build output).

## Verified

Per unit, in `git worktree add --detach /tmp/claude-1000/wt-N HEAD` at the unit's commit (node_modules linked):
repo-integrity, max-lines, unwired-exports, `node index.js --no-http`, eslint (≤ 216 warnings), prettier,
`npm run build:client`, offline suite, Godot headless tests, `run-client.sh --check` — all green:

| unit | offline (tests / pass / fail / skipped) | Godot tests | boot |
|---|---|---|---|
| WO-813 | 3543 / 3535 / 0 / 8 | 22464 / 0 | OK |
| WO-814 | 3549 / 3541 / 0 / 8 | 22464 / 0 | OK |
| WO-816/817 | 3551 / 3543 / 0 / 8 | 22502 / 0 | OK |
| WO-807 | 3571 / 3563 / 0 / 8 | 22561 / 0 | OK |
| WO-806 | 3571 / 3563 / 0 / 8 | 22729 / 0 | OK |
| WO-812 | 3571 / 3563 / 0 / 8 | 22733 / 0 | OK |

(8 skipped in a clean worktree vs 2 in the live tree: tests that skip without untracked box data.)

- **CI:** push 92601218..6ddf3fa1 → CI run 40900763545 success (4m44s), Pages 40900763405 success.
- **Live, node restarted 16:21:54 (dev mode), PRV only — Caspar log: no command to channel 1 during the tests:**
  - Trimmed copy of the PRV look (Intro, layer 10 trim 2000–6000 ms; an ad-hoc `incomingScene`, no project change)
    taken with `POST /api/scene/take {channel 1, target preview, forceCut}`: 200 in 251 ms; Caspar
    `LOADBG 2-10 PROJECTS/MHP_HARDER/INTRO_HAP IN 100 SEEK 100 LENGTH 200` (50 fps channel), then a BEGIN…COMMIT of
    `PLAY 2-10/11/12`; node OSC for 2-10: `clipIn 2, clipLength 4, outPoint 6`, remaining 2.72 → 1.20 → 0 and the
    clip held at 6.0 s (trim-out honoured in playout and in the node's timing).
  - `POST /api/scene/layer-scrub {Intro, layer 10, ms 3000 | 20000}` → `{onPrv: true, channel 2, frame 150 | 1000,
    chFps 50}`, Caspar `CALL 2-10 SEEK 150 / 1000`, OSC elapsed 3.40 / 20.34. (For a look not in the project the
    route answers 404 "layer 10 has no source" — it resolves the stored look; expected.)
  - PRV restored with `POST /api/scene/preview-push {Intro}`; PGM and PRV both on Intro before and after.
  - `GET /api/fixtures/pixelmap/proposal` → ok, 3 walls, 56 mappings (already applied, pending false).
  - WO-814 PGM order not re-measured live (no PGM take in this pass; WO-814's own live PGM measurements stand,
    the smoke pins the order).
- **GUI e2e** `node tools/e2e/run-gui-e2e.js --e2e=07_pixel_map` (sandbox, Xvfb): 9 passed, 0 failed.
- **Owner client relaunched** (windowed, flags only, no input on :0); screenshots of the operator screen in
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/verify_all/`:
  - `u1-u3-live-editor-trim.png` — look editor on Intro (`--probe-edit --probe-select=0 --probe-trim=open`): Trim row
    open (Trim in 0:00.00 / Trim out 1:03.08, ↺, slider), no Custom in "Clip start point"; viewer draws only L10,
    the two .wav layers are list-only (WO-817).
  - `u5-audio-dock-open.png` — Audio tab with `--probe-docks`: Program audio dock open, masters and the input as
    vertical fader columns. `u5-audio-tab.png` after the probe closed it again.
  - `u4-u6-previs-pixel-proposal.png` — `--open-pixel-proposal`: the review modal (56 fixtures · 896 pixels · 3 walls,
    "already holds this proposal"); log tooltip line "56 mappings applied from the automatic proposal (896 pixels)".
  - `u6-previs-toolbar-beams.png` — Previs toolbar with the "Projector beams" checkbox (on), beams drawn.
  - `final-live-tab.png` — the client left running (`--autostart --tab=0`).

## Owner QA (unchanged from the unit WOs)

Real drag on the trim slider + take; a show take on PGM (WO-814); drag onto a layer box / row (WO-816); the proposal
modal's Accept / Dismiss on a new MVR (WO-807); the beams switch on the glass (WO-812).
