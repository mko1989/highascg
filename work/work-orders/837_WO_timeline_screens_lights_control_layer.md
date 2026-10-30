# WO-837 — Timeline: screens, lights layer, control layer (D6)

**Area:** engine, lighting
**Status: DONE (30.10) — phases 1–3; live: light flags reach UDP receivers for all three drivers, per-screen routing proven on real Caspar on PRV ch2/ch4 and (owner-approved) PGM ch1/ch3; behaviour on a real lighting console needs console hardware the box lacks (MagicQ demo mode has no OSC)**
**Source:** WO-828 D6, owner 30.10: *"ability to add screens to a timeline (should have a divider and seperete layers in the
list at the bottom) ability to add lights layer (here id like it to be similar to comapnion buttons in timeline, but with a
choice of console in devices tab, that highascg connects to and ability to choose which cue to go into or move which fader
etc.). with that i think we should move the companion button flags and light flags to a seperate control layer that will
start from the bottom of the timeline. when control flags would be overlapping each other they should stack on top, making
the whole control layer wider. standard flags appear in the time ruller."*
**Related:** WO-828, WO-555 (sendTo), the timeline Companion flags.

Parts (design first, then build):

1. **Screens in a timeline:** a timeline can target several screens; the layer list shows a divider per screen with that
   screen's layers below it.
2. **Lights layer:** like Companion button flags, but a flag fires a lighting-console action (go to cue, move fader …) on
   a console chosen in the Devices tab that HighAsCG connects to.
3. **Control layer:** Companion and light flags move from the ruler to a control layer at the bottom of the timeline;
   overlapping flags stack upward and the layer grows. Standard flags stay in the ruler.

## 1. Investigation (30.10)

- **Screens today.** A timeline has one routing, `sendTo {preview, program, screenIdx}`
  (`timeline-playback-amcp-send.js:431` `_channelsFor`):
  - `screenIdx: null` sends EVERY layer to every screen's channels (Dioda ch1/2 and Proj ch3/4 on this box);
  - a number sends to that screen only.
  - Each layer `li` plays on Caspar layer `210 + li` (`_caspLayer`) on every routed channel. A layer can't target
    one screen.
- **Flags today** (`timeline_flags.gd`, engine `_processTimelineFlags` in `timeline-playback.js:250`):
  - types `pause`, `play`, `jump`, `companion_press`;
  - all of them are drawn in the ruler (`timeline_flag_draw.gd`), and a Companion flag shows its button's 28 px
    thumbnail there;
  - the engine fires `companion_press` off-tick (`setImmediate`) and drops it if another timeline took over.
- **Lighting consoles.** No driver exists. The audio-desk link (WO-731, `src/audio-desk/`) is the pattern to copy:
  - `desk-models` → `drivers/*`;
  - a store in `~/.highascg/*.json`, outside the repo, test-isolated through `underTestRunner`;
  - an OSC/UDP helper (`drivers/osc-udp.js`).
- **MagicQ on the box** runs in demo mode (WO-792/796). The ChamSys remote protocol and PSN need ChamSys hardware
  (`src/vr/vr-desk-panel.js:25`). OSC support in demo mode is unverified, so tests use a mock UDP receiver.

## Design (data contract shared by every part)

**Layer screen.**
- `layer.screenIdx`: a number for one screen. Absent means every screen the timeline is routed to, as today, so
  old projects play unchanged.
- `tl.screens: [idx, …]` lists the screen sections the operator added, so an empty section survives a save.
- Engine: in every per-layer channel loop, a layer with `screenIdx` only uses the routed channels of that screen,
  via one helper `_layerChannels(li, channels)` (`getChannelMap` channel → screen).
- Caspar layer numbering stays `210 + li`, which is global and unique.

**Layer list (Godot).**
- The "all screens" layers come first. Then each added screen gets a divider row with the screen's name, and its
  layers below.
- "+ Screen" (in the layer list header) adds a section at the bottom.
- A new layer goes into the section it was added from. Dragging a layer across a divider changes its `screenIdx`.

**Control flags.**
- `companion_press` (existing) and the new `light` are control flags. `pause`, `play` and `jump` are standard flags
  and stay in the ruler.
- `light` flag: `{id, timeMs, type: 'light', label, consoleId, action, …}`, where `action` is one of:
  - `go`: `list`, optional `cue`. Go, or go to cue N, in that cue list or playback.
  - `fader`: `fader`, `level` 0–100 %.
  - `release`: `list`.
  - `command`: a command-line string, for consoles that take one (grandMA3, Eos).
