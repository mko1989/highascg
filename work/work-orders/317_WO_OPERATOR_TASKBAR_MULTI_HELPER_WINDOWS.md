# WO-317 — Multiple helper windows + taskbar on the operator monitor, browser stacked UNDER Caspar

**Source:** todos21.07.26 — "the app needs to be able to run multiple 'windows' file browser and
web browser togheter. when its running clicking on web browser running should bring the browser to
front. can the gui browser and casparcg screen consumer 'background' be glued togheter, meaning
when the standard web browser is hiden it overlays the caspar window, id like it to be under the
caspar window. basicly a taskbar, or just add the systems taskbar to the operator monitor."

## Where this starts from (do not rebuild what exists)
WO-283 already shipped the hard part for ONE helper at a time:
- `src/system/operator-helper-window.js` — state machine (idle → helper open → restored),
  750ms watchdog, restore-on-crash, idempotent restore.
- `setOperatorShapeHelperOpen` on the overlay protocol + the `helperOpen` skip of the
  top-assert in `tools/runtime/operator-shape-overlay.py`'s `apply_holes()`.
- `promoteGuiWindowsAboveKiosk` / `findGuiWindowIds` in `src/utils/x-display-session-runtime.js`
  (kiosk excluded by the `HIGHASCG-OPERATOR-GUI` title marker, because helper Firefox is the
  same binary — no WM_CLASS filter can separate them).
- `POST/GET /api/system/operator-helper-window` + the header-bar button.

This WO generalises that from "one helper, open/close" to "N helpers, each with a taskbar entry,
click-to-front, and a defined parked position in the stack".

## The three requirements, precisely

### 1. Multiple helpers at once
File browser (thunar) AND web browser (helper Firefox) open simultaneously. The WO-283 state
machine is single-slot; it must become a registry keyed by helper id (`file_browser`,
`web_browser`, later `nvidia_settings`, `decklink_setup`) with per-window watchdog state.
Restore-on-crash stays per-helper: one crashed helper must not tear down the others, and the
kiosk top-assert may only resume when the LAST helper is gone (`helperOpen` becomes a count or
a set, not a boolean).

### 2. Click-to-front (the taskbar)
A taskbar listing each running helper; clicking a running helper's entry raises + focuses it
(the WO-283 promote path: `--add ABOVE` + `windowactivate`); clicking the active one can lower
it back to its parked position (toggle, like a normal taskbar).

**Recommendation: build the taskbar INTO the operator GUI (a client strip fed by
`GET /api/system/operator-helper-window` state, actions via POST), not a system taskbar.**
Reasons, from the WO-283 measurements: the kiosk is `_NET_WM_STATE_FULLSCREEN` + `ABOVE` and
covers the whole monitor — a real panel (tint2 etc.) reserves space via struts, and struts are
ignored for fullscreen windows, so the panel would be invisible behind the kiosk (or require
punching yet another shape hole and weakening the kiosk contract). An in-GUI strip needs no new
X machinery at all: the server already knows every managed helper and its liveness from the
watchdog. If the system-taskbar route is ever wanted anyway, it needs its own investigation on
the shaped kiosk — do not bolt it on inside this WO.

### 3. "Hidden" browser parks UNDER the Caspar consumer window
Today a de-focused helper still sits wherever the last raise left it — over the Caspar output.
Wanted: when the operator sends the browser away (taskbar toggle / kiosk refocus), it drops
BELOW the Caspar screen-consumer window, so the video is clean again even though the browser
is still running.

Mechanism (verify on the live box before coding): the Caspar consumer windows and the helper
are both NORMAL-layer Openbox clients, and Openbox clamps restacks to the window's own layer —
which means ordering WITHIN the layer is allowed. So parking =
`xdotool windowstate --remove ABOVE <helper>` then a `ConfigureWindow(stack_mode=Below,
sibling=<caspar consumer wid>)` (or `xdotool windowlower`). The consumer window ids are already
known to the shape/session tooling (they are what the holes reveal). Two traps:
- The overlay's `apply_holes()` re-asserts kiosk stacking on every payload — parking must
  survive that (park state lives in the helper registry; re-park after each overlay assert,
  or assert order helper < caspar < kiosk in one place).
- Openbox "fullscreen yields when unfocused" (WO-283): refocusing the kiosk is part of parking,
  otherwise the kiosk itself is not back in the fullscreen layer.

## Acceptance
- File browser and web browser open at the same time; each has a taskbar entry in the operator
  GUI showing running state.
- Clicking an entry brings that helper above the kiosk and focuses it; clicking again (or a
  dedicated park control) sends it under the Caspar consumer window and returns focus to the GUI.
- A parked browser is fully invisible on the video holes (verify by eye on the live output).
- Killing one helper (`kill -9`) restores/cleans only that entry; the other helper and the
  kiosk contract are untouched. Last helper gone → kiosk top-assert resumes (journal line).
- Shape contract untouched at all times: bounding holes, input-dead consumers, pointer confine.
- Offline tests for the pure logic: registry transitions, helperOpen refcount, park/raise
  decision table, restore-on-crash per helper. `npm run test:ci` → 0 fail.

## Constraints
- LIVE box: no service restarts, no kiosk relaunches, no X session mutation while investigating.
  Read-only X queries ok. Owner validates on the real display.
- Client edits need `npm run build:client` + kiosk reload (dist-web rule).
- Reuse WO-283 files; extend, don't fork. Keep each file under the 500-line limit.
