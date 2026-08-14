# WO-529 — Switching between the looks editor and the timeline editor resets the compose preview

**Status: DONE in repo (14.08.2026) — both faults fixed, 4 new smokes, suite 2194 / 2192 pass / 0 fail / 2 skip. Owner QA owed on the kiosk (§6).**
**Priority:** High (operator-GUI usability; the owner hits it on every editor switch)
**Source:** owner 14.08: *"going between looks editor and timeline editor resets the compose preview to either nothing inside of it or just one small rect showing. it should save the set compoose preview for both views."*
**Related:** WO-243/WO-255 (per-surface rect reporting), WO-256 (free-tile compose canvas), WO-319 (shared layout + stream view), WO-338 (throttle, not debounce)

---

## 1. What the compose preview actually is here

On the operator kiosk (`?operatorGui=1`) the preview panel is not a thumbnail — it is a set of
**real X SHAPE holes** punched through Firefox, with Caspar route layers positioned behind them.
Both editors mount the same free-tile canvas, because both pass `composePrvPgmLayoutToggle: true`:

| editor | mount | `storageKeyPrefix` | surface |
|---|---|---|---|
| looks | `scenes-editor.js:212` | `casparcg_preview_scenes` | `compose` |
| timeline | `timeline-editor.js:229` | `casparcg_preview_timeline` | `timeline` |

`preview-canvas-panel.js:21` — `operatorTilesActive = composePrvPgmLayoutToggle && isOperatorGuiModeActive()`.

Crucially the workspace does **not** destroy either editor on a tab switch. `app-tabs.js:12-14`
only toggles an `active` class on the panes, so both canvases stay mounted and both keep their
`highascg-workspace-tab-activated` listener (`operator-compose-tiles.js:321` → `layoutAll()`).

The two rect sets are merged client-side and POSTed as one layout
(`operator-gui-mode-report.js` `mergedCells`), and the server turns that into route layers 10-49
on the operator-GUI channel.

## 2. Fault 1 — the surface handoff went through an empty layout (⇒ "nothing inside of it")

A tab switch is **two reports in the same frame**:

1. The outgoing editor's pane is now `display:none`, so every `getBoundingClientRect()` in
   `reportRectsNow` (`operator-compose-tiles-tile-controller.js:74`) returns zeros.
   `cellRectsToLayoutCells` (`operator-gui-mode-rects.js:23`) drops zero-size rects, so the array
   arrives empty and `reportSurfaceCells` **deletes** that surface.
2. The incoming editor then reports its own cells.

The old `scheduleReport` took the **leading edge** whenever the throttle window was open — which a
user-paced tab switch always is:

```js
if (now - _lastReportAt >= REPORT_DEBOUNCE_MS && !_debounceTimer) {
    _lastReportAt = now
    void sendLayout(effectiveCells())     // ← withdrawal, merged set now EMPTY
    return
}
```

So the intermediate empty set went on the wire. And an empty set is not a no-op — `sendLayout`
turns it into `api.delete(LAYOUT_ENDPOINT)`, which is `clearOperatorGuiLayout` →
`_doApplyOperatorGuiLayout(ctx, ch, [])` (`operator-gui-channel.js:359`): **STOP + MIXER CLEAR on
every route layer**, and an empty rect set fed to the shape overlay. The whole mosaic then had to
be re-acquired from nothing 150 ms later when the incoming surface's debounced POST landed.

