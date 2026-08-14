# WO-531 — A look taken to a differently-shaped screen applies the wrong layer position and size

**Status: DIAGNOSED, NOT FIXED (14.08.2026). The mechanism is proven from the live project and live channel map (§2); the FIX is a design choice the owner must make (§4).**
**Priority:** High (on-air geometry; the owner hits it on the main play button)
**Source:** `work/work-orders/todos14.08.26` — *"when hitting the main play button to transition all selected screen destitionations, the transition not always correctly apply position and size of layers set in looks, like it gets it from somewhere else."* Restated 14.08: *"the main play button still applies wrong sizing on layers at least on ch1."*
**Related:** WO-238 (adjust fill ignores crop), WO-388 (crop counts into layer size), WO-327 (compose preview dest borders at custom res)

---

## 1. The two screens are not the same shape

From the running box (`GET /api/state`):

```
screenCount        2
programChannels    [1, 3]
programResolutions [ {w: 6144, h: 1536, fps: 50},    ← screen 0, ch1 — 4:1 mapped LED
                     {w: 1920, h: 1080, fps: 50} ]   ← screen 1, ch3 — 16:9
```

Not just different sizes — **different aspect ratios**, 4:1 against 16:9.

## 2. One look is live on both, and nothing records which canvas it was built for

`projects/test420.json`:

```
liveSceneIdByMain  ['63668cee…', '9c93ed10…', None, None]
previewSceneIdByMain ['1215909c…', '9c93ed10…', None, None]
```

**Look 3 (`9c93ed10`) is live on main 0 AND main 1** — the 6144×1536 screen and the 1920×1080 one.

Layer geometry is stored NORMALIZED, with no record of what it was normalized against. A real layer
from Look 1:

```json
"contentFit": "native",
"fill": { "x": 0.25, "y": -0.0625, "scaleX": 0.5, "scaleY": 1.125 }
```

`scaleY > 1` with a negative `y` is the signature of something fitted on the **4:1** canvas. Applied
verbatim to 1920×1080 it becomes 960 px wide and 1215 px tall — taller than the screen.

The field that exists to prevent this is `composeCanvas`, consumed by
`getProgramAuthoringResolution` (`src/engine/scene-native-fill.js:154`):

```js
const cc = incomingScene && incomingScene.composeCanvas
if (cc && cc.w > 0 && cc.h > 0) return { w: cc.w, h: cc.h }
…
const pr = cm?.programResolutions?.[screenIdx]          // ← falls back to the TARGET screen
if (pr?.w > 0 && pr?.h > 0) return { w: pr.w, h: pr.h }
```

and by `mapProgramPixelRectToTargetOutput` (`:131`), which contain-fits authoring → target and is
an explicit no-op when the two match.

**Every look in the live project has `composeCanvas: null`** (checked all 5). So the authoring
resolution always resolves to the *destination* screen, the two always "match", the mapping never
runs, and the stored fill is reinterpreted against whatever canvas it lands on.

That is the owner's sentence exactly:
- *"not always"* — correct on the screen the look was built on, wrong on the other.
- *"like it gets it from somewhere else"* — it takes the canvas from the destination, not the look.
- *"at least on ch1"* — ch1 is the 4:1 screen, the one furthest from any 16:9 authoring.

## 3. What is NOT the cause

Worth recording so the next session does not re-derive it:

- Not the transition code. `scene-take-lbg-*` applies whatever fill it is handed; the wrong number
  is produced upstream in `scene-native-fill.js`.
- Not `contentFit: "native"` itself. Native fit legitimately recomputes per channel from the media
  resolution; the operator's manual `fill` on top is what carries no canvas reference.
- Not the multi-screen fan-out. Taking the SAME look to one screen is equally wrong if that screen
  is not the one it was authored on — the fan-out just makes it visible in one action.

## 4. Why this is not fixed here — the owner has to choose

The mechanism is settled. The intended behaviour is not, and the two readings produce visibly
different output on air:

- **(A) Preserve the composition.** Stamp `composeCanvas` on save and let
  `mapProgramPixelRectToTargetOutput` contain-fit the whole arrangement into the target screen. A
  look built on 4:1 appears letterboxed on the 16:9 screen, with the layers' relationship to each
  other intact.
- **(B) Re-fit per screen.** Treat the stored fill as relative to whatever screen it plays on — the
  current behaviour — and accept that a cross-shape look needs per-screen adjustment. This is
  correct if the owner *wants* a look to fill each screen.

There is also a migration question either way: **existing looks carry no `composeCanvas`**, so a
stamp-on-save fix does nothing for the 5 looks already in the project until they are re-saved.
Options are to backfill from the screen a look is currently assigned to, to leave old looks on
today's behaviour, or to stamp on first load.

Guessing here would change what goes to air on a live box, so it is the owner's call. Once chosen,
the change is small — §2 names both functions.

## 5. What the owner can confirm cheaply

1. Take Look 3 to **screen 1 only** (1920×1080) and then to **screen 0 only** (6144×1536). If it is
   right on one and wrong on the other, §2 is confirmed end to end.
2. Re-save the look while the *wrong* screen is the active editor screen, then take it again. If
   the error moves to the other screen, the geometry is following the editor's canvas — which is
   the same finding from the other direction.

## 6. Work log

- 2026-08-14 — Diagnosed from the live channel map and the live project: two screens of different
  aspect (4:1 / 16:9), one look assigned to both, and `composeCanvas` null on every look so the
  authoring-canvas mapping never runs. Not fixed — the correct behaviour is an owner decision (§4).