- The engine fires a `light` flag the way it fires `companion_press`: off-tick, and dropped if the timeline is no
  longer on air.
- Console errors are logged and broadcast, and never block playback.

**Control layer (Godot).**
- A lane under the last layer, at the bottom of the timeline.
- Control flags draw there as chips: the Companion thumbnail chip as today, and the light chip shows the console
  name and the action.
- Chips that would overlap at the current zoom (measured in px) stack upward into extra rows, and the lane grows
  by one row per extra row.
- Standard flags keep their ruler markers.
- Selection, drag and the inspector work on chips as they did on ruler markers.

**Consoles (Devices tab).**
- A "Lighting consoles" section: add or remove a console as `{id, name, kind, host, port}`.
- `kind` is one of:
  - `magicq`: ChamSys OSC (or the remote protocol);
  - `eos`: ETC Eos OSC;
  - `grandma3`: grandMA3 OSC `/cmd`;
  - `osc`: generic, where an action maps to a user-typed address plus arguments.
- Stored in `~/.highascg/lighting-consoles.json` (the desk-store pattern).
- Routes: `/api/lighting/consoles` (GET/POST/DELETE) and `POST /api/lighting/consoles/:id/test` (sends a harmless
  query or a go on a scratch list).
- Every driver's wire format comes from the vendor manual, and the WO records the citation.

## Phases

1. **Server:** the console store and drivers, the routes, and `light` flag firing in the engine; the `_layerChannels`
   per-layer screen filter. Mock-UDP smokes per driver; mock-AMCP smoke for a two-screen timeline.
2. **Godot:** the Devices consoles section, the control lane (stacking, chips, inspector for `light`), the screen
   dividers and "+ Screen".
3. **Live:** a two-screen timeline on PGM (wire: layer A only on ch1, layer B only on ch3). Light flags against a
   UDP sniffer on 127.0.0.1, and against MagicQ on the box if its OSC answers in demo mode. Screenshots of the lane
   stacking.

## 2a. What was done (phase 1, server, 30.10)

**Per-layer screens** (`layer.screenIdx`, `tl.screens`, as in Design):
- New mixin `src/engine/timeline-playback-layer-screens.js`, wired in `timeline-playback.js`.
  - `_layerChannels(li, channels, tl?)` returns `channels` unchanged for a layer without `screenIdx`.
  - With `screenIdx` it keeps only that screen's PGM/PRV channels (`getChannelMap`; same fallback numbers as `_channelsFor`).
  - A `screenIdx` past the configured screens yields `[]`: the layer plays nowhere rather than jumping to another screen.
- Used in every per-layer channel loop:
  - `timeline-playback-amcp-send.js`: `_canResumePlayback`, `_timelineSeekFrameChanged`, `_syncAmcpLayers` (so PLAY/LOAD/SEEK/mixer/exit-STOP/end-hold/wrap all follow it).
  - `timeline-playback-transport-bulk.js`: `_stopAll`.
  - `timeline-playback-runtime.js`: the removed-channel STOP in `setSendTo`. The `for (const ch of removedCh)` text is kept because the WO-555 smoke pins it.
  - `timeline-engine.js` `update()`: the deleted-layer STOP, and a new STOP of the old channels when an on-air layer's `screenIdx` changes (the sync then PLAYs it on the new screen).
- `_pauseAll`/`_resumeAll` walk `_prevKey`, which is already per channel, so they needed nothing.
- `create()` keeps `screens`. PUT/POST already pass the whole body through.
- Caspar layer numbering is untouched (`210 + li`).
- `timeline-playback-helpers.js` and `index.js` were not touched.

**`light` flags** (`src/engine/timeline-playback-light.js`, branch in `_processTimelineFlags`):
- Fired like `companion_press`: `setImmediate`, dropped with a `warn` when another timeline is on air.
- Errors (sync or async) are logged with `warn` and broadcast as WS `lighting.error`: `{timelineId, flagId, label, consoleId, error}`.
- Companion press errors are only logged today, so the broadcast is new.
- The engine reaches the console service through `self.lightingConsoles`, else lazily via `getService(self)`, which stores it on `ctx.lightingConsoles`. **No `index.js` change is needed.**
- The flag is passed straight to the service, so its own `action`/`list`/`cue`/`fader`/`level`/`command` fields are the action.

