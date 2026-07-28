# WO-344 — better look-deck thumbnails for shader looks (crop the content, kill the alpha void)

**Source:** owner 2026-07-26 — "better thumbnail capture system for shaders as in most cases it
shows some borders and a lot of alpha empty space ... in the looks list in looks buttons."

**Status: DONE (28.07.26) — the status line was STALE: the content-crop half shipped in `465d071`
on 27.07. Running the pipeline on the box then exposed a bigger defect the WO had not seen — some
shader looks produced NO thumbnail at all — which is fixed and proven. One sub-item (synthetic
audio) is implemented but could not be proven on this box; §5 says exactly why.**

## Problem
Look-deck button thumbnails for shader/template layers capture the raw template snapshot: mostly
transparent canvas with a small rendered region → the deck button shows borders + empty space.

## 1. State when this WO was re-opened (28.07)

The WO listed four fix directions. Two were already done and the status line never said so — the
same stale-status pattern the 26.07 audit caught on WO-342 and WO-345:

| # | Fix direction | State found 28.07 |
|---|---------------|-------------------|
| 1 | locate the pipeline | — |
| 2 | real 16:9 viewport, wait for a non-empty frame, **content-aware crop**, synthetic audio | **crop shipped** in `465d071` (`contentCropPng`, ffmpeg `cropdetect`, 4% pad, ≥85% coverage passes through). Synthetic audio **not** done. |
| 3 | composite per-layer thumbs with the layer's FILL rect | **already implemented** — `cg-only-look-deck-thumb.js:158-161` uses `fillToPixelRect`, as does `preview-canvas-draw-stacks.js:87-89`. The WO's own "check whether the deck painter already composites fills" answers yes. |
| 4 | cache-bust only on shader save | **not done, and broken** — see §2b. |

## 2. What was found by RUNNING it (not reading it)

### 2a. Some shader looks could never produce a thumbnail

`POST /api/cg-thumb/render {sourceValue: 'shaders/sh-audio'}` failed **every time**:

```
{"error":"CDP command timeout: Page.captureScreenshot"}
{"error":"CDP command timeout: Runtime.evaluate"}
```

Root cause: `CDP_COMMAND_TIMEOUT_MS = 5000` in `src/system/cef-cdp-client.js` applied to **every**
command. That is the right budget for input/DOM calls, but headless Chrome has no GPU — shaders
rasterise through SwiftShader — and `sh-audio` is a fullscreen raymarcher (100 march steps plus two
shadow marches per pixel) at 1920×1080. It cannot be screenshotted in 5 s, so the deck button for
that look was permanently empty. This is a strictly worse version of the reported symptom and the
WO did not know about it.

### 2b. Re-saving a shader kept serving the old picture

`hashCgThumbRequest()` built the cache key from the request only — `templateId`, `sourceValue`,
`cgData`, `width`, `height`. Editing a shader in Shader Live rewrites
`template/shaders/sh-*.html` and changes **none** of them, so the key was identical and the cached
PNG was returned forever. Acceptance criterion "thumb refresh on shader re-save" could not hold.

## 3. What was changed

1. **Per-command CDP timeout override.** `session.send(method, params, { timeoutMs })` in
   `cef-cdp-client.js`; `openPage(..., { commandTimeoutMs })` and `page.screenshot({ timeoutMs })`
   in `headless-chrome-cdp.js`. Absent → the 5 s default, so every existing caller is untouched.
2. **Shader thumbs render smaller and are given time.** 960×540 (16:9, 4× fewer pixels, still
   above the 640×360 deck button so nothing is upscaled) with a 25 s budget — shader requests only.
3. **Cache key includes the template file's fingerprint** (`mtimeMs:size`, resolved lazily so the
   cache module keeps not depending on the renderer; any failure falls back to the old key).
4. **`?shaderThumb=1`** on the thumbnail navigation URL. In `template/shaders/player.js` it
   synthesizes a plausible static spectrum **only when no fresh real `audio_fft` frame exists**
   (real audio still wins — the priority order WO-333/WO-335 established is untouched), and skips
   `initTierA()` (getUserMedia has no capture device headless and only delays first paint).
   Playout never passes the flag; the exporter does not know about it.

## 4. What was VERIFIED

- **The dead thumbnail is alive.** `sh-audio`, which failed on every attempt before, renders in
  **10.6 s** through the new path (960×540, 328 KB PNG) — viewed, and it is a full frame of
  content, not an alpha void. `sh-matrix` still renders (4.4 s) and is unchanged in character.
  Run through `renderCgLookThumbPng` directly, in a standalone node process, so the live service
  was not restarted to test it.
- **The cache busts on re-save, and only then:** same request hashed twice → identical; after
  touching the shader's mtime → different key; an unresolvable template still returns a valid
  32-char hash (best-effort fingerprint, no throw). Non-shader templates hash as before.
- **`sh-matrix` full-frame passes the crop untouched** (coverage ≥85% short-circuit) — the crop
  only fires where there is void to remove, which was the WO-344 v1 design.
- New smoke `tools/smoke/smoke-wo344-shader-thumbs.test.js` (5 tests) in the curated FILES list:
  the timeout override plus its default, the 16:9 shader viewport bounds, cache-bust on file
  change, best-effort fingerprint, and that thumbnail audio mode is opt-in and never outranks real
  audio.
- **Repointed, not weakened:** `smoke-wo333-audio-capture-fft.test.js:158` pinned the exact source
  line `initTierB()\n void initTierA()`, which this WO changed. The assertion now matches the new
  line **and** additionally asserts tier B never becomes conditional. (CLAUDE.md: smokes grep
  source text; refactors repoint them.)
- **Full suite: 1615 tests, 1613 pass / 0 fail / 2 skip.** Lint 0, prettier clean, unwired-export
  gate clean, 500-line gate clean.

## 5. What was NOT proven — the synthetic spectrum

Implemented, low-risk (opt-in flag, only fills when no real frame is fresh), but **not
demonstrated on this box**, and two attempts to demonstrate it are recorded here so the next
session does not repeat them:

1. Counting audio-coloured LED pixels in `sh-audio`: the lit matrices in that shader are the
   `iTime`-driven plasma/kaosspad panels, not the `iChannel0` meter branch. The probe returned 0
   for every frame — it does not separate the conditions.
2. Non-black pixel count on `sh-fft-test`, thumb mode vs plain, twice each: 145k/94k (thumb) vs
   161k/213k (plain). **The spread within one condition is larger than the difference between
   conditions** — the shader animates and a live `audio_fft` feed is flowing on this box, which
   legitimately outranks the synthetic spectrum by design. Nothing can be concluded from it.

Per the box's own rule that a pixel probe must be calibrated to separate good from bad before it
is trusted, no claim is made. To settle it: render with the WS feed stopped (nothing on air), or
assert the texture bytes in-page rather than by pixels.

## 6. Acceptance

Shader looks in the deck show a filled, content-centered thumb (no dominant transparency); media
look thumbs unchanged; thumb refresh on shader re-save; no per-render cost on the deck paint path.

- Content-centered: crop shipped `465d071`, verified full-frame shaders pass through untouched.
- **Every** shader look now gets a thumb at all (§2a) — the strictest failure of "no dominant
  transparency" was an empty button.
- Media look thumbs unchanged: all new behaviour is behind `isShaderThumbReq(req)`.
- Refresh on re-save: fixed and proven (§2b, §4).
- No deck-paint cost: all of it is server-side render/cache; the painter is untouched.

**SERVER change — needs a highascg restart** before the running service uses any of it.
**Owner QA owed:** open the looks deck and confirm the shader buttons look right, especially any
that were blank before.
