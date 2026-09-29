# WO-580 — Shader Live: speed changes without a phase jump + smooth (gliding) param changes

**Status: OPEN** (2026-09-25; diagnosed on the box during a live show — nothing implemented for
the real fix. Precursor wheel-apply fix IMPLEMENTED, see §2.1.)

Source: owner, `work/work-orders/todos25.09.26` (on show):
> why does scroll value changes does not register to output in shaders editor. only update after
> slider click. id also like the changes to happen smoothly and not abruptly.

Follow-up after the wheel fix: "the changes made with scroll do refresh to the shader that is
visible as a reload on screen."

Related: WO-345 (hot recompile via CG UPDATE), WO-348 (per-param revert), WO-356 (wheel),
WO-577 (key controls / speed macro).

## 1. Investigation

### 1.1 Wheel changes never reached the output (fixed, §2.1)
- `client/components/shader-live-editor.js:104-117` — the wheel handler stepped the range and
  dispatched only `input`. The apply path (`onControlChange` → `applyParamValues` → `pushLive` →
  `CG UPDATE`) listens on `change` only (`:119`); `input` just mirrors twin sliders (`:120`).
  The panel's macro sliders apply on `change` too (`shader-controls-panel.js:192-210`,
  "the apply itself waits for `change`"). A later click fired `change` → the scrolled value landed
  all at once.

### 1.2 The "reload" on screen is a phase jump, not a reload
Journal (`run.sh` CasparCG log, 2026-09-25 22:52–22:53, ch1-10): every wheel apply was
`CG 1-10 UPDATE 0 "{passes:{image:{source:…}}}"` → `202 CG OK`. **No `CG … ADD`** — the 403
re-host fallback in `pushLive` (`shader-live-editor.js` ~`:280`) never fired. The player's
`window.update` → `applyLiveSourceUpdate` (`template/shaders/player.js:49-65, 433-449`) swaps the
program in place; `ShaderToyLite` `setShader` → `compileProgram` keeps canvas, buffers and iTime.

What the operator actually scrolled was the WO-577 **speed macro**. Successive pushes:
```
t*0.1   → t*0.095 → t*0.09 → t*0.085        (t = iTime*2. + …)
iTime*0.5 → iTime*0.475 → iTime*0.45 → iTime*0.425
```
Params are baked **literals** in GLSL, multiplied by an ever-growing `iTime`. Animation phase ≈
`iTime × k`, so after 1200 s on air a 0.5→0.475 step moves the phase by ~30 s of animation in one
frame: the whole picture teleports = reads as a restart. The jump grows with time-on-air. Non-time
params (e.g. `pow(0.288+…)` → `0.387` in the same shader) change without teleporting.

### 1.3 Why changes are abrupt
Each apply is a full-source recompile to a new constant; there is no interpolation anywhere.
Every step is also a synchronous GLSL compile in CEF (a heavy shader can hitch a frame), so
"tween by sending many CG UPDATEs" is only a stopgap (the WO-356 wiggle does 8×150 ms this way).

## 2. What was done

### 2.1 Precursor (2026-09-25, during the show, owner-approved)
`shader-live-editor.js` wheel handler now also dispatches `change`, debounced 150 ms per slider
(`t._wheelApply`), so a wheel burst = ONE push/recompile. `npm run build:client` ran clean; the
kiosk was NOT reloaded by the agent (owner's call). Not committed.
Side effect of building mid-show: lazy chunks renamed (`playlist-live-sync-*`, `device-view-*`,
`scenes-*`) — an un-reloaded page 404s on those until F5.

### 2.2 Real fix — TO DO (proposed approach)
1. **Params → uniforms.** At export (`src/shaderfx/shader-template-export.js`) / hot-update time,
   rewrite each controllable literal to a uniform (`u_p<N>`) with its value, instead of baking the
   number. `ShaderToyLite` needs a hook to set extra uniforms per program (vendored + patched
   already, see WO-266 patch notes).
2. **Value updates no longer recompile.** New `CG UPDATE` shape `{ params: { u_p3: [0.475] } }`
   → `player.js` sets targets; the render loop eases current → target (critically damped /
   exponential, ~300–400 ms, configurable) every frame. Source updates stay for structural edits.
3. **Phase-continuous speed.** For literals the scanner classes as time multipliers (`iTime * k`,
   the WO-577 speed macro keys), don't feed `iTime*k`; feed an accumulated phase uniform:
   `phase += dt * k_current` each frame, and substitute `iTime*k` → `u_phase<N>`. Changing speed
   then changes the *rate*, never the position — no teleport, and the eased `k` makes speed ramps
   smooth for free.
4. Editor: wheel/drag push on `input` (throttled, e.g. 1 per 50 ms) once updates are cheap —
   live-while-dragging, not only on release.
5. Save/persist still writes the literal values back into the source (the file stays a plain
   ShaderToy shader), so export/thumbnail/import paths are unchanged.

Risks: rewrite must not touch literals inside `#define`/`const` initialisers that need
compile-time constants (array sizes, loop bounds — GLSL ES loop bounds must be constant);
the scanner's `intLiteral` / structural filters (WO-577) must gate which literals become uniforms.

## 3. What was verified
- §1.1/§1.2 from source reading + the journal lines above (read-only on the live box).
- §2.1: build clean, `_wheelApply` present in `dist-web/assets/main-*.js`. Owner confirmed after
  kiosk reload that wheel changes now reach the output (then reported the §1.2 jump).
- §2.2: nothing — OPEN.
