# WO-533 — "Reset layout" in one editor blanked the other editor's compose preview

**Status: FIXED in repo (14.08.2026) — 6 smokes, suite 2235 / 2233 pass / 0 fail / 2 skip. Owner QA owed (§5).**
**Priority:** High (destroys the other editor's arrangement, permanently)
**Source:** `work/work-orders/todos14.08.26` line 4: *"the problem with the compose preview is that
when i hit reset in looks editor to get a standard compose preview it blanks the compose preview in
timeline editor and vice verse."*
**Related:** [WO-529](./529_WO_COMPOSE_PREVIEW_RESETS_ON_EDITOR_SWITCH.md) (the same degenerate-canvas
hazard, reached via ResizeObserver), [WO-530](./530_WO_COMPOSE_SURFACES_AND_SOURCE_LABELS.md) (per-surface
seeding — this is the third leak of the same "both editors are always mounted" fact), WO-256, WO-323

---

## 1. Why it hit both editors

`client/components/preview-canvas-panel.js:385`:

```js
grabBtnEl.onclick = () => { window.dispatchEvent(new CustomEvent('operator-tiles-reset-request')) }
```

and `client/components/operator-compose-tiles.js:325`:

```js
window.addEventListener('operator-tiles-reset-request', onResetRequest)
```

A bare event on `window`, with no addressee. Workspace tabs toggle an `active` class and nothing
else — the editors are never destroyed (established in WO-529) — so **both** tile canvases are
listening, and one button reset both.

This is the third distinct bug caused by that one fact. WO-529 was the transition, WO-530 was the
persistence, this is the commands.

## 2. Why it *blanks* rather than merely resets

Resetting the visible canvas is harmless — that is what the button is for. The damage is on the
hidden one:

```js
function resetLayout() {
	saveTileLayout(storage, storageKey, {})
	const { w: cw, h: ch } = canvasSize()          // display:none pane -> Math.max(1, 0) = 1x1
	const fresh = computeDefaultTileLayout(defs, cw, ch)
	…
	persist()                                       // ← writes it to THIS canvas' localStorage key
}
```

`canvasSize()` floors at 1×1 (`tile-controller.js:47`). Packing four tiles into a 1×1 box does not
fail, it just picks the degenerate grid — measured, not assumed:

```
1600x700 →  each tile { w: 0.5,  h: 0.5  }     a 2x2 grid
1x1      →  each tile { w: 0.25, h: 1    }     four full-height slivers
```

Then `persist()` makes it the hidden editor's stored layout. The operator sees nothing at the time;
the loss shows up on the next tab switch and survives a reload. "Blanks" is exact — four slivers in
a canvas that is later 1600 px wide are 400 px of full-height letterbox each, i.e. no usable image.

## 3. The fix

**Address the event.** The panel already knows its surface (WO-530 threaded it):

```js
new CustomEvent('operator-tiles-reset-request', { detail: { surface } })
```

and each canvas ignores a reset aimed elsewhere. An event with **no** surface still resets
everything — nothing dispatches one today, but a bare event honestly means "all", and silently
dropping it would be a worse trap than the one being fixed.

**Refuse the degenerate pack.** Belt and braces, so no future path can persist slivers:

```js
const real = cw > 1 && ch > 1
const fresh = real ? computeDefaultTileLayout(defs, cw, ch) : computeDefaultTileLayout(defs)
```

The argument-free default is `computeDefaultTileLayout(defs, 1920, 1080)` — the same reference
`defaultTileLayout` in `operator-compose-tiles-state.js:72` already uses — and the next real layout
pass re-fits it to the actual box. Identical reasoning to WO-529's `real` guard in `onCanvasResize`.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo533-reset-layout-is-per-surface.test.js` — 6 tests, curated CI list: the real
  `computeDefaultTileLayout` reproduces the 2×2-vs-slivers difference and the safe fallback; the
  panel names its surface; a canvas ignores another surface's reset; and `resetLayout` cannot pack
  against a degenerate canvas.
- Suite **2235 / 2233 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit 0 over. Client builds.

## 5. Owner QA on the kiosk

1. Arrange tiles in the looks editor. Arrange them differently in the timeline editor.
2. Hit **Reset** in the looks editor. Only the looks editor may change.
3. Switch to the timeline editor: its arrangement must be exactly as left, not slivers, not blank.
4. Reverse the roles and repeat. Then reload the page and check both again — the old fault was
   persisted, so a reload is part of the test.

## 6. Work log

- 2026-08-14 — Traced to an unaddressed window event plus a 1×1 pack of a `display:none` pane, the
  third consequence of "both editors stay mounted". Both halves fixed, 6 smokes.
