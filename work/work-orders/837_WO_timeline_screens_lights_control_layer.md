# WO-837 — Timeline: screens, lights layer, control layer (D6)

**Status: OPEN (30.10)**
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
