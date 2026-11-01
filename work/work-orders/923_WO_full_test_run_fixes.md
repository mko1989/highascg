# WO-923 — Full test run 01.11: test:live hung forever, stale live probes, two GUI e2e failures (one a real lost-click bug)

**Area:** process, godot-client, amcp
**Status: DONE (01.11.26 — test:live 23/0 + 3/3 probes; GUI sim 101/101 ×2, air 10/10; Godot unit 25752/0; offline 5218/0)**

Owner, 01.11.26: "Run full suite of tests".

The full set:
- the Godot unit suite;
- `test:ci:full` (every offline smoke, curated or not);
- `test:release`, which chains the curated offline suite, `test:live` (the real box) and `test:release-gui` (the Godot
  client on hidden Xvfb against a sandbox server, plus a throwaway Caspar).

`test:live` had never been run before (WO-836 §3: "The live runner was NOT executed").

## Investigation

### First run

| Group | Result |
|---|---|
| Godot unit | 25752 / 0 |
| `test:ci:full` | 5064 pass / 8 fail / 5 skipped |
| `test:release` offline | 5218 / 0 |
| `test:release` live | hung for 19 min, then 5 fail and 1 probe fail |
| `test:release` GUI | 102 / 104 |

- **`test:ci:full`: 8 failures, none new.** They are the broken uncurated smokes WO-836 lists under "Broken uncurated
  smokes" (and WO-625):
  - `smoke-caspar-cls-id.test.js`: 7 cases need an untracked `media/projects/tetst` fixture.
  - `smoke-wo173-clip-start-batch.test.js`: TimelineEngine API drift.
  - Neither file is in the curated CI list.
- **`test:live` never ended.**
  - `highascg-live-amcp`, `smoke-amcp-batch-library`, `smoke-amcp-migration-air-paths` and `smoke-amcp-send-after` all
    passed their tests, then sat at 0 CPU in `ep_poll` for 19 min with no TCP socket open.
  - A probe script (connect, VERSION, `ConnectionManager.stop()`) never exits; `process.getActiveResourcesInfo()`
    shows 2 Timeouts.
  - The culprit is `casparcg-connection`'s request-timeout sweep, `this._timeoutTimer = setInterval(...)`
    (`node_modules/casparcg-connection/dist/api.js:59`). It is ref'd and only `destroy()` clears it
    (`connection-manager.js` `destroy`); every live test calls `stop()`.
  - With `.unref()` on that timer, the same probe exits 7 ms after `stop()`.
- **`highascg-live-highascg-http.test.js` failed** "requires HIGHASCG_HTTP_PORT". `run-live-tests.js` pre-flights the
  API port itself but never passed it to its children.
- **`http-smoke.js` probe failed**, "GET /instance/wo03-smoke/app.js expected ES module".
  - The probe predates the Vite build (dist-web). `app.js` and `styles.css` no longer exist; the shell names hashed
    `./assets/main-*.js` / `main-*.css`, and an unknown path falls back to the HTML shell (200 `text/html`).
  - The `styles.css` check only passed because the HTML contains `{`.
  - The next check expected the FIRST WebSocket message to be `state`. The server logs "[WS] client connected" before
    it sends the snapshot (`ws-server.js` connection handler), and log lines are broadcast, so a `log_line` arrives
    first. Clients do not depend on the order.
- **GUI 17_wo918_drag_and_stale, "F19: dragging the output dot onto P1": a scenario-isolation bug.**
  - The release suite runs every scenario on ONE sandbox server. The scenario took `destinations[0]` as "the
    destination I just added".
  - Scenario 16 leaves P1 cabled (PGM → mapping node → Output 1 on P1).
  - It passes alone 5/5. It had only ever been run alone.
