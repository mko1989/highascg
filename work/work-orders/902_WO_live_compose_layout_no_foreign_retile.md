# WO-902 — Live preview windows shrink on their own: `run-client.sh --check` re-tiled the shared compose layout

**Area:** godot-client, testing-ci
**Status: DONE (31.10.26 — A/B through a read-only proxy: the old `--check` posts the exact live tiny layout + a project autosave, the new one posts nothing; smoke 3/3; Godot --check / --test 25290/0 with no server. The owner's windows stay small until the owner presses Auto once or resizes them — a restore POST was refused as a shared-state write, so it is the owner's call)**

## Owner report (31.10.26)
"while you work im on the live tab and i can see the windows in the live preview, changnig size to the smallest.
whatever you do should not affect the windows position/size … just to investigate why it even happens."

## 1. Investigation
- The PGM / PRV windows of the Live tab's 2D preview are ONE server-wide layout (`/api/operator-gui/layout`,
  persisted in `.highascg-state.json` `operatorGuiLayout`, broadcast to every client as `operatorGuiLayout`; also
  mirrored into the active project's `operatorCompose` 2 s later — `operator-gui-compose-persist.js`).
- Live layout at the report: `pgm_1 {x 0.22897, y 0.42450, w 0.043416, h 0.036019}`, `pgm_2 w 0.036019` — the owner's
  13:23 arrangement (`projects/mhp_harder.json operatorCompose`, `pgm_1 w 0.228`) shrunk ~5×.
- `features/live/compose_tiles.gd _retile()` (WO-658 "Auto") tiles the windows into what THIS client's panel shows of
  the canvas (`AL.visible_view(size, ir, canvas())`) and `_post()`s it for everyone. `live_preview.gd:70-71` read
  `[live] auto` with default **true**. The owner's ui.cfg has `auto=false`.
- Every layout save (`savedAt` 13:33:15, 13:42:17) sits 1 s after a `[WS] client connected` in the journal — a client
  boot, not the owner. The MIDI / lockscreen probes copied the owner's ui.cfg (auto=false) and opened other tabs, so
  they were ruled out.
- **`run-client.sh --check`** (run before every commit by me, every agent and the gate script) boots the real app
  headless for 4 s with `--tab=1` (= Live), a fresh `XDG_DATA_HOME` (WO-753 — no ui.cfg → Auto ON) and the default
  server, i.e. **the box's live server**. Its headless panel is tiny → `_retile()` → POST.
- **Proof** (`scratchpad/wo902/proxy.js`: GET + WS passed to :4200, every POST logged and swallowed, GET layout served
  from the owner's 13:23 cells): one `--check` of HEAD posted, in order, the layout unchanged (atlas opt-in), a
  partly re-tiled one, then `pgm_1 {x 0.22896984, y 0.42450236, w 0.04341566, h 0.03601892}` … — the live values to 8
  digits — plus `POST /api/project/autosave` (598 KB), `/api/media/preview`, `/api/video-surfaces/lease`,
  `/api/stage/mvr/…/types`. So every check also rewrote the live project autosave.
- `_take()` (every other client's broadcast) also called `_retile_soon()`: an Auto client answered a foreign layout by
  posting its own tiling back (two Auto clients with different panels ping-pong).

## 2. What was done
- **`run-client.sh`** — `--test` / `--check` export `HIGHASCG_SERVER=http://127.0.0.1:9` (closed discard port) unless
  `HIGHASCG_TEST_SERVER` names one on purpose: the checks need no server (CI runs them without one) and must never
  write the box's state. Env beats the ui.cfg connection profile (`config.gd resolve_origin`).
- **`compose_tiles.gd _take()`** — re-tiles only for our own fetch (`with_media`, i.e. `refresh()`), never for a
  broadcast.
- **`live_preview.gd`** — `[live] auto` defaults to **false**: a client that never had Auto pressed (new laptop, test
  client) never writes the shared layout. Clients that saved `auto=true` keep it.
- Not done: restoring the owner's 13:23 layout — the POST was refused as a write to shared state; the owner presses
  Auto (or drags), or says to restore `mhp_harder.json`'s `operatorCompose`.

## 3. What was VERIFIED
- A/B through the proxy: HEAD `--check` → 3 layout POSTs + autosave; the fixed tree's `--check` → **zero** POSTs.
- `./run-client.sh --check` boot OK and `--test` 25290 passed / 0 failed with the dead server.
- `tools/smoke/smoke-wo902-compose-no-foreign-retile.test.js` 3/3.
- Owner-side: the current layout is still the small one.