**Lighting consoles** (`src/lighting-console/`, modelled on `src/audio-desk`):
- Files:
  - `console-store.js`: `~/.highascg/lighting-consoles.json`, `HIGHASCG_LIGHTING_CONSOLES_FILE` override, temp dir under the test runner, atomic write, at most 16 consoles.
  - `console-models.js`: kinds and driver lookup.
  - `actions.js`: action validation.
  - `osc-send.js`: one-shot UDP.
  - `console-service.js`: store plus `fire` and `test`.
  - `drivers/{magicq,eos,grandma3,osc-generic}.js`.
- A driver is a pure message builder (`messages(console, action)`, `testMessages(console)`). The service sends the result over UDP. Unsupported or incomplete action: a clear Error.
- Validation:
  - id `^[a-z0-9][a-z0-9_-]{0,31}$`, name 1–40, kind in the list, host `^[A-Za-z0-9.:-]{1,253}$`.
  - port 1–65535, defaulting to 8000 for magicq/eos/grandma3. Generic `osc` requires a port.
  - Extra fields: `prefix` (grandma3 only, no slashes) and `templates` (osc only).
  - Actions: `list`/`cue`/`fader` must be numeric (a fader may be `"page.fader"`), so no text reaches an OSC address. `level` 0–100; `command` is one line, at most 400 characters.
- Generic `osc` kind: `templates: {go, goCue, fader, release, command, test}`. Each is `{address, args[]}`.
  - Placeholders: `{list} {cue} {fader} {level} {level01} {command}`.
  - An arg that is exactly one placeholder keeps its number type.
  - `goCue` is used instead of `go` when the flag has a cue.

**HTTP contract for the Godot phase** (`src/api/routes-lighting.js`, registered on the existing `;` line at the end of `router.js`; all `requireCaspar:false`):
- `GET /api/lighting/consoles` returns `{consoles:[{id,name,kind,host,port,prefix?,templates?}], kinds:[{kind,label,port}]}`.
- `POST /api/lighting/consoles` takes one record and returns `{console}`.
  - Same id replaces; no id generates `c<8 hex>`.
  - Bad body: 400 `{ok:false,error}`. Malformed JSON: 400.
- `GET /api/lighting/consoles/:id` returns `{console}`, or 404.
- `DELETE /api/lighting/consoles/:id` returns `{ok:true}`, or 404. `DELETE /api/lighting/consoles` with body `{id}` does the same.
- `POST /api/lighting/consoles/:id/test` returns `{ok:true, sent:[osc address], note}`. Unknown id: 404; send failure: 502 `{ok:false,error}`.
- Route order: no earlier wildcard matches `/api/lighting/*` (checked on the real registry in the smoke).
- `docs/wiki/api/contract/{http,ws}.md` were regenerated with `tools/dev/gen-api-contract.js`.

**Light-flag record for Godot**: `{id, timeMs, type:'light', label, consoleId, action:'go'|'fader'|'release'|'command', list, cue?, fader, level, command}`. Only the fields the action needs are used.

### Wire formats (vendor documentation)

- **ChamSys MagicQ** (`drivers/magicq.js`):
  - Sources: <https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/OSC.html> ("MagicQ OSC Addresses" table, "Setup"); <https://docs.chamsys.co.uk/magicq/manual/remote_control_commands.html> (remote protocol, reached through `/rpc`).
  - Wire: go `/pb/N/go i:1`; go to cue `/pb/N/<cue> i:1`; fader `/pb/N i:0..100`; release `/pb/N/release i:1`; command `/rpc s:<text>`; test `/feedback/off`.
  - Docs: the manual recommends 8000 receive / 9000 transmit. PC/Mac MagicQ answers playbacks 1–10 only.
  - Uncertain: "jump to cue" is documented as a jump, not an activate. A 2017 QLab thread says a released stack may stay inactive. We send the documented form.
