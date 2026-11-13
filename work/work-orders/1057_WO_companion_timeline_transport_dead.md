# WO-1057 — Companion: timeline transport did nothing (module 1.0.3)

**Area:** companion
**Status: DONE (13.11 — module 1.0.5 on the owner's Companion Pi; owner: "the module is good")**

Owner, 13.11: *"check the companion module and fix the timeline transport etc. it doesnt work at all. when fixed bump a version
and package the module"*

## Investigation

- Module lives outside this repo: `~/companion-module-dev/companion-module-highpass-highascg` (installed in Companion: 1.0.2).
- `src/actions/timeline-actions.js`: every action (play / pause / stop / seek / loop / take / sendto) had a free-text
  **"Timeline id"** option, default `""`, and the callback did `if (!id) return` — no call, no log line. The Timeline presets
  (`tl_play_template`, `tl_pause_template`, `tl_stop_template` in `src/presets.js`) shipped with `id: ""`. A preset button
  therefore did nothing at all; a working button needed the internal id (e.g. `tmw3xnh86os9`) typed by hand.
- Companion's db (`~/.config/companion/v5.0/db.sqlite`) held no timeline button at all, so the owner only had the presets.
- Stop: `src/api/routes-timeline.js` `case 'stop'` answers **409** for a timeline live on program unless `force: true`
  (WO-552). The module never sent `force`, so a Stop on air would have failed even with an id.
- Play always sent `sendTo` (defaults screen 1 + preview + program), overriding the timeline's own routing.
- Server side is fine: `/api/timelines/:id/play|pause|stop|seek|loop`, `GET /api/state` → `timeline.{list,playback}`,
  WS `timeline.playback` / `timeline.tick` (index.js:337, timeline-playback-runtime.js:457). The list only arrives in the
  connect-time snapshot; `project_sync` carries `timelines.{timelines, activeId}` (the editor's open timeline).

## What was done (module repo a75234e, version 1.0.3)

- `src/timelines.js` (new): timeline state from the bridge, a **Timeline** dropdown (default **Active timeline**, then the
  show's timelines by name, custom id / name allowed), `resolveTimelineId` (playing → editor's `activeId` → last played →
  first), `ingestProjectTimelines` (fed from `GET /api/project` at connect and every `project_sync`).
- `src/actions/timeline-actions.js`: all actions use the dropdown; new **Play / Pause** toggle and **Jump back / forward**;
  Stop has "Stop even when it is live on program" (default on → `force: true`); Play keeps the timeline's routing unless
  "Override the timeline's routing" is ticked; loop gains toggle (old `loop` checkbox still read); errors logged with the name.
- `src/timeline-feedbacks.js` (new): `timeline_state` (playing / paused / stopped) and `timeline_loop_on`.
- `src/presets/timeline-presets.js` (new): active row (⏯ with name + position, Stop, Start, −5 s, +5 s, Loop) and ⏯ + Stop
  per timeline. `state-sync.js` rebuilds actions / feedbacks / presets when the timeline list signature changes.
- `api-client.js` `timelineStop(id, {force})`. HELP.md + CHANGELOG, version 1.0.2 → 1.0.3 (package.json + manifest).

## What was verified

- Module `npm test`: **117 / 117** (new `test/timelines.test.js`, 14 tests); eslint clean on every touched file (older files
  carry pre-existing prettier errors, untouched).
- Live, on this box, the module's real `HighAsCGApi` + action callbacks against :4200 on timeline `tmw3xnh86os9`:
  toggle → paused, toggle → playing, play, jump +5 s (81.5 → 87.9 s), pause, loop on / off, stop (forced) all took effect
  and the tally followed. Note: the owner was playing that timeline at the time; the test paused / jumped / stopped it for
  ~10 s and it was restarted at 92 s.
- `npm run package` → `highpass-highascg-1.0.3.tgz` (manifest + package 1.0.3, bundle contains the new actions, `node --check` OK).
- **Not verified:** installed in Companion and pressed on the Stream Deck. Install needs sudo (owner):
  `sudo systemctl stop companion && ~/highascg/tools/eggs/companion/install-companion-module.sh && sudo systemctl start companion`

## Follow-up, same day (module 1.0.4 → 1.0.5, on the owner's Companion Pi 192.168.50.221)

- 1.0.4 = 1.0.3 repackaged for the Pi. Owner: *"the play pause still doesnt work"*.
- The Pi's Companion log (tRPC `logs.watch` on :8000): `Failed to parse action options for action timeline_toggle:
  {"screen_index":"A value must be provided"}` on every press (buttons 6/0/1, 6/0/2). The Play / Pause preset stored only
  `id` + `override_routing`; Companion 5 refuses an action with a missing option. The live test above called the callback
  directly, which skips that validation.
- Module 9a013b2 (1.0.5): presets carry every option (`ROUTING_DEFAULTS`); `src/upgrades.js` `UpgradeScripts` fills the
  missing routing options of stored `timeline_toggle` / `timeline_play` actions; test "every preset action and feedback
  carries all options of its definition" + an upgrade test. Module tests 119 / 119. Owner imported 1.0.5: "the module is good".
- Remote module import is refused by Companion ("only allowed from the local machine"), so the owner imports packages.
- Server: `POST /api/timelines/:id/<action>` answered "Timeline not found" after a server restart until a GUI pushed its
  timelines (the engine starts empty). `eng.ensure(id)` (timeline-playback-runtime.js) loads it from the stored project;
  `routes-timeline.js` calls it for every POST action. Verified live: restart → loop + play by id → 200, playing.
