# WO-322 — Shaders dropped into a look must composite on the media band, not the 700+ CG overlay

> **VERIFICATION 2026-07-24 — NOT IMPLEMENTED. The todos22 progress note claiming
> "✅ IMPLEMENTED + APPLIED LIVE 2026-07-22 (node restarted)" is FALSE.** An independent
> source audit found ZERO shader-aware code in `src/engine/` (grep "shader" → 0 hits):
> `cg-routing.js` still maps `shaders/sh-<id>` to the 700+ band via `isSceneTemplateCgName`,
> the pipeline still calls `buildSceneTemplateCgAmcpLines` with the logical layer + cgFade,
> no teardown CG CLEAR, no scene-take-lbg exclusion, no routing test. No matching commit
> and no uncommitted diff exists; same-day commits da11fc0/7f6064f still describe shaders
> as "on a fixed 700+ overlay host layer". Either the work was never applied or it was
> wiped by a later git operation before being committed. **This WO is fully OPEN — the
> implementation plan below remains valid and unexecuted.**

**Source:** todos22.07.26 — "the shaders that are dropped into a look cant play on 700 cg layers as
that makes them imposible to compose (put layers on top). they need to play on the same layers as
standard media. not sure with the lower thirds, will have to test."

## Problem
A shader dropped into a look lands on the always-on-top 700+ template-CG overlay band, so no
media/graphics look layer (≤199) can ever sit on top of it. The owner wants shaders to composite by
layer order like standard media. Lower thirds must keep their current on-top behaviour (owner is
unsure and will test — this WO must NOT change lower-third routing).

