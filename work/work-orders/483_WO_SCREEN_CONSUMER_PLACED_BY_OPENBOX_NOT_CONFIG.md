# WO-483 — PGM2's screen consumer is placed by Openbox, not by its config

**Status: OPEN (11.08.2026 — root cause proven on the box; the fix branches on one measurement the
owner still has to take)**

## 1. Investigation

Owner 11.08: *"the fucking screen consumers do not initialize or something is blocking them"*, then
*"the screen consumer of pgm2 is still missing, doesnt show up on the actual output"*.

**They do initialize.** Every consumer reaches `Initialized.` and creates its window on every start.
The Caspar log is not the place this fails, which is why it kept looking fine.

Measured on highascg0916 (192.168.0.28), canvas 9984x1536, monitors DP-4 `+0+0`, DP-6 `+3072+0`,
DP-2 `+6144+0`, DP-0 `+8064+0`:

| channel | config `<x>/<y>` | Caspar logged | X actually has it |
| --- | --- | --- | --- |
| 1 (PGM1, 6144x1536) | `0,0` | `(0, 0)` | `(0,0)` ✅ |
| **3 (PGM2, 1920x1080)** | **`6144,0`** | **`(6144, 0)`** | **`(4032,228)`** ❌ |
| 4 (operator GUI, 1920x1080) | `8064,0` | `(8064, 0)` | `(8064,0)` ✅ |

`4032 = (9984-1920)/2`, `228 = (1536-1080)/2` — dead centre of the canvas. That is
`~/.config/openbox/rc.xml`:

```xml
<placement>
  <policy>Smart</policy>
  <center>yes</center>
```

with an `<applications>` section that contains nothing but the commented-out example — **no rule for
casparcg**. Openbox places new consumer windows by its own policy and discards the position the
config asked for.

**Why only PGM2 is wrong is the useful part:**

- **ch 4 is correct because highascg places it.** `operator-gui-launcher-placement.js` does an
  explicit `windowmove` + verify (+ fullscreen toggle) for the operator-GUI consumer — WO-279 exists
  precisely because "geometry belongs to the WM".
- **ch 1 is correct by luck.** Smart placement cannot centre a 6144-wide window in a 9984 canvas
  usefully, so it falls back to the top-left corner — which happens to be where it belongs.
- **ch 3 is an ordinary 1080p consumer that nobody places**, so it gets the centring treatment.

It is also buried: stacking bottom→top is `0x40000e (ch3), 0x400007 (ch1), 0x400010 (ch4)`, and at
`(4032,228)` ch 3 sits entirely inside ch 1's window, which is above it. Misplaced **and** occluded.

## 2. The fix, and the measurement it depends on

The generated config is already right (`<x>6144</x><y>0</y>` for ch 3), so nothing in the generator
needs changing. What is missing is that **only the operator-GUI consumer gets its geometry enforced
after the WM has had its say.** Two candidate fixes, and which one is correct depends on whether
Openbox merely *places* or actively *re-asserts*:

- **A move sticks** → generalise the WO-279 placement pass to every screen consumer: on Caspar
  connect, for each screen consumer in the generated config, `windowmove` to its `<x>/<y>` and
  verify. Self-healing across Caspar restarts, no WM config touched.
- **A move snaps back** → Openbox is re-asserting and it has to be an `<applications>` rule in
  `rc.xml` (one entry per consumer title, with explicit position), generated alongside the Caspar
  config so it tracks layout changes.

`tools/startup/place-screen-consumers.sh --apply` prints `STAYED` or `SNAPPED BACK` per consumer and
settles it in one run.

## 3. What was verified

- The table above, live over SSH: config `<x>/<y>` from `/api/caspar-config/generate`, Caspar's
  intent from its own log, actual geometry from `xdotool getwindowgeometry`.
- The centring arithmetic reproduces both misplaced coordinates exactly.
- `~/.config/openbox/rc.xml` on the clone: `Smart` + `<center>yes</center>`, `<applications>` empty
  but for comments.
- Stacking order confirms ch 3 is beneath ch 1 at its wrong position.

**Immediate workaround** (survives until the next Caspar restart):
`DISPLAY=:0 xdotool windowmove $(xdotool search --name 'Screen consumer \[3\|' | head -1) 6144 0`
