**Status: DONE (2026-09-29, offline suite 2526/0/2, lint clean, client built) — not yet eyeballed live**

# WO-583 — Edge strip: live param edits without restarting the animation + alternating strip colors

Owner: "global border for screens. every change to an edge strip global border for instance does a
restart of the whole animation, this should be possible to do live changes that does not restart the
whole animation. … add an option in edge strip when more than 1 concurrent strip is enabled to do the
colors alternate, meaning first strip is color1 and glow is color2, second strip is color3 and glow
color4 than third color1 and glow color2 and so on."

## Root cause (restart)

- Param edits already travel the live path: inspector → `pushBorderOnlyNow` → `/api/scene/border-lines`
  with `isUpdate` → server writes `template/global-border-live-<ch>.json` → template polls it (33 ms).
- But `template/pip_edge_strip.html` `render()` wipes `#root` and rebuilds every SVG `<rect>`, and each
  new rect starts its CSS animation at progress 0 (delay only offset strips by `i/n`). So every tweak —
  color, speed, thickness — snapped every strip back to its start position.
- Slice edits were worse: `scene-state-global-border.js` set `borderJustEnabled` on any slice change and
  `borderUsesCgUpdate` required an unchanged `slicesKey`, so each slice edit did a full CG ADD + fade
  (template reload).

## Fix

- [x] Template motion clock: signed px travelled along the edge (`motion.dist` + `speed × elapsed`,
  timed off `document.timeline.currentTime`). Every render sets each strip's `animation-delay` to
  `-(progress × dur)` where progress comes from that distance, so a rebuilt strip resumes where it
  was. Speed/direction changes fold the distance covered so far first → no jump, only pace/direction
  changes. Verified under a stub DOM: speed change / direction flip / color change jump ≤ 0.00013 of a
  loop (ms rounding of the delay).
- [x] edge_strip slice edits go live: no `borderJustEnabled` on slice change, and `borderUsesCgUpdate`
  ignores `slicesKey` for `edge_strip` (template already re-reads `slices` from UPDATE/live file).
  Other border types keep the re-ADD behaviour.
- [x] New params `altColors` (bool), `altColor`, `altGlowColor`: with `count > 1` and `altColors` on,
  even strips (1st, 3rd…) use `color`/`glowColor`, odd strips (2nd, 4th…) use `altColor`/`altGlowColor`.
  Defaults added to client registry, server `pip-overlay-utils.js`, template state; Art-Net
  `runtimeParamsFromSlot` carries them through (not DMX-mapped).
- [x] Schema `visibleWhen` rules + `pipOverlayFieldVisible()` in `pip-overlay-registry.js`: the toggle
  shows only with 2+ strips, the two colors only when the toggle is on. Both the PIP overlay card and
  the Global Border inspector toggle the rows in place (no rerender → a `count` slider drag survives).

## Owner acceptance

- [ ] A583.1 Global Border → edge_strip: drag speed / length / thickness / colors — strips keep moving
  from where they are, no snap back.
- [ ] A583.2 Concurrent strips ≥ 2 → "Alternate colors between strips" appears; enable → strips alternate
  color/glow pairs.
- [ ] A583.3 Edit slices on an edge_strip border — no fade-out/in, animation continues.

Needs: kiosk reload (dist-web rebuilt), and the template only reloads in Caspar on the next CG ADD of
the border (toggle the border off/on once, or change its type and back). Server defaults / Art-Net
pass-through need a node restart.
