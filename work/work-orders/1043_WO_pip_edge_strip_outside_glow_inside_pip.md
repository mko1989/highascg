# WO-1043 — PIP edge strip set to "outside" still drew over the inside of the PIP (PixelHue placeholder borders)

**Area:** mapping, engine
**Status: DONE (12.11 — template fixed; replayed on the on-air layer 4-260, PRINT shows nothing inside the PIP; smoke fails on the old template)**

Owner, 12.11: *"the pip border that can be set for the pixelhue layers when set to the outside, they still render on
the inside of the pip."*

## Investigation

- The look: narvil `Look 1`, layer 10 = PixelHue placeholder (`#00000000`, "PixelHue · Screen 1 · Layer 3", WO-1035)
  with one `edge_strip` overlay (`side: outside`, thickness 5, glow on, glowWidth 24), on channel 4 (3072×1024).
- Placement is right (`docs/reference/pip-overlay-outside-border.md`): the Caspar log of the take
  (`log/caspar_2026-11-12.log` 21:19:37) has `CG 4-260 ADD … "side":"outside","inner":{…},"totalOutsetPx":31` and
  `MIXER 4-260 FILL 0.50879 0.09668 0.46257 0.80664` — the content (0.51888 0.12695 0.44238 0.74609) grown by 31 px.
- `PRINT 4` of the air frame, alpha profile across the PIP (1594–2953 × 130–894): the crisp strip lies outside
  (top rows 125–129, bottom 894–897) — but the **glow** has alpha 55–73 on 15+ rows inside the PIP on every edge.
  `template/pip_edge_strip.html` draws the glow as a blurred stroke 1.2 × glowWidth wide centred on the strip, which
  sits on the content edge, so half of it washes over the picture. Inside mode clips everything to the hole
  (`overflow: hidden`); outside mode had no mirror clip. On the switcher, HighAsCG's key + fill sits above the PIP,
  so the red haze reads as a border "on the inside".
- pip_border / pip_glow / pip_shadow draw outer `box-shadow`s, which CSS never paints inside the element — not affected.

## What was done

- `template/pip_edge_strip.html`: in outside mode the slice wrapper gets
  `clip-path: path(evenodd, '<huge rect> M 0 0 H w V h H 0 Z')` — the content hole cut out, applied after the glow's
  blur filter (CSS order filter → clip). Inside mode unchanged.
- `tools/smoke/smoke-pip-overlay-placement.test.js`: pins the clip (fails on the old template: 11/1; new 12/0).

## What was verified

- The take's own AMCP block for 4-260 replayed (CG CLEAR + the logged ADD / PLAY / UPDATE / MIXER lines) with the
  new template, then `PRINT 4`: max alpha in a 20 px band inside the PIP — left 0, right 0, top 17, bottom 55, and
  per row only the single anti-aliased edge row (130: 17, 893: 55); rows 131–892 are 0. Outside bands 255 (strip +
  glow intact). Frame viewed with the PIP tinted: strips and glow outside only. Layer left showing the same overlay.
- Not seen on the P80's output / the LED (no camera on it).
