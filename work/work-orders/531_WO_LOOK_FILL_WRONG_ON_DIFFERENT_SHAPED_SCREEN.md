# WO-531 — A take sized its layers with the LOOKS EDITOR's selected screen, not the target screen

**Status: FIXED in repo (14.08.2026) — 5 smokes, suite 2214 / 2212 pass / 0 fail / 2 skip. Owner QA owed (§6).**
**Priority:** High (on-air geometry, every main-play take)
**Source:** `work/work-orders/todos14.08.26` — *"when hitting the main play button to transition all selected screen destitionations, the transition not always correctly apply position and size of layers set in looks, like it gets it from somewhere else."* Restated 14.08: *"the main play button still applies wrong sizing on layers at least on ch1."*
**Related:** WO-327 (compose preview dest borders at custom res), WO-238, WO-388

---

## 0. Correction — my first diagnosis was wrong

The first pass of this WO claimed *"Look 3 is live on main 0 AND main 1"*. That was a misread of

```
liveSceneIdByMain    ['63668cee…', '9c93ed10…', None, None]
previewSceneIdByMain ['1215909c…', '9c93ed10…', None, None]
```

Index 1 in **both** lists is screen 1 — Look 3 is live and preview on *the same* screen, not on two.
The owner corrected it: *"look 3 is pgm2 look only."* The composeCanvas-is-null theory built on top of
that reading is withdrawn; §2 replaces it, and it is arithmetically exact against the wire.

Actual assignment: main 0 live = Look 4, preview = Look 1. Main 1 live = preview = Look 3.

## 1. The two screens

```
programChannels    [1, 3]
programResolutions [ {w: 6144, h: 1536},    ← screen 0 (ch1 PGM / ch2 PRV) — 4:1 mapped LED
                     {w: 1920, h: 1080} ]   ← screen 1 (ch3 PGM / ch4 PRV) — 16:9
```

## 2. Root cause — `composeCanvas` came from the editor's selected screen

`client/components/scenes-shared.js`, `buildIncomingScenePayload`:

```js
const cv = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)   // ← the EDITOR's screen
…
composeCanvas: { w: cv.width, h: cv.height },
```

`getCanvasForScreen` returns that screen's real program canvas. The server takes `composeCanvas` as
the **authoring** resolution (`getProgramAuthoringResolution`, `scene-native-fill.js:154`) and, when
it differs from the target channel, remaps every layer through `mapProgramPixelRectToTargetOutput`.

So with **screen 1 selected in the looks editor**, a look taken to **screen 0** was mapped
`1920×1080 → 6144×1536`. Both dimensions shrink by

```
pw·k / ow = 1920 · min(6144/1920, 1536/1080) / 6144 = 1920 · 1.4222 / 6144 = 4/9 = 0.4444
```

**That is the owner's sentence exactly.** *"gets it from somewhere else"* — the canvas of whichever
screen the editor is on. *"not always"* — only when the selected screen differs from the take target
**and** the two screens differ. *"at least on ch1"* — screen 0 is the one furthest from 16:9.

### The wire proves it

`log/caspar_2026-08-14.log`, 12:04:20 — Look 1 staged to ch2 (PRV of screen 0), all three layers
shrunk by the same 4/9, in one batch:

| layer | stored fill | on the wire |
|---|---|---|
| 10 | `0.25  -0.0625  0.5  1.125` | `0.38888888888888884  -0.0625  0.22222222222222224  0.5` |
| 11 | `0.018726  0.21488  0.204172  0.544459` | `0.286100372279496  0.21488402061855671  0.09074312714776633  0.24198167239404356` |
| 12 | `0.773880  0.22519  0.180332  0.480885` | `0.6217246563573883  0.22519329896907223  0.08014747995418098  0.21372661321114927` |

And at 11:50:44 the *same* look on the *same* channel went out with its stored values verbatim —
the correct case. Same look, same channel, two different results: the only variable is which screen
was selected in the editor.

Feeding `resolveSceneLayerFill` an authoring canvas of 1920×1080 and a target of 6144×1536
reproduces those numbers **exactly** (`0.38888888888888884`, `0.22222222222222224`, `0.5`). Pinned
in the test.

## 3. What is NOT the cause

Recorded so this is not re-derived:

- **Not the server's fill math.** `mapProgramPixelRectToTargetOutput` did precisely the right thing
  with the inputs it was given. The dishonest input was the client's.
- **Not the transition/take code.** `scene-take-lbg-*` applies whatever fill it is handed.
- **Not `contentFit: 'native'`**, and not a missing media probe.
- **Not `composeCanvas: null` in the saved project.** The persisted value is irrelevant — the client
  stamps a fresh one onto every take payload.
- **Not the multi-screen fan-out.** One screen is enough; the fan-out only makes it obvious.

## 4. The fix

```js
const canvasIdx = Number.isInteger(seekOpts?.mainIdx) && seekOpts.mainIdx >= 0 ? seekOpts.mainIdx : sceneState.activeScreenIndex
const cv = sceneState.getCanvasForScreen(canvasIdx)
```

The authoring canvas is now the canvas of the screen the payload is **for**. `mapProgramPixelRect…`
becomes a no-op, and the stored fill lands verbatim — which is what the editor showed for that
screen.

**All three take/stage callers already pass the target `mainIdx`** (`scenes-preview-runtime.js:212`
and `:274`, `scenes-editor-support.js:180`), so nothing had to be threaded. The `activeScreenIndex`
fallback survives for the single caller with no target
(`scenes-editor-support.js:251`) — a local `applySceneFromTakePayload`, not a wire payload. A test
asserts every payload built with `seekOpts` names a `mainIdx`, so the fallback cannot quietly become
load-bearing.

## 5. What was VERIFIED

- `tools/smoke/smoke-wo531-authoring-canvas-follows-target.test.js` (5 tests, curated CI list):
  the real `resolveSceneLayerFill` reproduces the reported 4/9 shrink on all three of Look 1's
  layers and the exact wire numbers; authoring == target is a no-op; the same look on screen 1 is
  unaffected (which is *why* it was intermittent); and the client now keys off `mainIdx`.
- Suite **2214 / 2212 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit clean. Client builds.

## 6. Owner QA

Client-side change — rebuild + kiosk reload only, no server restart.

1. Select **screen 1** in the looks editor, then hit the main play button for **all** destinations.
   Screen 0's look must land at the size it shows in its own editor — no shrink.
2. Repeat with screen 0 selected. Both directions must now be identical.
3. ~~Worth knowing either way: a look has **no home screen** of its own.~~ **WRONG — superseded by
   [WO-532](./532_WO_LOOK_GEOMETRY_IS_PER_SCREEN.md) §0.** I checked `scene.mainIndex`, which does
   not exist; the field is `scene.mainScope` and every look in the project has a concrete one. The
   owner: *"looks are per screen always so they should act as this."* WO-532 makes geometry follow
   `mainScope` in the editor too, which is where the same fault was rewriting stored fills.

## 7. Work log

- 2026-08-14 (later) — First diagnosis withdrawn after the owner corrected the assignment reading
  (§0). Re-derived from the AMCP wire: `composeCanvas` was stamped from the editor's selected
  screen, so a cross-screen take remapped every layer by 4/9. Fixed, 5 smokes.
- 2026-08-14 — Initial (incorrect) diagnosis based on a misread of `liveSceneIdByMain`.