- **ETC Eos** (`drivers/eos.js`):
  - Sources:
    - OSC Dictionary: <https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/23_Show_Control/08_OSC/OSC_Dictionary.htm> (404 to the fetch tool at write time; search snippets only).
    - ETC support "Triggering Eos from QLab using OSC", which has the `/eos/cue/3/9/fire` and RX port 8000 examples: <https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Triggering_Eos_from_QLab_using_OSC>
    - Fader-bank thread: <https://community.etcconnect.com/control_consoles/eos-family-consoles/f/eos-family/22844/osc-fader-inconsistency/108324>
  - Wire:
    - go with cue: `/eos/cue/<list>/<cue>/fire`, no args.
    - go without cue: `/eos/newcmd s:"Cue <list> Go#"`.
    - fader: `/eos/fader/<bank>/config/<n>` then `/eos/fader/<bank>/<index> f:level/100` (`fader` is `index` = bank 1, or `bank.index`).
    - release: `/eos/newcmd s:"Cue <list> Release#"`.
    - command: `/eos/newcmd s:<cmd>#`.
    - test: `/eos/ping s:HighAsCG`.
  - Uncertain: the official pages could not be fetched here and the Show Control PDF was not readable (no PDF tool on the box). Only cue fire, `/eos/ping`, `newcmd` and the fader config were seen in vendor or community examples.
  - Unverified: go-without-cue and release are command-line forms from Eos command syntax. The fader bank config is needed per the forum ("invalid fader index" without it). ETC's docs are known to be wrong in places.
  - Check on a real console in phase 3.
- **grandMA3** (`drivers/grandma3.js`):
  - Sources: <https://help.malighting.com/grandMA3/2.1/HTML/remote_inputs_osc.html> (same page for 2.0/2.2/2.3); <https://help.malighting.com/grandMA3/2.1/HTML/keyword_sendosc.html>.
  - Wire: message format `(/prefix)/<address>,<type>,<value>`; fader `/Page<p>/Fader<n> i:level` (`fader` is `n` = page 1, or `page.n`); command `/cmd s:<text>`.
  - Command-line forms: go `Go+ Sequence N` (or `Executor P.E` when the list holds a dot); go to cue `Goto Cue C <target>`; release `Off <target>`; test `Echo "HighAsCG link test"`.
  - Docs: `/cmd` needs "Receive Command = Yes" on the console's OSC line. The optional prefix has no slashes and, if set on the console, filters incoming messages (console field `prefix`). Page and Fader are case-sensitive.
  - Uncertain: the 2.2 text also shows a page-less `/Fader201`. We always send the page-qualified form. Command keywords are standard MA3 syntax but not run against a console. The manual warns addresses can change between versions.
- **Generic `osc`** (`drivers/osc-generic.js`): no vendor document. The user types the console's own addresses.

## 3a. Verified (phase 1)

- New smokes, all passing (`node --test`):
  - `tools/smoke/smoke-wo837-lighting-consoles.test.js`, 15 tests: store validation and persistence, action validation, exact messages per driver, real UDP datagrams decoded from a 127.0.0.1 ephemeral-port receiver, route CRUD with malformed JSON (400), `/test`, and router order on the real registry.
  - `tools/smoke/smoke-wo837-layer-screens.test.js`, 12 tests, mock AMCP, 2-screen rig (PGM ch1/ch3):
    - A (screen 0) only on ch1, B (screen 1) only on ch3, C (no `screenIdx`) on both.
    - A timeline with no `screenIdx` is unchanged.
    - Loop wrap, WO-834 end hold, stop, an on-air `screenIdx` change.
    - `light` flag crosses once, off-tick, dropped when another timeline is on air, error logged and broadcast, sync throw contained.
- Checked against the old behaviour: with `_layerChannels` forced to pass-through, 6 of the 12 layer-screen tests fail (the ones that need the filter).
- Existing suites: wo555, wo558, wo828, wo829 and wo834 pass (72 tests incl. the new ones), plus the 51 other smoke files that read the edited files or `router.js` (441 pass, 0 fail, one skipped), including wo598 API contract. `check-max-file-lines` reports no file over 500. ESLint is clean on the new files; two pre-existing warnings elsewhere.
- Not done in phase 1 (phase 3): nothing was sent to a real console or to MagicQ on the box. The OSC forms above are from documentation only, and the Eos/MA3 command-line forms are the least certain.

## 2b. What was done (phase 2, Godot, 30.10)

All under `godot/client/`. Layout decisions marked (D) are mine where the Design left room.

