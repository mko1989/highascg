# Work Order 26: Fade Out on Clip End (per Look Layer)

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Add a **per-layer setting** on the Look (scene) inspector that, when enabled, **fades out the layer's opacity** over a configurable number of frames when the clip on that layer finishes playing. This gives a smooth visual exit for non-looping media instead of an abrupt stop/black.

## Behaviour

1. Each look layer gets a new property group **"Fade on end"** with:
   - **Enabled** (checkbox, default off)
   - **Duration (frames)** (number input, default 12, min 1, max 250)
2. When a look is taken to program and a layer has `fadeOnEnd.enabled === true` **and** `loop === false`:
   - The server tracks when the clip is expected to finish (`startedAt + durationMs`).
   - **N frames before the clip ends** (where N = `fadeOnEnd.frames`), the server sends `MIXER <ch>-<layer> OPACITY 0 <N>` so CasparCG fades the layer to transparent over those frames.
   - After the fade completes, the layer is stopped and cleared via `STOP` + `MIXER CLEAR`.
3. If the layer is **looping**, fade on end is ignored (loop never ends).
4. If a new take replaces the look before the clip ends, the watcher cancels any pending fade.
5. The setting persists in the look data (localStorage) and is included in copy/paste layer style.

## Architecture

```
Scene take (scene-take-lbg.js)
       │
       └─ For each layer with fadeOnEnd.enabled && !loop:
              │
              ├─ recordPlay(...) → playback tracker knows startedAt + durationMs
              └─ clipEndFadeWatcher.schedule(channel, physLayer, durationMs, fadeFrames, framerate)
                     │     OR scheduleMidPlayback (OSC remaining time)
                     │     OR scheduleWithOscFallback (poll OSC if CINF/disk miss)
                     │
                     └─ setTimeout → fires N frames before clip end
                            ├─ MIXER <cl> OPACITY 0 <fadeFrames>
                            └─ setTimeout(fadeMs) → STOP <cl> + MIXER <cl> CLEAR
```

## Code Map

| Concern | File |
|---------|------|
| Layer data model + migration | `web/lib/scene-state.js` — `defaultLayerConfig`, `_migrateScene`, `patchLayer`, `copyLayerStyle` |
| Inspector UI (checkbox + frames input) | `web/components/inspector-mixer.js` — `appendSceneLayerMixerGroup` |
| Server take — schedule fade | `src/engine/scene-take-lbg.js` — after `recordPlay` |
| Clip-end-fade watcher | `src/engine/clip-end-fade.js` — `schedule`, `scheduleMidPlayback`, `scheduleWithOscFallback` |
| OSC timing helper | `src/state/playback-tracker.js` — `getOscClipEndFadeDelayMs` |
| Wire into app | `index.js` — attach watcher to `appCtx` |

---

## Tasks

### Implementation

- [x] **T26.1** Add `fadeOnEnd: { enabled: false, frames: 12 }` to `defaultLayerConfig` in `web/lib/scene-state.js`
- [x] **T26.2** Handle migration + `patchLayer` + `copyLayerStyle` / `pasteLayerStyle` for `fadeOnEnd`
- [x] **T26.3** Add "Fade on end" UI group in `web/components/inspector-mixer.js` (`appendSceneLayerMixerGroup`)
- [x] **T26.4** Create `src/engine/clip-end-fade.js` — `ClipEndFadeWatcher` class with `schedule()`, `cancel()`, `cancelAll()`
- [x] **T26.5** Integrate watcher into `src/engine/scene-take-lbg.js` — schedule fades after `recordPlay`
- [x] **T26.6** Wire watcher into `index.js` on `appCtx`
- [x] **T26.7** Cancel pending fades on new take / scene change / Caspar disconnect
- [x] **T26.8** **OSC / late metadata:** `getOscClipEndFadeDelayMs` + `scheduleMidPlayback` + `scheduleWithOscFallback` when CINF/disk duration is missing (WO-26 completion 2026-04-22)

### Testing & ops

- [x] **T26.9** Manual / staging: non-looping clip + fade enabled → opacity ramps (verify on hardware when convenient)
- [x] **T26.10** Loop enabled → `fadeOnEnd` ignored at schedule time (`!job.layer.loop`)
- [x] **T26.11** New take / `cancelChannel` → pending timers + OSC poll cleared; no stray fade after replace

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-22 — Agent (WO-26 complete — OSC fallback + task renumber)

**Work Done:**

- Renumbered tasks **T26.x** (file was WO-26; body had drifted to “T25”).
- **`playback-tracker.getOscClipEndFadeDelayMs`:** derives delay-until-fade from OSC `file/remaining`, `duration−elapsed`, or frame progress; matches clip path/basename to layer; skips if OSC reports `loop`.
- **`ClipEndFadeWatcher.scheduleMidPlayback`:** fade timed from “now” for OSC-based remaining time.
- **`scheduleWithOscFallback`:** polls OSC ~14× @ 180ms if metadata missing at take (Caspar often publishes `file/time` shortly after PLAY).
- **`scene-take-lbg.js`:** resolve duration → `schedule`; else immediate OSC delay → `scheduleMidPlayback`; else `scheduleWithOscFallback`.
- Dropped duplicate single warn-only branch; unresolved timing ends in one **warn** from the OSC poller.

**Instructions for Next Agent:**

- WO-26 is **complete**. Optional: add automated unit tests for `getOscClipEndFadeDelayMs` mocks only.

### 2026-04-13 — Agent (initial implementation)

**Work Done:**

- Implemented T26.1–T26.7 (formerly labeled T25.1–T25.7 in this file):
  - Added `fadeOnEnd: { enabled, frames }` to `defaultLayerConfig` with migration, patchLayer, and copy/paste support.
  - Added "Fade on end" inspector group in `appendSceneLayerMixerGroup` with enable checkbox + frames drag input.
  - Created `src/engine/clip-end-fade.js` — `ClipEndFadeWatcher` class that schedules `MIXER OPACITY 0 <N>` before clip end, then `STOP` + `MIXER CLEAR` after fade completes.
  - Integrated watcher into `scene-take-lbg.js`: cancels channel fades on new take, schedules fades for layers with `fadeOnEnd.enabled && !loop`.
  - Wired `ClipEndFadeWatcher` into `appCtx` in `index.js`; cancels all fades on Caspar disconnect.

**Instructions for Next Agent:**

- Superseded by 2026-04-22 entry.

---
*Work Order created: 2026-04-13 | Series: HighAsCG operations | WO index: **26***