This is the same hazard the file already documents for interaction suppression
(`effectiveCells()`'s comment, issues 01.08: *"an empty POST DELETEs the layout, which STOPs every
compose route producer"*) — suppression was fixed then; the surface handoff was not.

**Measured on the real module** (stubbed `fetch`, `?operatorGui=1`, compose settled → withdraw +
timeline report in the same tick):

```
pre-fix :  POST, DELETE, POST
post-fix:  POST, POST
```

## 3. Fault 2 — a hidden pane's 0×0 observation was treated as a resize (⇒ "one small rect")

`canvasSize()` (`:44`) floors the root rect at `Math.max(1, …)`. When a pane goes `display:none`
the ResizeObserver fires a 0×0 observation, which `canvasSize()` reports as a **1×1 canvas**, and
`onCanvasResize` accepted it as a genuine resize:

```js
t.px = clampTileRect(t.pxDesired, newSize.w, newSize.h, minOuter.width, minOuter.height)
t.frac = { x: t.px.x / newSize.w, … }        // ← divided by 1
```

Every tile collapsed to the minimum outer size at the origin, and `frac` — which is supposed to be
a 0-1 fraction — was rewritten from raw pixel counts (`160 / 1 = 160`).

Nothing corrected that before the surface reported again, because the ordering is against us:
`activateTab` toggles the class and dispatches `highascg-workspace-tab-activated`
**synchronously**, so `onTabActivated → layoutAll() → scheduleReport()` (rAF) runs while the
*restoring* ResizeObserver observation is still queued — and ResizeObserver callbacks run after
rAF callbacks. So the first thing the returning editor reported was minimum-size holes.

## 4. What was done

**`client/lib/operator-gui-mode-report.js`** — a withdrawal never takes the leading edge. An empty
merged set always schedules the trailing timer, so a same-frame handoff coalesces into one POST
carrying the incoming surface's cells and the DELETE never happens. A non-empty report arriving
while a withdrawal-only timer is pending cancels it (`_debounceIsWithdrawalOnly`) and takes the
leading edge itself, so the incoming surface is not delayed by the outgoing one. A withdrawal that
is genuinely final still clears the layout, one interval later.

Deliberately **not** changed: `setForegroundTabBlocksVideo` and `setInteractionSuppressed` call
`sendLayout` directly. Those are intentional immediate paths (a popup covered by video for one
frame is the bug WO-255 exists to prevent) and keep their behaviour.

**`client/components/operator-compose-tiles-tile-controller.js`** — `onCanvasResize` ignores a
degenerate observation: no px/frac rewrite, and `lastCanvasSize` keeps the **pre-hide** size so the
observation that follows the pane being shown again is correctly a no-op. `layoutAll()` still runs
while degenerate, because the zero rects are how a hidden surface withdraws itself.

**`client/components/operator-compose-tiles-actions.js`** (new) — `buildPgmTileActions` moved out
whole. The controller was at exactly 500 lines, so the guard change had nowhere to go; per the
500-line rule this is a split, not a cram. Self-contained DOM chrome, no tile state.

## 5. What was VERIFIED

- **Fault 1 proven by before/after on the real module**, not by reading: HEAD's version emitted
  `POST, DELETE, POST` for the handoff; the fixed version emits `POST, POST`. §2.
- `tools/smoke/smoke-wo529-operator-surface-handoff.test.js` (new, 4 tests, in the curated CI
  list): the handoff emits no DELETE; a genuinely final withdrawal still does; the degenerate-
  observation guard is pinned in source; and the geometry survives hide → show while a real resize
  still re-clamps.
- Full offline suite **2194 / 2192 pass / 0 fail / 2 skip**. Lint 0 errors (218 warnings, at the
  cap — unchanged). `format:check` clean. `check-max-file-lines` clean (controller 500 → 447).
- `npm run build:client` succeeds.
- WO-256's resize guard was **repointed, not weakened**: it anchored `clampTileRect(t.pxDesired`
  within 500 chars of `function onCanvasResize()`, a window the body already very nearly filled.
  Widened to 1200 with the reason recorded inline; the guard's own behaviour is now pinned by the
  WO-529 smokes. (The in-code comment was also trimmed — the explanation belongs here.)
- Pre-existing and unrelated: `verify:repo-integrity` fails on 11 Syncthing `sync-conflict` files
  under `projects/`. They are gitignored and untracked, so CI never sees them; not touched.

## 6. Owner QA on the kiosk — what to look for

Not verifiable from here: this is X SHAPE holes on the physical operator monitor.

1. Arrange the compose tiles in the looks editor, switch to the timeline editor and back. The
   arrangement must return **unchanged and immediately** — no blackout, no minimum-size tiles.
2. Watch for the blackout specifically. Pre-fix, every switch STOPped all route layers; if any
   flicker remains, it is a different mechanism and worth saying so.
3. Switch from either editor to **Devices**. The holes must still close (the final-withdrawal case
   is deliberately kept, just 150 ms later).
4. Whether the arrangement also survives a **page reload** in each view is a separate question —
   that is localStorage per `storageKeyPrefix` plus the WO-319 seed rules, untouched here.

## 7. Work log

- 2026-08-14 — Owner report triaged to two independent faults, one per reported symptom. Fault 1
  reproduced against the real client module (POST/DELETE/POST → POST/POST) before fixing. Both
  fixed, 4 smokes added, `buildPgmTileActions` split out for the 500-line limit, WO-256's
  proximity guard repointed with the reason inline. Suite 2194/2192/0.