**Pure models (new, unit-tested)**
- `features/timeline/timeline_rows.gd` (RW): the section/row mapping and the vertical geometry.
  - Rows: "all screens" layers first, then a divider + that screen's layers for each screen in `tl.screens` (plus any `screenIdx` a layer uses but the list misses). `tl.layers` is not reordered: the list only groups it, so Caspar layer `210 + index` and z-order are untouched.
  - (D) An "All screens" divider heads the first section as soon as one screen section exists, so a layer can be dragged / added back into it. With no screen section there is no divider and the rows equal the old layer rows.
  - `top / row_at / layer_at / hit_divider / drop_target` replace `TM.track_top / layer_at_y / hit_divider` in the view (the TM functions stay, golden-tested).
  - `viewport()`: the lane sits right under the layers while they fit, pinned to the canvas bottom once they do not (layers scroll above it). `thumb / scroll_for_thumb` for the scrollbar. `screen_names` from the channel map (the Dest list's names, "Screen N" fallback).
- `timeline_lane.gd` (LN): control-lane layout. Chips are `{flag, x (absolute px = ms * zoom), w, row}`; first-fit packing from the bottom row with a 4 px gap, so overlapping chips stack upward and `count` rows make the lane `8 + 32 * count` px tall. Rows depend on zoom only, never on scroll.
- `timeline_light.gd` (LF): the light flag model: action fields, `action_patch` (a flag carries only its action's fields), `parse_num / parse_fader / parse_level / clean_command` (mirror the server's regexes), `summary`, `chip_text` ("MagicQ FOH · Go 1 / cue 3"), `problem` (what the server would refuse). Kept free of the `Api` autoload so tests load it; the console list is fetched by `timeline_light_fetch.gd`.
- `timeline_layers.gd`: `set_screen / add_screen / remove_screen (only empty) / add_in_section / drag_over`. `insert_below` now inherits the layer's section, so "a new layer goes into the section it was added from". `divider_heights` takes the lower layer's index (sections interleave the array).
  - `drag_over(layer, row)`: over another layer = join its section and take its place (the old live reorder); over a divider = join that section at the top. `screenIdx` is erased for "all screens".
- `timeline_flags.gd`: type `light` ("Light cue", cyan), `CONTROL_TYPES`, `is_control`; `hit()` (ruler) now skips control flags.
- `features/devices/lighting_console_model.gd`: the Devices form: the record to POST, the server's checks mirrored (name 1-40, host, port 1-65535 with the kind's default, grandMA3 prefix, osc templates as `address` + space-separated args), record <-> form, Test answer line.

**UI**
- Timeline canvas (`timeline_view.gd`, `_draw.gd`, new `_drag.gd`, `timeline_lane_draw.gd`): section dividers (name from the channel map, "+" = new layer in that section, "x" on an empty section), "+ Screen" in the corner above the list (the tab pops the menu of screens not yet in the timeline), the control lane at the bottom (Companion thumbnail chip as before; light chip = console name + action, red tint when the flag has a problem), a vertical scrollbar thumb. Vertical scroll: wheel over the layer headers, Ctrl + wheel anywhere, or the thumb. The drag code moved to `timeline_view_drag.gd` (timeline_view.gd was at the 500-line limit).
  - Selection, time drag, Delete, copy/paste, Alt+arrows, the inspector all work on chips unchanged (same `sel_flag`).
  - A Sources drop on a divider or below the last row makes a new layer in that section (`source_dropped` gained a `screen` argument).
  - Double-click on a divider's track area adds a layer in that section.
  - WS `lighting.error` shows in the Dest row's status text.
