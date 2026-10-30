# WO-797 — Decode the previs fixtures only while a client looks

**Area:** lighting
**Status: DONE (27.10, box: server CPU 41.5 % → 13.3 % with no previs open; watch on/off proven over WS and with a Godot client per tab) — owner QA: Previs tab / Live 3D / headset still show the beams**

Owner, 27.10, asking whether the 3D previs has to be switched off during a show to save resources:
> is there a need to somehow disable the 3d prev for the show, so it doesn't use resources when not actually needed?
> whats the performance difference

and, after the measurements below:
> do the decoding only when a client looks.

Related: [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) T5 / T7 (the `tracking:fixtures` decode, visualiser mode),
[WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md) (a hidden 3D view is not rendered),
[WO-796](./796_WO_magicq_show_from_highascg_mvr.md) (the 199-head MHP rig).

## Investigation (27.10, box, MHP rig: 199 fixtures / 5949 beams)

- **Server: the decode runs all the time.** `src/tracking/register.js` `fixturesTick()` ran every 33 ms tick:
  `_follow.visual()` decodes every typed fixture (`follow-service.js:216-225` → `gdtf-visual.js` `decodeVisual`) and
  `JSON.stringify`s the result (287 KB) only to compare it with the last one. It broadcast on change to every client.
  - A CPU profile of the live server (inspector, 10 s, 1 ms sampling) put `fixturesTick` at **33.8 % of the main thread**,
    `decodeVisual` alone at 26.4 %. That is two-thirds of all the server's busy time, on the event loop that also
    serves AMCP / OSC. Nobody had the previs open and MagicQ's DMX was static.
  - An offline replica gives the same number: decode 11.3 ms + stringify 2.1 ms per tick = 40 % of a core at 30 Hz.
- **Clients: every client parsed every change.** The broadcast went to all clients, whether their previs was shown or
  not. Godot's `JSON.parse_string` of one payload takes 8.6 ms (headless bench); parse + `fixtures_3d.gd apply()` ≈ 20 ms
  (WS handler timing in an instrumented copy). With an effect running (up to 30 changes/s) that is up to ~60 % of a core in
  each client, the desktop GUI included. A static look sends nothing (10 s sample: 0 events).
- **The 3D render itself is already off when hidden** (WO-617: `previs_tab.gd:347`, `live_stage_3d.gd:99` set the
  SubViewport `UPDATE_DISABLED`). Measured on a hidden X display with the NVIDIA GPU: Live tab GPU 4 % / 26 fps vs Previs
  3D on screen GPU 20 % / 18 fps; client CPU the same (~103 % vs ~106 %, inflated by presenting to Xvfb). A client
  copy with the Previs tab removed entirely used the same CPU (103 %) — the hidden previs costs the client nothing.
- Side finding, not this WO: the desktop client on the Live tab uses ~50 % of a core (WO-617 measured ~10 % on 21.10).
  Not the previs (above); cause not found.

## What was done

- **`src/tracking/fixtures-watch.js` (new):** `createFixturesWatch()` keeps the sockets that sent
  `tracking:fixtures_watch {on: true}`, each with the message it got last.
  - `tick(visual)` calls `visual()` only with ≥ 1 watcher, and sends only to watchers whose last message differs —
    a view that opens gets the current state at once; a backed-up socket (> 4 MB buffered) skips and catches up.
  - `{on: false}`, the socket's `close` and a CLOSING / CLOSED `readyState` end the watch. `reset()` on a new follow
    service resends to everyone.
  - Why per socket instead of `_wsBroadcast`: a broadcast also makes every hidden client parse the payload.
- **`src/tracking/register.js`:** `fixturesTick()` → `fixturesWatch.tick(_follow.visual)`; `handleWs` routes the watch
  message (namespace `tracking:`). GET /api/tracking/fixtures still decodes on request.
- **Godot:**
  - `features/previs/fixtures/fixtures_watch.gd` (new), a child of every rig (`fixtures_3d.gd`, kept across rebuilds):
    4× a second it checks `F.renders(get_viewport())` — the rig's SubViewport is not `UPDATE_DISABLED` — and holds
    the watch while true. That one state covers the Previs tab in 3D, the Live tab's 3D view and the headset (the walk
    renders through the Previs SubViewport, `use_xr`), because each view already turns its SubViewport off when hidden.
  - `core/ws.gd` `watch(type, owner, on)`: one server-side watch per type, held while any owner holds it
    (`NetUtil.hold`), told to the server on the first hold / last release, and again on every reconnect.
  - `fixtures_3d_model.gd` `renders()` and `net_util.gd` `hold()` are pure (tests load them without autoloads).
- **Docs:** `docs/wiki/api/contract/ws.md` regenerated (`tracking:fixtures_watch` in; the generator's inbound list
  gets `src/tracking/fixtures-watch.js`).
- **Tests:** `tools/smoke/smoke-wo797-fixtures-watch.test.js` (curated list 2): no watcher → `visual()` never runs;
  change once per watcher; newcomer gets the state at once; reset; off / close / closed socket; backed-up socket
  catches up; module routing + source pins (no broadcast left). `godot/client/tests/test_fixtures_watch.gd`:
  `renders()` per update mode; `hold()` per owner.

## Verified

- Godot suite 21917 passed / 0 failed (12 new); `run-client.sh --check` boot OK.
- Smokes wo797 + wo598 (API contract) + wo616 + wo615-visual: 17/17. ESLint, prettier `tools/ci`, max-lines,
  unwired-exports: clean.
- Full curated offline suite: 3413 passed, 0 failed, 2 skipped.
- **Box, after deploy** (server restarted, 39-fixture programmer restored identical; desktop GUI relaunched on the new
  code, on the Live tab):
  - Server CPU (`top`, 10 s samples): **41.5 % / 41.7 % before → 13.2 % / 13.4 % after**, then 9–10 % (the
    probes below gone). The 34 % `fixturesTick` share is gone while nobody looks.
  - Raw WS client (scratchpad `wswatch.js`): 0 `tracking:fixtures` before it watches; the full snapshot (198 fixtures)
    18 ms after `{on: true}`; 1 event in 12 s while the DMX is static; server CPU 35–48 % while it watches (decoding);
    0 events after `{on: false}`.
  - Godot client on a hidden X display (NVIDIA Vulkan): `--tab=1` (Previs, 3D) → server 44.9 % (decoding for it);
    `--tab=0` (Live) → 10.1 % (no watch). Both connected with no script errors.
- Not exercised live: the Live tab's 3D view and the headset (VR stopped by the owner). They hold the watch through
  the same SubViewport state; owner QA.
