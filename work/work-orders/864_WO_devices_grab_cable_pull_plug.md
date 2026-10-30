# WO-864 — Devices tab: grab a cable with the pointer; pulling a plug near its port dot unplugs it

**Area:** godot-client, devices-config
**Status: DONE (2026-10-30, Godot 23530/0 + GUI e2e 10_cable_pull 6/6 with real mouse events on a sandbox server)**

Owner, 30.10: "in the godot gui should be possible to grab a cable with pointer and play around with it (not
disconnecting), should disconnect when grabbed close to a node dot. this is in devices tab"

## 1. Investigation

- **Ropes.** Rear-panel cables are `cable_rope.gd` Verlet ropes (WO-672), one per edge in `cable_layer.gd` `_ropes`. The
  layer is click-through (`MOUSE_FILTER_IGNORE`). `devices_tab.gd` `_input` hit-tests it with `hit()`, and a hit only
  selected the cable. Nothing could hold a rope point.
- **Disconnecting.** There was no drag gesture for this. `cable_gesture.gd` has the WO-278 click flow: select a cable,
  click one of its ends to lift it (`_begin_regrab`), then click another connector (`_commit_regrab` → `plan_regrab`) or
  empty space (restore). `remove_edge()` (Remove button, Delete key) pushes undo, so Ctrl+Z restores it.
- **Where the "dot" is.**
  - Measured in the e2e sandbox: a GPU port dot is a 12×12 rect, and the tab treats it as hit 3 px further out.
  - The plug boot hangs 16 px below the anchor (`BOOT_DROP`).
  - The port's socket graphic covers the plug, and `rear_panel.gd` `label_at()` reports that area as the port, so a click
    there opens the port page.
  - So a press "close to the node dot" lands on the socket. It must not be swallowed by the port-page click, and it must
    not land on the dot itself, which arms a new cable.
- **Synthetic input.** In the e2e harness, `Input.warp_mouse` produces a motion with `button_mask` 0 while the button is
  held. The first version took that as a release and dropped the plug at once. X11 grabs the pointer while a button is
  down, so the release always arrives as a button event. The plug press now ends only on that event.

## 2. What was done

- `features/devices/cable_grab.gd` (new, pure):
  - `pick(shapes, owners, ends, p, skip)` finds the cable within `BODY_PX` (6) of the drawn polyline.
  - It reports whether the press is on the body or on an end (within `END_PX` (18) of the port anchor, which covers the
    boot), and which rope point to hold.
- `cable_rope.gd`:
  - `grab` / `drag` / `release` / `grabbed`: the held point follows the pointer, both plugs stay pinned, and the rope
    swings back and sleeps on release.
  - `GRAB_REACH` (1.1) stops the pointer from stretching the cable past its length.
  - `points_owned()` maps each drawn point to its rope point (loop points included).
- `cable_layer.gd`:
  - `press(global, port)`: a body press starts a drag. A plug press arms `_plug` and decides nothing yet.
  - `_plug_input`: past `UNPLUG_PX` (8) it emits `unplug` once. Releasing after a pull emits `unplug_drop(key under the
    pointer)`.
  - A release with no pull keeps the old click:
    - on a socket, `port_clicked` opens the port page;
    - on the selected cable's plug, it lifts (WO-278 click-to-move).
  - `anchor_at()` moved here from the tab, so the tab and the drop share one connector hit test.
- `cable_gesture.gd`:
  - `pull(edge, key)` = select + the WO-278 re-grab. The ghost follows the pointer and valid targets tint.
  - `unplug_drop(key)` goes through `cable_rules.gd` `unplug_outcome()`:
    - its own anchor → restore;
    - another connector → the re-grab commit (`plan_regrab` still validates, and its own port restores);
    - empty space → `remove_edge`, with status "Cable unplugged — Ctrl+Z puts it back."
  - `deselect()`.
- `devices_tab.gd`:
  - The press asks the layer first, even over a port row or socket. A port opens its page only when no plug is under the
    press.
  - Signals wired. The file stays at 498 lines (≤ 500).
- Node view (straight Bézier cables) is unchanged: there is nothing to swing, and a click selects as before.

Not chosen: unplugging on press. A plain click on a socket must still open its port page, and a click on a cable must
still select it. The pull threshold separates "play with it" from "disconnect" without a mode switch.

## 3. What was VERIFIED

- Godot suite: 23530 passed, 0 failed. `tests/test_devices_cable_grab.gd` covers:
  - body vs end pick, the reach edge, nearest cable wins, hidden cable skipped, loop ownership;
  - a body drag moves the rope but not the plugs, it swings back and sleeps, and it cannot over-stretch;
  - plug pull → one `unplug` and a drop;
  - click on an unselected plug → nothing; click on the selected plug → lift; plug in a socket → `port_clicked`;
  - pulled → unplug;
  - `unplug_outcome`: none / restore / move / remove.
- GUI e2e `godot/client/e2e/scenarios/10_cable_pull.gd`. It ran against the sandbox server with real mouse events
  through the viewport, and the device graph from the server is the truth. Result 6/6:
  1. A destination is cabled to P1 and hangs.
  2. A body drag: the rope follows within 12 px of the pointer, no plug lifts, and the server edge is unchanged.
  3. A click on the plugged socket opens the P1 port page and the cable stays.
  4. Pulling the plug into empty space removes the edge on the server.
  5. Ctrl+Z restores it.
  6. Pulling the plug onto P2 moves the edge to `gpu_p2`.
  Screenshots show each held state: rope swung, ghost line with tinted targets, "Cable moved to gpu_p2".
- Not verified on the owner's screen with a hand on the mouse: no pointer automation on :0 while the owner works.
