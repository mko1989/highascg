# WO-1077 — Operator dock: a click on the Firefox icon did nothing (14.11 evening)

**Area:** godot-client
**Status: IN PROGRESS (15.11.26 — not reproduced; dock buttons act on the press and every click now leaves a log line; cause of the 14.11 failure unknown)**

## Investigation

Owner 15.11: "Yesterday when I wanted to test the game, I couldn't open Firefox from the dock on the operator screen …
Clicking Firefox in dock did nothing."

- Server journal 14.11: the last `[dock] firefox: launched …` is 10:48:11. No `[dock]` line for firefox after that; the
  only later dock lines are `app:magicq` (17:03, 17:14, 17:32) and `file-manager` (17:04).
- Godot client log of the session 17:21 → 23:34 (`godot2026-11-14T23.34.07.log`): `[client] dock app:magicq → 200` once,
  no `dock firefox` line. `launch()` prints after the server answers, so either `pressed` never fired or the request
  never came back; the two following sessions (23:34 → 00:53, both ended in a Vulkan device-lost crash) have no dock
  line at all.
- Every server path of `launchOrFocus` logs, except the two refusals (400 unknown app, 403 nuclear password) — so the
  request did not reach the server, or it was refused silently. The password gate was off (`nuclearRequirePassword:
  false`), `enforceAuth` is false, Firefox is installed (`firefox-esr` 140), the dock lists it and serves its icon.
- Ruled out by reading: a stuck request pool (the dock uses the same `Api` as the take-looks, which kept working), the
  WO-811 login prompt, a window above the dock (it is override-redirect and on top; NoMachine's edge windows are
  unmapped).
- Reproduction attempts on the box, 15.11 07:12–07:23, real pointer clicks on the icon:
  | state | result |
  |---|---|
  | Firefox running | `focused the running window` |
  | Firefox closed | `launched`, window after ~1 s |
  | server restarted while Firefox was open (it is SIGKILLed with the service, KillMode=mixed), Godot kept running | `launched`, window |
  All three work. The failure of 14.11 was **not reproduced**.
- Side finding in the same client log: `SCRIPT ERROR: Invalid operands 'Dictionary' and 'bool' in operator '=='` at
  `apply_plan_model.gd:236`, six times, after Applies. A `card` block with `restored: false` fell through to
  `card == true`. It aborts `apply_flow._finish` after `_end()`, so the Apply result line was lost; it does not block
  the dock.

## What was done

Not a fix of a known cause — hardening and evidence for the next time:

- `godot/client/app/operator_dock.gd`: dock buttons use `ACTION_MODE_BUTTON_PRESS`. A Godot button normally fires on
  the release, and only if the release is still on it; a release that lands off the icon (pointer jitter over a remote
  desktop, the name bubble or the dock changing under the pointer) is a click that silently does nothing. `launch()`
  prints `[client] dock <action> pressed` before it asks the server.
- `src/system/operator-dock.js`, `src/api/routes-operator-dock.js`: refused launches (unknown app, password) are logged
  as `[dock] <action>: refused — …`.
- `godot/client/features/devices/apply_plan_model.gd:236`: `card == true` only for a bool.

## Verified

- Godot tests 28489 passed (3 new `restored_text` cases); `smoke-wo628-operator-dock` 13 pass (1 new).
- On the box after relaunching the GUI (07:22): real click on the icon → client log `dock firefox pressed`,
  `dock firefox → 200`; journal `[dock] firefox: launched`; a Firefox window on the operator screen.
- Not verified: that this cures what happened on 14.11.

## Open

- If it happens again: `grep "dock" ~/.local/share/godot/app_userdata/"HighAsCG Operator"/logs/godot.log` — a
  `pressed` line without an answer means the request hung; no `pressed` line means the click never reached the icon.
- A server restart kills an open Firefox (and every other app opened from the dock): they are children of the
  service. Not changed here.
