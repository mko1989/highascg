# PIP overlay — outside border (canonical model)

**Status:** Canonical reference (2026-06-29). Do not regress this without updating this doc and `tools/smoke/smoke-pip-overlay-placement.test.js`.

Outside borders, glows, and edge strips on scene-layer PIP overlays use a **two-layer coordinate model**: an expanded Caspar CG canvas with a normalized **content hole**. This is **not** the same as the full-frame **global border** (which always forces `side: 'inside'`).

---

## The rule

> **Outside effects require the overlay CG layer to be physically larger than the video layer, with the template drawing on the content edge and the effect spilling into the margin.**

If the CG `MIXER FILL` matches the video rect exactly, an “outside” stroke is clipped by the layer bounds and looks like an **inside** border. That is a placement bug, not a template tweak.

---

## Placement (server + client must match)

Implementation: `src/engine/pip-overlay-utils.js`, mirrored in `client/lib/pip-overlay-amcp.js`.

| Piece | Inside (`side: 'inside'`) | Outside (`side: 'outside'`) |
|-------|---------------------------|-----------------------------|
| `MIXER FILL` | Same as content layer | `expandFillOutward(contentFill, totalOutsetPx, chW, chH)` |
| `inner` in CG JSON | `{ l:0, t:0, w:1, h:1 }` | `innerRectInOverlayNorm(contentFill, overlayFill)` — content hole inset in the expanded canvas |
| Stack banding | N/A | `computeOutsideStackBands` / `ringInnerPx` / `ringOuterPx` / `totalOutsetPx` |

**`totalOutsetPx`** = sum of `outsetPxForPipOverlay()` for every **outside** overlay in the stack (index 0 = furthest out, higher indices closer to content).

**`params.side` in CG JSON** must match placement: `buildPipOverlayCgPayload()` forces `side` via `effectivePipOverlaySide()`. Defaults are `outside` for `border` and `edge_strip`; do not let registry defaults disagree between server and client.

---

## AMCP order

Every ADD and UPDATE must include:

1. `CG … UPDATE` with `inner`, `side`, and ring fields
2. `MIXER <ch>-<overlayLayer> FILL …` using the **expanded** fill (when outside)
3. `MIXER <channel> COMMIT` so DEFER lines apply (`sendPipOverlayLinesSerial`)

Inside↔outside toggles require **CG re-ADD** (not UPDATE-only) so CEF reloads template behaviour. Live inspector keys stack shape by `type:side` for this reason.

---

## Template rendering (`pip_border.html`, `pip_glow.html`)

Do **not** use CSS `border`, `outline`, or SVG stroke centered on a content-sized box for outside mode — Caspar CEF often clips or paints inward.

**Correct pattern** (same as `pip_glow`):

1. `#root` fills the **expanded** CG viewport (`inset: 0`, `overflow: visible`).
2. `.pip-frame` is positioned at `inner` (`left/top/width/height` as % of root).
3. **Outside:** `box-shadow: 0 0 0 <width>px <color>` on `.pip-frame` — ring grows **outward** into the margin.
4. **Inside:** `box-shadow: inset 0 0 0 <width>px <color>`.

`pip_edge_strip.html` uses SVG on the content boundary in full-canvas coordinates for outside mode (animated dash). `pip_router.html` is legacy; multi-overlay stacks use **one template per slot** (`buildPipOverlayAmcpLinesAll`), not a single router layer.

---

## Anti-patterns (do not reintroduce)

| Wrong | Why it breaks |
|-------|----------------|
| Content-sized `MIXER FILL` + `side: 'outside'` | Outside half of stroke clipped → looks inside |
| `innerRectPipLocalFromOutset()` paired with expanded fill | Shrinks frame below content; border draws too small |
| Placement `outside` but CG JSON `side: 'inside'` | Template draws inset inside the content hole |
| `pip_router` for multi-overlay stacks | Collapsed effects; outside border regressed |
| CSS `outline` / SVG stroke only, no expanded fill | Unreliable in CEF; margin required |

---

## Global border contrast

`src/engine/global-border.js` forces `side: 'inside'` because the global border spans the full channel (`inner = full canvas`). Outside mode there pushes past the HTML body and clips. **PIP per-layer overlays** are the only place outside borders are valid.

---

## Verification

```bash
node --test tools/smoke/smoke-pip-overlay-placement.test.js
```

After template changes: restart `highascg`, hard-refresh UI, **remove and re-add** the overlay on air so Caspar reloads HTML.

**See also:** [25_WO_PIP_OVERLAY_EFFECTS.md](../../work/work-orders/25_WO_PIP_OVERLAY_EFFECTS.md)
