# WO-911 — Visuals: the work-area mode hint pinned the tab's width — Inspector pushed off-screen, split not draggable

**Area:** godot-client
**Status: DONE (31.10.26 — min-width probe 1260 → 463 px in every mode; owner GUI relaunched: Inspector inside the window, split dragged 400 → ~590 px)**

## Owner report (31.10.26)
"cant resize the inspector in the visuals tab and its truncating content of the inspector"

## 1. Investigation
- Owner GUI screenshot (DP-4, 1920 px, Visuals ▸ Controller): the Inspector column started at x ≈ 1582 and ran past the
  window's right edge (layer rows cut after "Add ▲ ▼", the ✕ buttons and the "%" spin boxes off-screen).
- New dev probe `--probe-min-width=<tab> [--probe-min-width-modes=A,B,…]` (`app/min_width_probe.gd`, wired in
  `main.gd`'s probe table) prints each column's combined minimum width and the chain of widest-minimum children. Private
  Xvfb :93, scratch XDG_DATA_HOME, `HIGHASCG_SERVER` → `tools/dev/readonly-proxy.js`:
  - Visuals tab minimum per work-area mode: Flow 846, **Controller 1260**, Visual playlist 1097, Shader 780, 3D 559 px —
    every time the leaf was the mode-hint `Label` in `visuals_workarea.gd` (no clip / overrun, so its whole text is its
    minimum width; Controller's hint is 914 px).
  - Window 1920 − Sources 280 = 1640 px for tabs + Inspector; Controller's 1260 + the Inspector's 400 minimum don't fit,
    so the HSplitContainer can't move (both sides at their minimum) and the window content overflows on the right.

## 2. What was done
- `features/visuals/visuals_workarea.gd`: the hint Label expands to fill the bar and trims with an ellipsis
  (`OVERRUN_TRIM_ELLIPSIS`); the full hint is its tooltip. A hint can no longer set the tab's width.
- `app/min_width_probe.gd` kept as the dev probe for the next "column won't shrink" report.

## 3. Verified
- Godot suite 25490 passed, 0 failed.
- Probe after the fix: Visuals tab minimum 463 px in every mode (the next leaf is the A↔B fader row, 180 px slider).
- Owner GUI relaunched (`run-client.sh --autostart`): Visuals ▸ Controller — Inspector fully inside the window, hint ends
  "…"; dragging the split from x 1517 → 1320 widened the Inspector to ~590 px (layer names no longer cut).
