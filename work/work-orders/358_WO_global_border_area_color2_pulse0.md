# WO-358 — Global border: area rect, glow secondary color cycle, pulse to 0

**Status: DONE (2026-07-27, headless-verified renders)** · Source: owner: "global border needs to
be displayed inside its set width height (also for slices). add to the glow secondary color and
time slider for how long the transition from first to second should be, hide it under enable
secondary color. the pulse values needs to be able to go all the way to 0."

## Findings first (headless probes with the real templates)

pip_glow AND pip_border already render correctly inside a partial inner rect and per-slice —
the missing piece was that WITHOUT slices there was no way to SET the rect: the server builder
hardcoded inner = full canvas and no UI existed for it.

## 1. Border area

- Effect inspector gains "Area % (X/Y/W/H)" — writes `gb.inner` (fractions); slices override.
- `buildGlobalBorderCgJson` honors `ov.inner` (clamped) when no slices are defined; the live
  33ms writer reuses the same builder so live tweaks follow. Slices keep their own rects.

## 2. Glow secondary color (hidden under the enable toggle)

- Registry + server defaults: `color2Enabled` (bool), `color2` (color), `colorCycleSec`
  (0.2–20 s, "first → second"). Inspector shows color2/cycle ONLY when enabled (rerenders on
  toggle).
- pip_glow: shadows ride `currentColor`; a `glow-cycle` keyframe animates `color` between the
  two colors (ease alternate, duration = colorCycleSec), composing with the pulse animation
  (`.pulse.cycle` lists both). Headless probe confirms the mid-cycle secondary color renders,
  confined to the rect.

## 3. Pulse to 0

- `pulseSpeed` schema min 0.5 → 0 (minOpacity already reached 0).
- pip_glow: `parseFloat(x) || 2` swallowed 0 → proper isFinite parse; pulseSpeed 0 = pulse off
  (a 0s animation would strobe).

## Verification

Headless renders: slices at their rects, partial-rect confinement, secondary color mid-cycle.
test:ci 1555/0, lint 0, gate 0; service restarted, kiosk reloaded. Owner QA: Area % fields,
enable-secondary flow, pulse sliders to 0.