## Root cause
A shader is not special in the engine — `saveShader` exports every shader as an ordinary Caspar
template at `template/shaders/<id>.html`, Caspar path `shaders/<id>`
(`src/shaderfx/shader-store.js:121,148-154`; the comment at `:5-7` says shaders "play through every
existing template path … no new play plumbing"). So a shader dropped into a look becomes a look
layer whose source is the template name `shaders/sh-<id>`, and the take pipeline classifies it as
**template CG**, not media:

- `isSceneTemplateLayer` is true (shader is in Caspar's TLS/template list) —
  `src/engine/scene-template-cg.js:37-41`, `src/state/playback-tracker-media.js:25-37` → it goes CG
  ADD, not media LOADBG/PLAY (`scene-take-lbg-jobs.js:115,353`;
  `scene-take-lbg-amcp-pipeline.js:435-469`).
- Host layer comes from `resolveTemplateCgHostLayer(layerNumber, 'shaders/sh-…')`
  (`scene-template-cg.js:125,234`).
- In `src/engine/cg-routing.js:23-35`, line 27 sets
  `useOverlay = !cgName || isLowerThirdCgName(cgName) || isSceneTemplateCgName(cgName)`.
  `isSceneTemplateCgName('shaders/sh-…')` is **true because the name contains `/`**
  (`cg-routing.js:40-45`), so `useOverlay` is true and lines 29-32 remap the logical look layer
  (10–199) to `700 + offset` (`TEMPLATE_CG_OVERLAY_LAYER_BASE = 700`, `:7`).

Net: the shader's CG ADD lands on physical layer 700–899, unconditionally above the entire media/
look band. That is exactly the "impossible to put layers on top" complaint.

## Ground truth to read first
- `src/engine/cg-routing.js:23-45` — the routing decision (`useOverlay`, name classifiers). Line 27
  is the hook; line 28 already returns the look-band layer `n` when `useOverlay` is false.
- `src/engine/scene-template-cg.js:37-41,122-151,216-338` — CG classification, host-layer resolve,
  CG ADD/UPDATE/CLEAR emit, tracked-host continuity lifecycle.
- `src/engine/look-layer-ranges.js:9-22` — media/look band (`LOOK_LAYER_MIN=10`,
  `LOOK_LAYER_MAX=99`, `PGM_BANK_B_OFFSET=100` → 110–199).
- `src/engine/scene-transition.js:20-23` — `physicalProgramLayer(sceneLayerNum, bank)` = `N` (bank A)
  or `N+100` (bank B); how media rides the two-bank crossfade
  (`scene-take-lbg.js:72-82`, `scene-take-lbg-playlist.js:116`, `scene-exit-layers.js:82`).
- `src/engine/template-cg-orphan-sweep.js:45-53` — the 700–789/700–899 orphan sweep.
- `src/shaderfx/shader-store.js:121,148-154` + `src/shaderfx/shader-template-export.js` — shaders are
  identifiable by the **`shaders/` casparPath prefix** (`template/shaders/` output dir) — the clean
  discriminator to branch on.

## Compositing model (why this is the whole issue)
Caspar composites strictly by physical layer number per channel — higher = on top. Media look layers
stack by their `layerNumber` (10–199). Template CG at 700+ is unconditionally above the look band
(`cg-routing.js:6` comment). So nothing in the look band can exceed a 700+ host — that is why you
cannot put a layer on top of a shader.

## Fix direction
Branch shaders off the overlay path in `cg-routing.js:27` on the `shaders/` prefix so
`resolveTemplateCgHostLayer` returns the shader's **look-band physical layer** (`n`, bank-mapped)
instead of a 700+ host. The one-line routing change is the easy part. **The real cost is the
transition/teardown coupling:** once on the look band, a shader must ride the same lifecycle as media
— bank A/B physical layer selection (`physicalProgramLayer`), bank-swap survival, and look-layer
teardown/orphan clears (`scene-exit-layers.js`) — otherwise it will survive a bank swap or be left as
an orphan on transitions. Shaders leaving the 700 band also drop out of the 700–899 orphan sweep and
the tracked-host continuity system, so their cleanup must move to the look-layer teardown path.
Because shaders are CG producers (not media clips), decide whether they get full media-style
transition handling or a simpler cut-in/cut-out on the look layer (see Ambiguities).

## Constraints — MUST preserve (why 700+ exists)
- **Lower thirds and generic template CG stay on 700+.** The overlay band keeps CG above the media
  crossfade so lower thirds/timers aren't dragged into the bank A/B opacity mix
  (`scene-template-cg.js:116-119`; teardown fade `scene-take-lbg-teardown.js:71-89`), and
  continuity/UPDATE-only takes rely on a fixed host so running timers survive a look take
  (`scene-template-cg.js:216-238`, WO-196). **Do NOT touch `isLowerThirdCgName` routing**
  (`cg-routing.js:13-15,27`). Scope is shaders only.
- **Reconnect/orphan reconciliation** sweeps 700–899 (`template-cg-orphan-sweep.js:45-53`). If
  shaders leave that band they need a parallel cleanup on the look-layer teardown path.
- LIVE box: takes render on air. Keep behaviour for looks WITHOUT shaders bit-for-bit identical;
  guard the new path behind the `shaders/` prefix so only shader layers change placement.

## Acceptance
- A shader dropped into a look renders on its look-band layer; a media/graphics look layer with a
  higher layer number composites **on top of** the shader on the output.
- Lower thirds and other template CG still route to 700+ and still sit above media (verify a
  timer/lower-third survives a look take unchanged — continuity intact).
- Take/transition on a look containing a shader: no orphaned shader host after a bank swap or look
  exit (no leftover on 700–899 and none stuck on the look band).
- `npm run test:ci` → 0 fail; add a non-vacuous routing test asserting `resolveTemplateCgHostLayer`
  returns the look-band layer for a `shaders/…` name and still returns 700+ for lower-third / other
  template-CG names. No new eslint warnings.

## Ambiguities for the owner
1. **Blanket vs per-layer:** should ALL look-dropped shaders composite in the media band, or only
   when the operator marks a shader as "under" other layers? A full-screen FX shader might still want
   to be on top — consider a per-layer property rather than a blanket rule.
2. **Lower thirds:** confirm they stay on 700+ (they should — they need to be above media). This WO
   changes only the shader path.
3. **Transition handling for shaders on the look band:** full media-style bank A/B crossfade +
   orphan clears, or a simpler cut-in/cut-out on the look layer? Shaders are CG producers, not clips.
4. **Cleanup path:** confirm shader host layers should be cleaned up by look-layer teardown
   (`scene-exit-layers.js`) once they leave the 700–899 sweep.

---

## IMPLEMENTATION PLAN (refined 2026-07-22) — owner decision: move ALL look-dropped shaders

Owner decided (todos22.07.26): move ALL look-dropped shaders to the standard media band (not
per-layer). Detailed take/teardown mapping done; live tree NOT changed — see the BLOCKER below.

Change set (file:line):
- **(a) Routing** `src/engine/cg-routing.js` — add `isShaderCgName` (`shaders/` prefix); in
  `resolveTemplateCgHostLayer` make `useOverlay =
  !cgName || ((isLowerThirdCgName || isSceneTemplateCgName) && !isShaderCgName)`. Shaders → return
  logical `n`; lower-thirds/generic CG unchanged (verified: only shaders change).
- **(b) Bank-map at the take call sites** — a shader must land on `job.pLayer` (bank-mapped physical
  layer), NOT logical `n`. `job.pLayer` exists on templateCg jobs (`scene-take-lbg-jobs.js:341`).
  - `scene-take-lbg-amcp-pipeline.js:428-485`: shader branch — skip the continuity/UPDATE-only path,
    call `buildSceneTemplateCgAmcpLines(channel, job.pLayer, job.templateCg, {})` (**no `cgFade`** —
    the job's own `mixerLines` OPACITY, sent in the crossfade batch at `:200/:255`, owns the fade; a
    second CG-level opacity ramp would double it), no `recordTemplateHostAdded`.
  - `scene-take-pgm-only.js:341`: shader jobs pass `job.pLayer`.
  - `scene-template-cg.js:132`: guard `recordTemplateHostAdded` to `hostLayer >= 700` so a shader's
    look-band layer never pollutes the tracked-host set.
- **(c) Teardown (prevents the on-air GHOST)** `scene-take-lbg-teardown.js` —
  - `:110, :122, :138`: prepend `CG <cl> CLEAR` to the physical exit `STOP`/`MIXER CLEAR` lines
    (harmless no-op on a media layer; removes an exiting shader's CG producer on the correct
    bank-mapped layer). WITHOUT this a replaced/removed shader stays as a full-opacity ghost on the
    inactive bank (MIXER CLEAR resets opacity to 1) — see original §(e).
  - `:80, :156`: `continue` for shader layers so they are handled ONLY by the physical exit path,
    not the 700+ template loops (which resolve the shader to logical `n`, not its bank layer).
  - `scene-take-lbg.js:366-374`: exclude shaders from `incomingTemplateHostLayers` (keep it 700+-only).
- Orphan sweep needs no change (look-band orphan machinery in `scene-exit-layers.js:47-52,160-206`
  already covers `template`/`cg` layers).

### BLOCKER — needs an on-box maintenance window before shipping
This moves a **CG/HTML producer** through the media **bank A/B crossfade** for the first time (media
uses LOADBG/PLAY, not CG ADD). Whether Caspar applies the DEFERred bank-crossfade opacity ramp to a
CG producer added mid-batch the SAME way it does a media producer is unverified and cannot be tested
without triggering takes on a live program channel. If it doesn't, the result is exactly the
"not a smooth mix" artifact or a ghost. Implement + verify visually on-box (take a look with a shader
over another look, both directions, and a bank crossfade), with the owner ready to roll back, BEFORE
relying on it in a show. The routing primitive alone is UNSAFE (mis-places shaders on a bank-B take +
orphans), so ship (a)+(b)+(c) together or not at all.
