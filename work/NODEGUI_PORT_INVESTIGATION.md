# NODEGUI_PORT_INVESTIGATION — porting the web UI to NodeGUI, and the "native preview" question

**Source:** todos21.07.26 — "tell me how big of a work it would be to port the webui to the node
gui https://github.com/nodegui/nodegui — could this give as more native preview from casparcg?"

Written 2026-07-21. This is the NodeGUI-specific follow-up to
`work/NATIVE_GUI_PROPOSITIONS.md` (2026-07-20), which measured the whole port surface but did not
cover NodeGUI. All port-surface numbers below are that document's measurements, not re-estimated.

---

## 1. What NodeGUI actually is (checked upstream 2026-07-21)

- Node.js bindings to **Qt Widgets** (QWidget/QLabel/QPushButton…), running your JS in a custom
  Node distribution (Qode) whose event loop is merged with Qt's. **No Chromium, no DOM, no HTML.**
- Now bound to **Qt6** (it migrated off Qt5), latest release v0.74.2 (May 2026), ~9.2k stars,
  active maintenance. So the easy dismissal — "dormant Qt5 project" — is NOT true today; it is a
  living project and deserves a fair sizing.
- Layout is flexbox via Yoga; styling is Qt stylesheets — a CSS-*like* subset, not CSS.
- It is Qt **Widgets**, not QML/Qt Quick: no declarative scene graph, no Qt Quick 3D. Custom
  drawing is QPainter on widget paint events, called across the JS↔native bridge.

The one structurally attractive property versus every option in NATIVE_GUI_PROPOSITIONS.md:
**it stays JavaScript.** That changes which parts of the 81,195 LOC client survive.

## 2. How big is the port

The server is untouched, as always (the 163 API endpoints / ~21 WS message types boundary means a
NodeGUI app is just another client; the web UI keeps working for remote browsers — you would be
maintaining TWO operator UIs, not replacing one).

Per measured cluster:

| Cluster (measured LOC) | Fate under NodeGUI |
|---|---|
| `client/lib/` pure logic — 29,093 LOC | **Mostly survives as-is.** Plain ESM, no DOM in the pure parts (`cellRectsToLayoutCells`, placement math, snap, peak-hold…). This is NodeGUI's unique win — no other native option reuses a line. |
| `ws-client.js` + `state-store.js` (327 LOC) | Ports in days (Node has WebSocket/fetch). |
| `client/components/` DOM UI — 51,436 LOC | **Rewritten.** Every panel, modal, inspector, dropdown becomes hand-built QWidget trees. No HTML, no DOM events, no CSS layout — Yoga flexbox + QSS subset. This is the bulk of the cost. |
| CSS — 11,998 LOC | Partially translatable to Qt stylesheets; expect heavy visual loss and hand-tuning. |
| Canvas 2D clusters — ~9,300 LOC (preview canvas, timeline, mv editor, pixel map) | Rewritten as QPainter paint events **driven from JS**. Feasible, but every 60fps repaint crosses the JS↔C++ bridge per draw call; the timeline and preview canvases are exactly the hot case. Real risk of shipping something slower than Firefox's GPU canvas. |
| SVG cable cluster — 1,495 LOC | QPainter paths; mechanical but manual. |
| Previs WebGL — 4,324 LOC (three.js) | **No target.** NodeGUI has no WebGL/three.js and no Qt Quick 3D (that is QML-side). Previs dies or stays in a browser window. |
| Electron launcher / kiosk / shape tooling | Replaced by NodeGUI equivalents; XShape self-shaping works (a QWidget exposes its native winId), same as the other native options. |

**Estimate: 30–55 person-weeks.** The floor is lower than GTK4 (45–70) or Qt6/QML (40–65) because
~29k LOC of logic and the transport survive verbatim. The ceiling is real because the three
biggest risk items — 51k LOC of widget UI, bridge-throughput for the canvas clusters, previs —
are all on the expensive side of NodeGUI's design. At the measured velocity (single developer,
249 commits/60 days, mid release-prep) that is still **7–12 months of release slip** to reach
feature parity with what already runs.

Where it slots into the NATIVE_GUI_PROPOSITIONS summary table:

| Option | Language | Client modules reused | Effort (pw) | Shaped video | Risk of worse-than-today |
|---|---|---|---|---|---|
| A. Lean kiosk (baseline) | unchanged | 435/435 | 1–3 | already works | near zero |
| **NodeGUI (this doc)** | JS (Qt6 Widgets) | **lib yes (~29k LOC), components no** | **30–55** | works (winId→XShape) | **high** (bridge perf on canvas-heavy screens, widget-gap, previs dead) |
| D. Qt6/QML | C++/QML | 0/435 (logic ports well) | 40–65 | works + shared-texture research path | moderate-high |

NodeGUI is the cheapest *full-native* row — and still 10–20× the cost of Option A, for a UI that
already works. It also strictly loses to Qt6/QML on rendering power (no scene graph, no Qt
Quick 3D, no QRhi) while winning only on language familiarity and lib reuse.

## 3. "Could this give us more native preview from CasparCG?" — No.

The preview architecture already IS native, and no toolkit changes that:

1. **Video never enters the GUI today.** The hole-punch (X SHAPE) shows the *actual* CasparCG
   screen-consumer window through the kiosk — zero-copy, zero-latency, true output pixels. There
   is no more-native preview than the output itself. A NodeGUI window would do the same trick the
   same way (winId → XShape) at best — parity, not improvement.
2. **NodeGUI cannot composite another process's GL.** Qt Widgets have no path to CasparCG's
   frames except the ones that exist for every client: piping frames (the JPEG compose preview,
   shm, or NDI) into a widget. That is strictly *worse* than the holes — copies, latency,
   compression — and it is available to the web UI already.
3. The only genuinely different mechanism a Qt-based GUI unlocks is
   `QWidget::createWindowContainer(QWindow::fromWinId(<caspar wid>))` — **reparenting Caspar's
   own X window into the GUI** instead of punching holes under it. That would make the preview a
   real child widget (clipped, stacked, moved for free — it would incidentally solve the WO-317
   stacking questions). It is also research-grade: foreign-window containers around another
   process's OpenGL window are exactly the kind of thing that works until it deadlocks vsync or
   the window manager, and Caspar's consumer was never designed to be reparented. Note this is a
   plain-Xlib capability — if it is ever worth testing, it can be tested against the CURRENT
   Firefox kiosk in a one-day spike without any NodeGUI adoption.

So: NodeGUI offers no preview improvement over what ships today; the one interesting idea it
points at (window reparenting) does not require NodeGUI.

## 4. Verdict

Same as NATIVE_GUI_PROPOSITIONS.md, sharpened for this candidate: **do not port.** NodeGUI is
the most credible full-native candidate yet examined (JS reuse, active Qt6 project), and it is
still 30–55 person-weeks to re-achieve the present, with the canvas-heavy screens at real risk of
ending up slower and previs having no home. The preview question — the stated motivation — is
answered by architecture, not toolkit: the current holes are already the most native preview
possible, and NodeGUI adds nothing there.

If the itch persists, the cheap experiments, in order:
1. The one-week shaped-window spike from NATIVE_GUI_PROPOSITIONS.md §"smallest experiment"
   (validates native self-shaping — toolkit-agnostic).
2. A one-day `XReparentWindow`/window-container spike against the existing kiosk (validates the
   only novel preview idea in this space, with zero commitment to any port).
3. Stages 0–3 of the staged path (prune, previs decision, write the API/WS contract down,
   harden the logic/view seam) — each makes the shipping product better AND any future port
   cheaper, NodeGUI included.
