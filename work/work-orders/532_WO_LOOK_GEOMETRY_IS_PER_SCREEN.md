# WO-532 — A look's geometry followed the selected screen, not the look's own screen

**Status: FIXED in repo (14.08.2026) — 7 smokes, suite 2222 / 2220 pass / 0 fail / 2 skip. Owner QA owed (§6).**
**Priority:** High (silently rewrites stored look geometry)
**Source:** owner 14.08, after WO-531: *"looks are per screen always so they should act as this."*
**Related:** [WO-531](./531_WO_LOOK_FILL_WRONG_ON_DIFFERENT_SHAPED_SCREEN.md) (the take payload — the same
principle at wire time), WO-388B (visible-rect reporting), WO-326 (fill live-apply), WO-158

---

## 0. What the owner corrected

WO-531 §6.3 closed with *"a look has **no home screen** of its own — it is normalized to whatever
screen it plays on."* That was wrong, and it was wrong in a way worth recording: I checked
`scene.mainIndex`, a field that does not exist. The field is **`scene.mainScope`**, and every look
in the live project has a concrete one:

```
projects/test420.json →  Look 1 '0'   Look 2 '1'   Look 3 '1'   Look 4 '0'   Look 5 '0'
```

`'0'` / `'1'` / … name a screen; `'all'` means the look is screen-agnostic. So a look does have a
home, the deck already shows looks only in their own screen's column
(`sceneState.getScenesForMain`), and the owner's sentence is not a feature request — it is a
statement of how the data model already works. Geometry was the one subsystem ignoring it.

## 1. Routing already honoured `mainScope`. Geometry did not.

`client/lib/look-stack-amcp-channel.js`:

```js
export function resolveMainIndexForScene(scene, sceneState, overrideMainIdx) { … }
```

Twelve call sites use it — AMCP channel selection, countdowns, PiP overlays, lower thirds, layer
playlists, the global preview take. Those all get the right screen.

The fill ⇄ pixel geometry path did not. It resolved its canvas from the editor selection:

| site | what it did |
|---|---|
| `inspector-scene-layer.js:42` | `getCanvasForScreen(sceneState.activeScreenIndex)` — the X/Y/W/H boxes, and the canvas `patchFillPx` writes back through |
| `inspector-scene-layer.js:41` | `getResolutionForScreen(stateStore)` — active-screen-only by construction |
| `inspector-scene-layer.js:141,206` | content resolution + effect/crop pixel space |
| `inspector-fill.js:111` | `syncGeometryInputsFromLayer` |
| `inspector-fill.js:128,132` | `reapplyLayerFrameForContentFit` — **the destructive one** |
| `inspector-fill.js:227` | Scale % |

## 2. Two consequences, one of them permanent

Screen 0 here is 6144×1536 (4:1); screen 1 is 1920×1080. The canvases disagree violently, so the
symptom is loud.

**READ.** Look 1 (`mainScope: '0'`) layer 10 stores `fill {0.25, −0.0625, 0.5, 1.125}`. Against its
own screen that is `3072×1728 @ (1536, −96)`. Against screen 1's canvas the inspector reported
`960×1215 @ (480, −67.5)`. Same look, different numbers, decided by which pill was lit.

**WRITE.** Content-fit is where it stops being cosmetic. `native` means *1:1, centred*:

```
own canvas   6144×1536 ← media 1920×1080  →  rect (2112,228,1920,1080)  → fill {0.34375, 0.1484, 0.3125, 0.7031}
wrong canvas 1920×1080 ← media 1920×1080  →  rect (   0,  0,1920,1080)  → fill {0,      0,      1,      1     }
```

With the wrong canvas selected, "fit natively" **stores a full-bleed fill** — the clip is then
stretched across the whole 4:1 LED wall, and the stored value is corrupt from then on. Unlike
WO-531 (a take-time remap of correct data) this rewrites the project.

The Scale % control has the same shape of fault: it reads the visible rect in the wrong pixel space,
so 110 % on a screen-0 look measured on screen 1's canvas is not 110 % of anything real.

## 3. The fix — reuse the resolver that already exists

The temptation was a second helper on `sceneState` (`sceneMainIndex`/`getCanvasForScene`). That was
written and then **withdrawn**: two resolvers for "which screen is this look on" is exactly the
condition that produced this bug, and the next session would have had to guess which one is
authoritative. All six sites now call `resolveMainIndexForScene(scene, sceneState)`:

```js
const sceneMain = resolveMainIndexForScene(scene, sceneState)
const res = getResolutionForScreen(stateStore, sceneMain)
const canvas = sceneState.getCanvasForScreen(sceneMain)
```

`getResolutionForScreen(stateStore, screenIdx)` gained an **optional** screen argument — a caller
that knows which screen it is describing passes it; `inspector-global-border-slices.js`, which
describes the selection itself, is unchanged.

`buildIncomingScenePayload` (WO-531's site) now feeds its `canvasIdx` in as the *override*:

```js
const cv = sceneState.getCanvasForScreen(resolveMainIndexForScene(scene, sceneState, canvasIdx))
```

For a scoped look the override and the scope are the same screen — the deck only offers a look in
its own column — so this is WO-531's guarantee unchanged. For an `'all'` look, WO-531's rule stands:
the target screen, else the selection. Nothing regressed; the fallback simply got a better first
choice.

No import cycle: `look-stack-amcp-channel.js` imports only `scenes-preview-look-stack.js`, which
imports nothing.

## 4. What is NOT the cause

- **Not `getCanvasForScreen` / `_getCanvas`.** They answer exactly what they are asked.
- **Not the fill math.** `fillToPixelRect` / `pixelRectToFill` round-trip cleanly on any canvas —
  which is *why* a pure read-and-write-back looked stable and this hid for so long. Only the paths
  that synthesise a rect from the canvas (content-fit, Scale %) leak the wrong canvas into storage.
- **Not `mainScope` handling.** It was correct and unused here.

## 5. What was VERIFIED

- `tools/smoke/smoke-wo532-look-geometry-follows-its-screen.test.js` — 7 tests, curated CI list:
  `mainScope` outranks the selection and only `'all'` falls back; the real `fillToPixelRect`
  reproduces the 3072×1728 vs 960×1215 read discrepancy; the real content-fit math reproduces the
  `{0,0,1,1}` full-bleed write; and the three geometry files no longer contain
  `getCanvasForScreen(sceneState.activeScreenIndex)` or an active-screen `getContentResolution`.
- WO-531's source assertion **repointed, not weakened** — it now pins the stronger
  `resolveMainIndexForScene(scene, sceneState, canvasIdx)` form, with the reason inline.
- Suite **2222 / 2220 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit 0 over. Client builds.

## 6. Owner QA

Client-only — rebuild + kiosk reload, no server restart.

1. Select **screen 1**. Open a **screen 0** look, click a layer: the X/Y/W/H boxes must read the
   same numbers they read with screen 0 selected. Before, they were off by the canvas ratio.
2. With the *wrong* screen selected, set a layer's content fit to **Native**. The layer must land
   1:1 centred on its own screen — not full-bleed. This is the one that was corrupting the project.
3. Scale % with either screen selected must give the same result.

## 7. Work log

- 2026-08-14 — Owner's *"looks are per screen always"* traced to geometry being the last subsystem
  reading `activeScreenIndex` instead of `mainScope`. Six sites repointed onto the existing
  `resolveMainIndexForScene`; a duplicate resolver was written and deliberately withdrawn. 7 smokes.
  WO-531 §6.3's "no home screen" note is superseded by §0 here.
