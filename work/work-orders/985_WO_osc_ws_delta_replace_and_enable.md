# WO-985 — OSC WS delta: a delta channel REPLACES the client copy, then delta mode ON

**Area:** godot-client, web-client, mapping
**Status: DONE (07.11, unit tests + box proof: WS bytes, Godot glass; `osc.wsDeltaBroadcast` left ON)**

## Investigation

WO-980 proposal P1 (`osc.wsDeltaBroadcast`) was measured on 07.11 00:38 (194 -> 65 KB/s per client) and switched back off
because of a suspected stale-layer bug. Confirmed by reading:

- Server `src/osc/osc-state.js` `_buildChangePayload` sends, per DIRTY channel, the WHOLE channel
  (`JSON.parse(JSON.stringify(this._channels[ch]))`) with `delta: true`. Pruned layers (`osc-state-layer.js`
  `_pruneStaleLayers` deletes the key and dirties the channel), cleared layers and shrunk audio slot lists are simply absent.
- Every client MERGED that into its copy, so absent keys survived until the next full snapshot (reconnect only):
  Godot `pgm_timer_model.gd merge_channel` (via `osc_mirror.gd`), web `client/lib/osc-client.js mergeChannel`, and three
  CasparCG HTML templates with their own copy: `template/playback_timers.js` (+ `playback_timers_helpers.js`),
  `multiview_master.js`, `multiview_overlay.js`.
- Proof of the old behaviour: old `mergeChannel({layers:{10,20}}, {layers:{10}})` -> layers `['10','20']`.
- It is partly masked: the Godot timer hides layers whose `_lastOscAt` is older than 12 s (`STALE_MS`), so a pruned
  layer's timer lingered ~3 s too long; consumers without that guard (compose-tile times, media preview, meters, the
  templates) would show it until reconnect.
- WO-604's slot-wise audio merge existed so a delta's fresh dBFS (-120) replaces a stale peak. Server slots are always
  complete (`{dBFS, peak, peakAge}`, osc-state-audio.js), so replacing the channel gives the same result with no merge.
- Server side is already safe: `osc-lifecycle.js pushOscToState` feeds the StateManager mirror from `getSnapshot()` (full)
  when the payload is a delta, so `state.osc` / variables / playlist code never see a partial channel. The `state` WS
  message carries that full snapshot, which clients treat as authoritative.

## What was done

Design: a delta carries each dirty channel COMPLETE, so clients REPLACE their copy of that channel; channels absent from
the delta are kept; a non-delta payload replaces everything. No server change (the payload shape is unchanged).

- `godot/client/features/live/pgm_timer_model.gd`: `merge_channel` removed, `apply_osc(channels, d)` added (pure, input not mutated).
- `godot/client/features/live/osc_mirror.gd`: `_ingest` calls `P.apply_osc`.
- `client/lib/osc-client.js`: `mergeChannel` removed, exported `applyOscPayload(ch, d)`; `_ingest` uses it. `npm run build:client` run.
- `template/playback_timers.js`, `multiview_master.js`, `multiview_overlay.js`: delta -> `Object.assign(oscState.channels, msg.data.channels)`;
  the local `mergeChannel` copies (and the one in `playback_timers_helpers.js`) deleted. Templates reload on the next
  CG ADD/PLAY; none were running on the box (INFO of ch1-5: no html layers), so nothing stale is live.
- Tests: Godot `test_transitions_timer.gd` — the two `merge_channel` tests replaced by `apply_osc` tests (pruned layer gone,
  other channels kept, input not mutated, audio slot list follows the server / no stale peak, snapshot replaces all);
  node `test/osc-delta-replace.test.js` (3 tests: client replace incl. audio slots, REAL `OscState` prune -> delta ->
  mirror drops the layer, templates carry no merge) added to `tools/ci/offline-test-files-3.js`.
- Settings API: `POST /api/settings {"osc":{"wsDeltaBroadcast":true}}` (config/ never hand-edited). Left ON.

## What was VERIFIED

- Godot tests: 26079 passed, 0 failed. New node test 3/3. Offline suite: 5504 tests, 5498 pass, 0 fail, 5 skipped/todo
  (the WO-983 "late entry" todo of the other agent). max-lines 0 over; format:check clean; eslint on touched client/test
  files 0 errors (templates are eslint-ignored); `node --check` on all templates; check-unwired-exports: no NEW orphans.
- WS bytes (passive client, `wo980/wscap.js`, 15 s, idle Live, project a_s): OFF 202.2 KB/s (22.8 msg/s, avg 9080 B) ->
  ON 64.9-66.2 KB/s (20.7-21.1 msg/s, avg 3217 B). TOTAL 204.8 -> 67.4 KB/s.
- CPU (top, delta ON, idle Live): Godot 19.8 % (20 % before), node 6.2 % (10 % baseline). Godot within noise, as before.
- Glass (GUI relaunched under box2.lock with the new code, delta ON): PLAY 2-110 (PGM ch2 runs bank b) shows the PGM timer in the
  Live header and above the Dioda deck (`glass_before_clear.png` / `final_timer_on.png`). After CLEAR 2-110 the server keeps the
  layer until `layerStaleTimeoutMs` (~9 s: CLEAR 035485 -> pruned delta 044529); the Godot timer vanished 76 ms after that
  delta arrived (`final_timer_gone.png`). So "within a second" holds for propagation; the ~9 s is the server's stale prune, not the client.
  Screenshots: scratchpad `wo985/` (`before_clear.png`, `glass_before_clear.png`, `glass_after_clear_*.png`, `final_timer_on.png`, `final_timer_gone.png`).
- Box left as found: project a_s, ch2/ch3 as before (ch3-10 clip untouched, ch2 empty), GUI running on the Live tab. The test
  screen timer I added by accident (the deck clock button adds a COUNTDOWN timer, not the OSC timer) was removed again.

## Not proven / notes

- Web client on glass (dist-web rebuilt; unit-tested only). Multiview/playback-timer templates: unit-tested by source pin only, none were running.
- The old-merge regression on glass was not reproduced (it was proven by unit test only; the GUI hides stale layers after 12 s anyway).
- Follow-up idea (not done): the server still builds one full `getSnapshot()` clone per tick in delta mode for the StateManager mirror (osc-lifecycle.js:66-72).

## Coordinator follow-up (07.11, Claude)
- Factory default: `src/config/defaults-core.js` `osc.wsDeltaBroadcast: true` (the one reset root: New Project starter + factory/stick reset), and the tracked `config/osc.json` carries the same `true` (its only diff), so a fresh ISO or reset keeps delta mode. defaults-core smokes 91/91.