- Flag inspector: "Light cue" in the Action list (next to "Companion button press"; that dropdown is where Companion flags are created today, after the Flag button's pause flag). `timeline_light_inspector.gd`: console picker (GET /api/lighting/consoles; a removed console shows "<id> (missing)"), action go / fader / release / command, fields List, Cue (optional), Fader, Level (%), Command. List / cue / level use `NumericField.math_line` (focus selects, maths, gibberish reverts). Fader is a text field validated to `N` or `page.fader` and stored as typed ("2.10" is page 2 fader 10, a number would make it 2.1); gibberish reverts too.
- Devices: `lighting_consoles_panel.gd`, a "LIGHTING CONSOLES" section in the right column between the cables list and Servers (list, "+", Edit, Test with the answer line, remove with confirm; kind picker; grandMA3 shows the OSC prefix; generic OSC shows the six address-template rows with the placeholder list). Registered with one `preload(...)` line in `devices_tab.gd` (kept at 499 lines by turning the reload lambda into one line).

**WO-843 items**
- Snap off by one: `timeline_edit.gd snapped_start` treated "edge exactly on a snap point" (distance 0) as "no candidate" (`INF`) and lost to a near miss of the other edge. Now a candidate-found distance (`snap_dist`) is used. `snapped_start(5000, 2003, [0, 5000, 7000], 80, null)` returned 4997, now 5000 (the sweep's case). Also `snapped_start(4997, 2003, …)`: end exactly on 7000 now wins over start 3 ms off 5000 (returned 5000).
- Vertical scroll: see above.

**Not done / limits**
- Nothing sent to a console from the client except through the server's own Test route (not clicked in the sandbox run).
- (D) A lane taller than the canvas minus 60 px of layers just clips at the bottom (no lane scroll).
- The web client (`client/`) is untouched: it will show `light` flags as unknown-type flags in the ruler.

## 3b. Verified (phase 2)

- Godot unit tests: `godot --headless --path godot/client --script res://tests/run_tests.gd` -> 23407 passed, 0 failed (baseline before the change 23264). New: `test_timeline_rows.gd` (rows/sections/viewport/thumb/drop target/section ops/drag across a divider, incl. heights staying aligned), `test_timeline_lane.gd` (chip stacking, lane growth per row, gap = overlap, zoom unstacks, scroll independence, hit), `test_timeline_light.gd` (flag types, action fields, parsing incl. "2.10", summaries, problems, ruler hit skips control flags), `test_devices_lighting_console.gd` (form -> record, validation, templates round trip, test line). `test_timeline_edit.gd` gained the snap cases (the old result, 4997 / 5000, is from the sweep and from reading the old code; the old code was not re-run).
- `GODOT=~/.local/opt/godot/godot ./run-client.sh --check` in `godot/client`: boot OK, no script errors. `node tools/ci/check-max-file-lines.js`: 0 files over 500. Source-pin smokes `smoke-wo787` / `smoke-wo789` (timeline files) pass.
- GUI e2e `node tools/e2e/run-gui-e2e.js --e2e=09_timeline_control_lane` (new scenario, sandboxed Godot under xvfb + sandbox server; POSTs a console to the sandbox): 5 of 5 steps pass: a two-screen timeline with 2 Companion + 4 light flags builds a 4-row lane (screenshot read: dividers "All screens" / "S1" / "Screen 2", chips stacked upward at 2.0-2.9 s, pinned lane with the layers scrolling above and the scrollbar thumb, red-tinted chip for a missing console); a real click on a light chip selects it and the Inspector shows Console / Action / List / Cue; dragging a chip moves its flag later; dragging "Dioda B" (a real press-drag across rows) onto the "Screen 2" divider changes its `screenIdx` to 1 and it heads that section; the Devices tab lists "MagicQ FOH" under LIGHTING CONSOLES with Test / Edit / remove.
- Owner QA left: the Devices add/edit form and Test button against the live box; real-console behaviour (phase 3).

## Coordinator check of phase 2 (30.10)

- Re-ran on the box: Godot unit suite 23407/0, `check-max-file-lines` 0 over, e2e `09_timeline_control_lane` 5/5. Screenshot 04
  shows S1 / Screen 2 dividers, the 4-row stacked control lane pinned under the layers, and the red "? gone" chip for a removed
  console.
- Follow-ups: (a) while the layer list is scrolled, the "+ Screen" corner button overlaps the top layer's name; (b) the web client
  has no `light` flag type yet, so it would show light flags as unknown flags; (c) phase 3 (live console Test, real MagicQ cue
  on 127.0.0.2) is still to do.

## Follow-up (a) fixed (30.10): "+ Screen" over the top layer's name

The ruler background covered only the track side (`_ruler` draws from `HEADER_W`), so a layer header scrolled half
under the ruler line drew its name into the corner cell around "+ Screen". `timeline_view_draw.gd _screen_button` now
paints the cell (and its bottom line) first. e2e `09_timeline_control_lane` has a new step that scrolls 14 px and counts
bright pixels in the cell outside the button. It found 31 on the old code (FAIL) and 0 with the fix: 6 passed, 0 failed.

## Follow-up (b) fixed (30.10): the web client knows `light` flags

The fault was worse than drawing them as unknown. `client/lib/timeline-state.js updateFlag` coerces any type outside
`FLAG_TYPES` to `'pause'`, so any web edit of a light flag, even a label change, turned it into a Pause flag, and the
canvas drew it as a red pause triangle.

- `FLAG_TYPES` now includes `light`.
- New `lightFlagSummary()` gives the Godot chip's wording ("Go 1 / cue 3", "Fader 4 to 80%").
- The canvas draws light flags teal (`#2dd4bf`).
- The flag inspector offers "Lighting console cue", and a hint names the action and console. Editing the console and
  action stays in Godot.

Verified: `tools/smoke/smoke-wo837-web-light-flag.test.js` passes 3/3 (curated), and eslint is clean. The client was
rebuilt with `npm run build:client`.

## 1c. Investigation for phase 3 (live box, 30.10)

Read-only probes before any live action:
- **The live node has the phase-1 code.** `highascg.service` started 15:57:27, after the last `src/lighting-console/*` and
  `src/engine/timeline-playback-light.js` writes (11:14–11:23). `GET :4200/api/lighting/consoles` answers with the
  four kinds, and the store is empty.
- **The Caspar channels at probe time** (`INFO`, AMCP :5250; the map comes from `/api/state channelMap`):
  - ch1 is Dioda PGM (3840×1792) and ch3 is Proj PGM (1080p50). Both are empty but go to the outputs, so they are on air.
  - ch2 is Dioda PRV, layers 10–12. The owner's PRV content was playing there (`PK BACK TRACK`, `PK CLICK`, `INTRO_HAP`).
  - ch4 is Proj PRV, layer 10.
  - ch5 is the operator GUI `shm` consumer, ch6 DeckLink, ch7 live audio (ffmpeg UDP), ch8 system-audio.
  - The engine held no timelines (`GET /api/timelines` → `[]`, playback `null`). The cluster is `standalone` with no
    peers and replication is off, so `notifyTimelineReplication` (`src/replication/replication-hooks.js:15-17`) sends
    nothing.
- **An unrouted timeline still fires its flags and sends no AMCP.**
  - `_channelsFor` returns `[]` when neither preview nor program is on (`timeline-playback-amcp-send.js:436`).
  - The tick still crosses flags (`timeline-playback.js:254-292`). The light flag only checks `_airTimelineId`
    (`timeline-playback-light.js:27`), and `play()` makes the timeline air (`timeline-playback-runtime.js:33`).
  - So the light-flag leg can run on the live server without touching Caspar.
- **Routing a timeline to PRV only touches its own layers.** A mock-AMCP dry run of the PRV probe
  (`TimelineEngine`, same timeline, `sendTo {preview:true, program:false}`) sends only `2-210` and `4-211` lines:
  STOP/PLAY/FILL/OPACITY/VOLUME/MIXER×9, then `COMMIT 2`/`COMMIT 4`. On stop it sends `STOP 2-210`, `STOP 4-211`.
  - Clip source `#00000000`, a fully transparent colour, so the owner's preview picture stays the same.
  - `play()` has no earlier air timeline to `_stopAll` (`timeline-playback-runtime.js:57-68`).
  - A non-program timeline needs no `force` to stop (`routes-timeline.js:117-128`).
  - With `ROUTE=pgm` the dry run sends the same set on `1-210` and `3-211`.
- **MagicQ OSC is not available in demo mode.** The box's own manual
  (`/opt/magicq/manual/magicq/manual/magicq_pc.html`, "MagicQ PC / Mac Restrictions (Demo Mode and Core Mode)") lists
  "Open Sound Control (OSC)" and the "ChamSys Remote Control Protocol (serial, or network)" under **UNLOCKED MODE**
  only. That mode needs ChamSys hardware (Mini/Compact/Stadium Connect, Compact Wing, a rack dongle, or a GeNetix
  GN5/GN10 on the network).
  - The box has none, so MagicQ 1.9.8.3 runs in DEMO MODE and would not act on `/pb/N/go`.
  - Launching it would also start its Art-Net, unicast to `127.0.0.2:6454` (see the MagicQ setup notes). This session
    may not touch :6454.
  - So MagicQ was not started.

## 2c. What was done (phase 3, 30.10)

No production code changed. Live probes only, all scripts are in the session scratchpad (`…/scratchpad/wo837/`):
- `live-light-probe.js` runs light flags through the LIVE server.
  - It binds three UDP receivers on `127.0.0.1` (ephemeral ports) and POSTs three consoles (`magicq`, `eos`, `grandma3`)
    pointing at them.
  - It POSTs an unrouted, layer-less timeline with 16 `light` flags: go, go-to-cue, fader, release and command per
    console, plus one flag on a console that does not exist.
  - It plays the timeline, then stops and deletes it and removes the three consoles. The store and the timeline list
    are empty again afterwards.
- `live-prv-probe.js` (`prv-probe-timeline.json`) runs a two-screen timeline through the LIVE server, routed to
  PREVIEW only.
  - Layer A has `screenIdx 0` and layer B has `screenIdx 1`. Both clips are `#00000000`.
  - It creates, plays, reads `INFO 1-4` after 2 s, then stops and deletes the timeline.
  - `ROUTE=pgm` runs the same probe on PROGRAM with `stop {force:true}`. **It has not been run.** ch1/ch3 are on air,
    so it waits for owner approval.
- `dry-run-prv.js` is the mock-AMCP dry run above, with `ROUTE=pgm` also supported.

## 3c. Verified (phase 3, 30.10)

- **Light flags, live server → UDP.** All 16 flags crossed. 17 datagrams arrived, 16 from flags plus the `/test`
  `/feedback/off`, and each was decoded as OSC. Each fired 60 ms or less after its flag time, which is the tick
  latency.
  - magicq: `/pb/1/go i:1`, `/pb/2/3 i:1`, `/pb/4 i:80`, `/pb/1/release i:1`, `/rpc s:"1@100"`.
  - eos: `/eos/newcmd s:"Cue 1 Go#"`, `/eos/cue/2/3/fire`, `/eos/fader/2/config/10` + `/eos/fader/2/10 f:0.800`,
    `/eos/newcmd s:"Cue 1 Release#"`, `/eos/newcmd s:"Chan 1 At Full#"`.
  - grandma3: `/cmd s:"Go+ Sequence 1"`, `/cmd s:"Goto Cue 3 Sequence 2"`, `/Page2/Fader10 i:80`,
    `/cmd s:"Off Sequence 1"`, `/cmd s:"Go+ Sequence 5"`.
  - `POST /api/lighting/consoles/wo837-magicq/test` returned `{ok:true, sent:["/feedback/off"], note:"UDP is unacknowledged…"}`.
  - Journal: for each flag, `[Timeline] playhead crossed light flag "<label>"` then `[lighting] WO837 <kind>: <action> -> <address>`.
    The missing console logged `[warn] [Timeline] light flag "missing console" -> console wo837-missing: lighting
    console "wo837-missing" is not configured (Devices > Lighting consoles)` (`console-service.js:71`), and playback
    ran on to the end.
  - `INFO 1-4` after the run showed the same layers as before, so Caspar was not touched.
- **Per-screen routing on real Caspar (PRV).**
  - Before: `{1:{}, 2:{10,11,12}, 3:{}, 4:{10}}`.
  - Playing (2 s, `state` `playing:true` at 2031 ms): `{1:{}, 2:{10,11,12,210:#00000000}, 3:{}, 4:{10,211:#00000000}}`.
    Layer A is on ch2 only and B on ch4 only. PGM was never addressed.
  - After stop and delete: 210/211 are empty on ch2/ch4, layers 10–12 and 10 are untouched, and `GET /api/timelines` is `[]`.
- **Regression re-run on the current tree.**
  - Godot headless suite: 23657 passed, 0 failed.
  - `node --test tools/smoke/smoke-wo837-*.test.js`: 30/30.
  - GUI e2e `09_timeline_control_lane`: 6/6. Screenshots are in `…/scratchpad/wo837/e2e09/shots/` (01 shows the
    S1 divider, the 4-row stacked control lane and the red "? gone" chip).
- **Not verified, and why:**
  1. ~~The PGM run~~: done 30.10 16:50 with the owner's approval (below).
  2. **Behaviour on a real console.** No console hardware is available, and MagicQ demo mode has no OSC (1c). The Eos
     and MA3 command-line forms are still from documentation only.

### 3d. PGM run (owner-approved, 30.10)

Command: `ROUTE=pgm node live-prv-probe.js` (output in `scratchpad/wo837/live-pgm-probe.out`).
- Before: `{1:{}, 2:{10,11,12,210 empty}, 3:{}, 4:{10,211 empty}}`.
- Playing (`state` `playing:true`, `sendTo.program`): `{1:{210:#00000000}, 3:{211:#00000000}}`.
  - Layer A is on ch1 only and layer B on ch3 only.
  - ch2 and ch4 did not change.
- After force stop and delete: 210 on ch1 and 211 on ch3 are empty, and `GET /api/timelines` is `[]`.
- Nothing visible went to air: the clips were transparent colour.
