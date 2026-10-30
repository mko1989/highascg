# WO-862 — audio mixer shows screen labels; a new live input starts unrouted

**Area:** audio, godot-client, web-client
**Status: DONE (2026-10-30, smoke 5/5 + Godot 23447/0, box: Audio tab screenshot after node restart + client relaunch)**

Owner, 30.10: "the labels in audio mixer show pgm1 instead of its label, dioda pgm prv, proj pgm prv etc. the live
audio was added with both outputs already enabled, not good for live show."

## 1. Investigation

### 1.1 Labels

Every mixer surface built its program names from the channel index alone, never from `channelMap.screenLabels`
(on this box `['Dioda', 'Proj']`, program channels `[1, 3]`, previews `[2, 4]`):

- web masters: `client/components/audio-mixer-view-console.js` passed no `masterLabel` / `previewLabel`, so the
  console's defaults "PGM n Master" / "PRV n Master" were used;
- web input groups: `audio-mixer-console-input-groups.js` and `audio-mixer-panel-input-layers.js` hard-coded
  `` `PGM ${chIdx + 1} (ch ${ch}) Inputs` ``;
- Godot: `features/audio/audio_rows.gd` `program_rows` ("PGM %d Master" / "PRV %d Master"), `audio_tab.gd` group
  title "PGM %d (ch %s) Inputs", `audio_dock_model.gd` `groups` "PGM %d (ch %s)" (Inspector audio dock).

`audio_rows.gd` already had `screen_label(cm, ch)` for other rows; only the program names ignored it.

### 1.2 A new live input lands on both PGM screens

`live_audio_input_<n>_pgm_channels` is the per-slot route selection (WO-571). When the key is **absent** the slot
falls back to the legacy blanket routing: `live_audio_pgm_always_on` (default `true`, box `true`) puts it on every
PGM screen (`resolveLiveAudioSlotPgmChannels`, `src/config/live-audio-input.js`). Neither "add live input" flow
writes the key for the new slot — Godot's `live_input_flow.gd` posts `IS.live_audio_body(next)`, which writes it only
for slots that already have a selection (`input_slots_model.gd:89-90`), and the web add does the same — so every
newly added input took the blanket path: on air on Dioda PGM and Proj PGM the moment it is added. WO-845 already
pinned removed slots to `''`; a slot that was never configured kept no key.

## 2. What was done

- `client/lib/screen-label.js`: `programBusLabel(cm, idx, preview)` → "Dioda PGM" / "Dioda PRV", unlabelled
  "PGM n Master" / "PRV n Master"; `programInputsTitle(cm, idx, ch)` → "Dioda PGM (ch 1) Inputs". Used by the
  web console masters and both input-group builders.
- Godot twins in `audio_rows.gd`: `bus_label(cm, idx, preview)`, `inputs_title(cm, idx, ch, suffix)`; used by
  `program_rows`, `audio_tab.gd` and `audio_dock_model.groups(rows, programs, cm)` (the dock passes `cm` through
  `rebuild`). `master_label` only trims " Master", so the dock shows "Dioda PGM" as is.
- Server, `src/audio/live-audio-slot-prune.js` `newSlotsRouteNowhere(prevCs, cs, body)` (run with the WO-845 rule by
  `pruneSlotPgmRoutes`, which keeps `routes-audio.js` under 500 lines), called from
  POST `/api/audio/live-inputs/config` after the WO-845 prune: a slot that gains a capture device in the save (no
  device before or beyond the old count) and has no selection in the body is pinned to `''` — routed nowhere until
  the operator turns a PGM route on. An explicit selection in the body wins; existing slots (and device swaps) keep
  what they have, so an untouched legacy slot keeps its blanket routing. Done on the server, not in the two clients,
  so every add path (Godot, web, API) gets it.
  Considered flipping the `live_audio_pgm_always_on` default to `false` — rejected: it would silently drop audio of
  existing, never-touched slots on boxes that rely on the blanket routing.

## 3. What was verified

- `tools/smoke/smoke-wo862-mixer-labels-new-input-unrouted.test.js` (5 tests, curated CI): web helpers, the
  wiring pins on both clients, the route adding slot 1 → `pgmChannels []`, explicit selection wins, untouched
  slot keeps no key, a slot beyond the old count is new. Mutation check: with the route call removed the
  "adding slot 1" test fails (4 pass / 1 fail).
- WO-845 and `smoke-live-audio-pgm-screens` still pass (14/14 with the new file).
- Godot suite: `test_audio_dock.gd` labelled cases added; golden `tests/golden/audio_mixer.json` programRows with
  `screenLabels ['Main LED (DP-7)']` now expect "Main LED (DP-7) PGM" / "… PRV" (14 labels). 23447 passed, 0 failed.
- Box 30.10 14:02: node restarted (no Apply running), live audio slot 1 recovered ("repaired 1 input(s)"), owner
  Godot client relaunched on the Audio tab: masters read **Dioda PGM, Dioda PRV, Proj PGM, Proj PRV**; Live audio 1's
  Dioda / Proj route toggles are off (`live_audio_input_1_pgm_channels: ''`). The add path itself was not exercised on
  the box (a second capture device would take the single-open USB card); it is covered by the route-level smoke.