- **GUI 15_wo868_operator_first, "Turn it on": a real lost-click bug.**
  - It passes alone (10/10, and 01–15 together 84/84). In the full suite it failed in 3 of 4 runs with "no confirm
    after the click (status: <null>)".
  - Diagnostics in the failing run: one matching check, visible, enabled, unpressed, on screen; `_busy` false at the
    click.
  - Recording the check's node before and after `ui.click` (press and release are one frame apart) showed
    `same_node=false valid_old=false` on EVERY click: the page was rebuilt under the click, and in the failing runs the
    toggle was lost.
  - Cause: `devices_tab.gd` `show_model` re-ran `_server.show_server(payload, …)` on every Devices refresh while the
    server page was open. `show_server` makes a new flow (`M.init_state`: every section back to "Loading…"), clears
    `_shown` (forcing a rebuild) and runs `flow.start()` again (operator-first, replication, network and cluster
    reads, each re-rendering as it lands).
  - So each refresh rebuilt the page several times over a second or two. That defeats the page's own rule
    (`server_controls.gd` header: "the page is only rebuilt when its items changed, so an open select or a field being
    typed survives").
  - An operator's click (≈100 ms press) on this page could be dropped the same way.

## What was done

- `src/caspar/connection-manager.js`: `this._ccg._timeoutTimer?.unref?.()` right after the library is built.
  - The server never relied on that timer to stay up (HTTP server, sockets).
  - A one-shot user (tests, tools) now exits after `stop()`.
  - Why not change the tests to call `destroy()`: every caller of `stop()` would keep the trap.
- `tools/test-live/run-live-tests.js`: sets `HIGHASCG_HTTP_PORT` to the pre-flighted API port for the children.
- `tools/test-live/http-smoke.js`:
  - reads the module entry and stylesheet from the instance shell and fetches them under the `/instance/…` prefix,
    requiring real JS (`import`, not HTML) and real CSS;
  - the WebSocket check skips `log_line` messages until the snapshot arrives.
- `godot/client/features/devices/server_controls.gd`: new `update_server(payload, settings)`.
  - For an open page it puts the new device view and settings into the SAME flow and calls `_render()`, which rebuilds
    only if the items changed. What the page already read stays.
  - `devices_tab.gd` calls it instead of `show_server` on refresh. Opening the page (`_open_server`) still starts
    fresh.
- `godot/client/e2e/scenarios/15_wo868_operator_first.gd`: new step "A Devices refresh keeps the open page (WO-923)".
  - It waits until the page finished its opening reads (the auto-accept check enables after `/api/cluster`), refreshes
    Devices, waits 2 s, and requires the same check node.
  - It fails without the fix (checked by reverting the one line) and passes with it.
  - A first version measured before the page had settled. The only item that differed was auto-accept enabling, which
    is the page's own load and not the refresh.
- `godot/client/e2e/scenarios/17_wo918_drag_and_stale.gd`: takes the destination its own step added (ids before vs
  after) and drops on the first GPU port no edge feeds yet.
- A Godot unit test of `update_server` was tried and dropped: `server_controls.gd` needs the `DevicesTarget`
  autoload, which the headless unit runner does not load. The e2e step covers it in the real client.

## What was verified

- `test:live` (after the fixes): 24 tests, 23 pass, 0 fail, 1 skipped. The skip is the WO-232 Mario render, which
  needs `puppeteer` (not installed).
  - Probes `http-smoke`, `smoke-caspar` and `verify-streaming-channel` all PASS.
  - The four AMCP files alone: 13/13 in 0.3 s (they hung forever before).
- GUI release suite, sim phase, with the final step: 101/101 in 2 runs. Air phase 10/10 earlier in the day.
  - Scenario 15 alone: 11/11; 17 alone: 5/5. The new step fails with the fix reverted.
  - Over 4 full sim runs the new step passed every time.
  - The three earlier full-run failures of the step ("the check is a new node") came from its first version, which did
    not wait for the page to settle.
  - On failure the step now names the first item that differs, so the next failure explains itself.
  - Two other full runs had a `07_pixel_map` failure:
    - **255-filled ArtDMX on 127.0.0.1:6455.** My own overlap: the offline `smoke-wo615-dmx` sends there and I ran
      it at the same time (it also failed `EADDRINUSE`; alone 8/0). Never run the offline suite next to the GUI
      suite.
    - **"Intensity: Override at 100 %": dimmer 0 / W 255 after 4 s,** with the switch ticked and saved in the shot.
      Nothing else ran. Seen once in about 20 full runs; not reproduced, cause unknown.
- Offline curated suite: 5218 / 0 (alone). Godot unit: 25752 / 0; `--check` boot OK.
- eslint on the changed JS: 0 errors. `format:check` OK. 0 files over 500 lines.
- **Not fixed, recorded:**
  - The 8 `test:ci:full` failures (WO-836's broken uncurated smokes).
  - The live batch tests send `PLAY 1-10 AMB` / `PLAY 1-11 AMB` to the REAL Caspar. On this box channel 1 is the
    operator GUI channel (operator-first). There is no AMB clip (404), so nothing plays, but it is a live command on
    the GUI channel.
  - The server page still rebuilt fully whenever an item changed: fixed below, in "Round 2".

## Round 2 (01.11.26, owner: "Fix 2")

### Investigation

- `server_controls.gd` `_render` freed and rebuilt EVERY node whenever any item differed.
- With a paired backup, items change on nearly every 3 s poll:
  - `replication_format.gd` `status_line` ("show synced %s" via `age_ms`);
  - `peer_rows` ("Peer status · ping Ns ago", "Commands sent", "Queue depth", "Mirror seq", "Drift sampled");
  - all of them are built with `now` (`server_page_model.gd` `connection_items`).
- So the whole page would be rebuilt every 3 s, and a click whose press and release straddled a rebuild was lost, the
  same failure as round 1. This comes from reading the code; the box has no paired backup to watch it happen.

### What was done

- New `godot/client/features/devices/page_item_reuse.gd`: `plan(old, new)` maps each new item to an equal old item
  whose node is kept, or -1.
  - The same index wins; otherwise the first unused equal item, so a line appearing above does not rebuild the rest.
  - Each old node is used once.
- `server_controls.gd` `_render`: keeps the nodes `plan` allows, builds only the changed items and reorders the
  page.
  - The radios share one `ButtonGroup` across renders.
  - Focus restore applies only to rebuilt fields.
  - `_shown = []` still forces a full rebuild: `show_server`, and the operator-first switch putting a refused change
    back.

### What was verified

- Godot unit tests: `tests/test_page_item_reuse.gd` (8 asserts), whole suite 25760 / 0. `--check` boot OK.
- e2e `15_wo868_operator_first`, new step "A status line changing keeps the other controls (WO-923)": it changes the
  hot-backup line the poll writes, re-renders and requires the same check node.
  - Alone: 12/12.
  - With reuse disabled (`plan([], items)`) the step fails with "the check was rebuilt for a status line change".
