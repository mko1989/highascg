# WO-1064 — PIP overlays (border, glow, shadow, edge strip) are thicker top and bottom than left and right

**Area:** engine, video-io
**Status: DONE (13.11 — all four types measured on PGM 2: left = top on a 240×560 layer; owner's glow look even)**

Owner, 13.11: *"a border glow effect on a masked input from pixelhue has more 'width' on top and bottom than left
right."* — then: *"im pretty sure this wasnt only a problem in the glow border, but possibly in all of them"*.

## Investigation

- An overlay is an HTML template on a CG layer of its own. The page is the channel's size (3072×1024); the server puts
  it on the overlay's rectangle with `MIXER FILL` (`computePipOverlayPlacement`, `src/engine/pip-overlay-utils.js`), so
  the page is squeezed by `scaleX` across and `scaleY` down. The templates drew their widths in PAGE pixels
  (`box-shadow … var(--w)`, SVG strokes), so a width came out ×scaleX on the sides and ×scaleY top and bottom.
  Equal only when the rectangle has the canvas's shape — never for a masked switcher layer.
- Measured on PGM 2 (ch 4), the owner's "Look 18": an 817×669 layer, glow width 44 / intensity 38 → 16 px left and
  right, 40 px top and bottom (ratio 2.5 = 0.821 / 0.322, the two fill scales). Not specific to masks or to PixelHue.
- The outset the server reserves (`expandFillOutward`) IS in output pixels, so "width = output pixels" was always the
  intent; only the drawing was off.
- A CSS transform alone does not fix a blur: Chromium blurs a box-shadow with ONE radius in device pixels whatever the
  transform (tried on air: sides right, top 2.5× too soft; with `will-change` the other way round).

## What was done

- The CG payload carries `layerPx` = the overlay rectangle's size in channel pixels (inside and outside overlays).
- `template/pip_border.html`, `pip_edge_strip.html`: with `layerPx` the root is laid out at that size and scaled up to
  the page — the two scales cancel, 1 px in the template is 1 output pixel (hard edges, SVG strokes and the strip's
  CSS `filter: blur` all come out even).
- `template/pip_glow.html`, `pip_shadow.html`: with `layerPx` the box-shadow is replaced by an SVG drawn pre-stretched
  (lengths ×kx / ×ky, `feGaussianBlur` with a deviation per axis, shown outside — or for `inside`, inside — the content
  only, as a box-shadow is). Built once and re-attributed, so an update restarts no pulse / colour cycle.
- Without `layerPx` (global-border slices, old payloads) the templates draw as before.
- Found while testing — `clearPhysicalLookLayers` (`src/engine/scene-exit-layers.js`) swept a stale look layer but not
  its PIP overlay slots: a look re-taken on PGM (every edit-on-PGM cut) left the old bank's glow on 4-620 under the
  new one on 4-260. The sweep now clears the layer's overlay slots too.

## Verified (box, PGM 2, RGBA `PRINT 4`)

- One overlay of each type on a 240×560 rectangle (alpha along a line outwards from the left edge / the top edge, 5 px
  steps): border 20 px → 4 solid steps both; glow and shadow → the same fall-off both; edge strip 12 px → same both;
  edge strip with glow → same both. Test layers cleared afterwards.
- "Look 18" re-taken: left / right / top / bottom fall-offs identical, nothing inside the content.
- Re-take twice: `CG 4-260 CLEAR` when the look lands on 620 and the reverse — one glow on air.
- Offline suite 6190 pass; `WO-897 pixel-map frame tick` (a 25 Hz timing test) failed once in the full run and passes
  alone (5 / 5).

## Effect on existing looks

Overlay widths are now what the number says, in output pixels, on every side. On a layer smaller than the canvas they
were thinner before (a 14 px border on a half-size layer showed 7 px), so existing borders / glows look somewhat
thicker than they did.
