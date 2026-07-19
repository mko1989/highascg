# WO-263 — Invert the operator overlay: punch holes in Firefox, Caspar consumer sits below

**Status:** Implemented (helper inversion—Firefox hole-punching in operator-shape-overlay.py, and <always-on-top>false generator flip—both present in working tree; owner acceptance pending)
**Priority:** URGENT (operator GUI shows no usable video)
**Owner check:** A263.1

## Why (live-proven, owner 2026-07-16)
WO-255 put the Caspar consumer ON TOP with an empty input region so clicks pass through to Firefox below. Two live failures killed it:
1. The shape helper's first stdin payload after spawn wasn't delivered → consumer never shaped, sat opaque under Firefox (WO-262, being fixed — stdin delivery is orthogonal and KEPT).
2. **Fundamental:** even when the owner manually raised the consumer to see video, it **disappeared the instant they clicked the GUI** — the WM raises the focused Firefox above an always-on-top video window. A video-window-on-top design cannot survive GUI interaction.

## The inversion
- Firefox stays fullscreen ON TOP and takes all clicks (natural — it's the focused kiosk). No stacking fight.
- The shape helper punches HOLES in FIREFOX at the reported preview rects (bounding shape = full window MINUS the rects). The Caspar operator_gui consumer sits BELOW and shows through the holes.
- No empty-input trick: Firefox keeps input everywhere it's still visible. Clicks INSIDE a hole fall through to the (dead) Caspar window — accepted: previews are display-only, tile drag/resize handles are chrome outside the holes.
- Interaction suppression (modal/drag) → empty rects → helper RESTORES Firefox unshaped so dialogs render whole over preview areas.
- Targeting Firefox (a window WE launched, matched by WM_CLASS navigator/firefox on the operator monitor) is far more robust than hunting Caspar's ever-respawning "Screen consumer [5|…]" window.

## Parts
- **T263.1 — helper** (`tools/runtime/operator-shape-overlay.py`, agent ade58e4d): flip target to Firefox; bounding = monitor rect minus preview rects (ShapeSubtract); drop the empty-input shape; empty rects → unshape; keep the WO-262 stdin-delivery fix + heartbeat log; docstring inverted. Xvfb :78 repro required.
- **T263.2 — generator** (`src/config/config-generator-operator-gui.js`, DONE, held): `<always-on-top>false</always-on-top>` for the operator_gui consumer + comment/label updated. Applied only on owner config-regen+caspar-restart.
- **T263.3 — smoke** (`tools/smoke/smoke-wo243-operator-gui.test.js`, DONE, held): assertion flipped to `always-on-top>false`.
- **T263.4** — the server shape-feed still calls `updateShapeRects(monitorRect, rectsPx, {channel})`; the helper ignores `channel` now (Firefox match) but keeping it in the payload is harmless. Confirm no server change needed (report).

## Landing
All parts commit TOGETHER when the helper lands — committing the generator flip alone would drop the consumer below an unshaped Firefox (worse). Then: owner regen config → caspar restart → hard-reload operator Firefox.

- [x] T263.1 helper → Firefox holes (agent)
- [x] T263.2 generator always-on-top false (held)
- [x] T263.3 smoke assertion flipped (held)
- [ ] T263.4 confirm no other server change
- [ ] A263.1 (owner) after regen+restart: video shows through Firefox holes, GUI stays interactive, clicking the GUI never hides the video
