# AMCP pipeline revision

Revision date: **2026-05-19**  
Scope: every **multi-step AMCP sequence** (pipeline) in HighAsCG — ordered command stacks as actually sent to CasparCG.

Use this file to audit, diff, or refactor take/preview paths without reading the whole codebase.

---

## How commands reach Caspar

| Mechanism | Implementation | Notes |
|-----------|----------------|-------|
| **Single command** | `amcp._send(line)` via `loadbg`, `play`, `mixerOpacity`, `raw`, etc. | LOADBG/PLAY are **never** wrapped in BEGIN…COMMIT (by design in LBG take). |
| **BEGIN…COMMIT batch** | `amcp.batchSend(lines)` → `BEGIN` + lines + `COMMIT` on TCP | Only when `config.amcp_batch` is true **and** chunk has **≥2** lines. Max lines: `amcp_max_batch_commands` (default **64**, max **512**). |
| **Chunked batch** | `amcp.batchSendChunked(lines, opts)` | Splits into multiple batches/sequential blocks. |
| **Sequential raw** | `sendAmcpLinesSequential` (= `sequentialRaw`) | One TCP round-trip per line; used for CG+mixer blocks and `MIXER ch COMMIT` sandwiches. |
| **HTTP → server** | `POST /api/amcp/batch`, `/api/amcp/raw-batch`, `/api/raw` | Preview UI uses batch + separate COMMIT lines (`client/lib/amcp-preview-batch.js`). |

**Mixer pre-commit:** Before mixer-only batches (no `CG` lines), the server may send `MIXER {ch} COMMIT` once **unless** `skipMixerPreCommit: true` (required for LBG take DEFER chunks).

**Channel COMMIT:** `MIXER {ch} COMMIT` is **invalid inside** BEGIN…COMMIT batches. Preview and LBG take send it **outside** batches (sequential).

---

## Layer numbering reference

| Role | Physical layer(s) |
|------|-------------------|
| Program bank **A** | logical `N` → `{ch}-{N}` (1–99) |
| Program bank **B** | logical `N` → `{ch}-{N+100}` (110–199) |
| **Merge / Animate** take | incoming on **same** logical layer (no +100) |
| Global border PGM | **998** (A) or **996** (B), from `globalBorder.activePgmLayer` |
| Global border PRV mirror | **997** |
| PIP overlay slot *i* | `{contentLayer + 1 + i}` when aligned (gap = 1) |
| Timeline stack | **200+** (`TIMELINE_LAYER_BASE` + layer index) |
| Startup LED splash | **999** |

---

## Pipeline index

| # | Pipeline | Entry / trigger | Primary source |
|---|----------|-----------------|----------------|
| 1 | **PGM scene take (LBG)** | `POST /api/scene/take` | `scene-take-lbg.js`, `scene-take-lbg-amcp-pipeline.js` |
| 2 | **PGM→PRV bus exchange** | After PGM take (2-bus routing) | `routes-scene.js` + pipeline 1 on PRV |
| 3 | **PRV look preview** | Debounced editor preview | `scenes-preview-push-scene.js`, `amcp-preview-batch.js` |
| 4 | **Exit layer fade + clear** | Timeline-only take helper; media exit | `scene-exit-layers.js` |
| 5 | **Clear occupied look stack** | PRV exchange prep | `scene-exit-layers.js` |
| 6 | **Post-take teardown** | After LBG take | `scene-take-lbg-teardown.js` |
| 7 | **Timeline playback tick** | `TimelineEngine` RAF loop | `timeline-playback-amcp.js` |
| 8 | **Fade to black (FTB)** | FTB API | `ftb-pgm-prv.js` |
| 9 | **Clip end fade** | Scheduled after PLAY | `clip-end-fade.js` |
| 10 | **Global border (API lines)** | Inspector / preview border fetch | `global-border.js`, `routes-scene.js` |
| 11 | **Global border preset crossfade** | Dual-layer preset recall | `global-border.js` |
| 12 | **Startup LED test pattern** | Boot (no Web UI yet) | `startup-led-test-pattern.js` |
| 13 | **PIP overlay HTTP apply** | `/api/pip-overlay/*` | `pip-overlay.js`, `routes-pip-overlay.js` |
| 14 | **HTTP AMCP batch** | Client batch POST | `routes-amcp.js` |
| 15 | **Legacy dual-bank take** | Exported, **not** used by `/api/scene/take` | `scene-take.js` |
| 16 | **Timeline-only take** | Exported, **not** wired in routes | `scene-transition.js` `runTimelineOnlyTake` |

---

## 1. PGM scene take (LOADBG path) — **production**

**Entry:** `runSceneTakeLbg(amcp, opts)` ← `POST /api/scene/take`  
**Files:** `src/engine/scene-take-lbg.js`, `scene-take-lbg-jobs.js`, `scene-take-lbg-merge.js`, `scene-take-lbg-amcp-pipeline.js`, `scene-take-lbg-teardown.js`

Per-layer job building (`buildTakeJobs`) produces `loadPlan`, `playPlan`, `mixerLines`, `prePlayOpacityZeroLine`, PIP list, optional `browserCgUrl`. Clip verbs are built via `serializeClipCommandPlan` (`amcp-command-plan.js`).

### Phase A — Early exit fade (optional)

**When:** `exitMedia.length > 0`, `fadeDur > 0`, **not** bank crossfade, **not** merge transition.

```
# Per exiting layer (active bank physical layer pOut):
MIXER {ch}-{pOut} OPACITY 0 {fadeDur} [{tween}]
# + PIP overlay fade DEFER lines on overlay slots (if PIP on layer)

→ batchSendChunked(fadeLines, { skipMixerPreCommit: true })
→ MIXER {ch} COMMIT
```

### Phase B — +Animate outgoing-only opacity (optional)

**When:** `+ Animate` / `+ MERGE` (`isMergeTransition`), `fadeDur > 0`.

Appended to `mergeMixerExtras` for layers **leaving** the look (not replaced by a takeJob):

```
MIXER {ch}-{ln} OPACITY 0 {fadeDur} [{tween}] DEFER
```

Replaced layers use **PLAY MIX** on the on-air physical layer — no `MIXER OPACITY <dur>` on that slot.

### Phase B2 — +Animate take sandwich

**When:** `isMergeTransition`, `takeJobs` with `playPlan`.

Prep: `LOADBG` (no MIX) + immediate `MIXER FILL … {fadeDur} {tween}` + DEFER mixer extras.

```
MIXER {ch} COMMIT
PLAY {ch}-{pOnAir} "{clip}" MIX {fadeDur} [{tween}]
MIXER {ch} COMMIT
```

`pOnAir = phys(logicalN, activeBank)`. Bank pointer **not** flipped after animate.

### Phase C — Main AMCP pipeline (`runSceneTakeLbgAmcpPipeline`)

Skipped when `takeJobs` and `mergeMixerExtras` are both empty (border-only changes still run border block).

#### C.1 Global border (if incoming enabled)

**Sequential** (`sendPipOverlayLinesSerial`):

**Same template type** (CG UPDATE only):

```
CG {ch}-{gbLayer} UPDATE 0 "{json}"
```

**New or type changed** (ADD path; `initialOpacity` 0 if crossfade-in linked):

```
MIXER {ch}-{gbLayer} OPACITY 0 0          # only if initialOpacity=0
CG {ch}-{gbLayer} ADD 0 "{template}" 1 "{json}"
CG {ch}-{gbLayer} PLAY 0
CG {ch}-{gbLayer} UPDATE 0 "{json}"
MIXER {ch}-{gbLayer} FILL 0 0 1 1 0 DEFER
MIXER {ch}-{gbLayer} KEYER 0 DEFER
MIXER {ch}-{gbLayer} OPACITY {0|1} 0 DEFER   # if starting visible
```

`gbLayer` = **998** or **996**.

#### C.2 Per takeJob — load + mixer prep

For each job (not merge): `MIXER CLEAR` on target layer first.

**LOADBG** (individual `_send`, not batched) when `loadPlan` set:

```
LOADBG {ch}-{pLayer} {clip} [LOOP] [MIX {dur} {tween} [RIGHT|LEFT]] [SEEK n] [LENGTH n] [AF "…"]
```

Example with dissolve: `LOADBG 1-110 "media/foo.mp4" MIX 25 linear`

**Then batched** (`batchSendChunked`, `skipMixerPreCommit: true`):

```
# flatMixer = all jobs' mixerLines + mergeMixerExtras
MIXER {ch}-{pLayer} FILL {x} {y} {sx} {sy} {0|fadeDur} [DEFER except FILL on non-merge]
MIXER {ch}-{pLayer} ROTATION {deg} 0 [DEFER]
MIXER {ch}-{pLayer} OPACITY {target|layerOpacity} {dur|0} [DEFER]
MIXER {ch}-{pLayer} KEYER 1                    # if straight-alpha still
MIXER {ch}-{pLayer} VOLUME {vol} [DEFER]
# + effect lines (BLEND, BRIGHTNESS, …) [DEFER]
```

**Pre-play opacity** (bank crossfade, separate batch):

```
MIXER {ch}-{pLayer} OPACITY 0 0              # incoming on bank B (top) — incomingStartsHidden
MIXER {ch}-{pLayer} OPACITY {target} 0       # incoming on bank A (under) — prePlayOpacityFullLine
```

#### C.3 PIP remove / add

**Sequential:**

```
# remove: per stale overlay slot
CG {ch}-{oLayer} CLEAR
MIXER {ch}-{oLayer} CLEAR DEFER
# …

# add (single overlay):
CG {ch}-{oLayer} ADD 0 "{template}" 1 "{json}"
MIXER {ch}-{oLayer} FILL 0 0 1 1 0 DEFER
MIXER {ch}-{oLayer} KEYER 0 DEFER
MIXER {ch}-{oLayer} OPACITY 1 DEFER

# add (multi → pip_router):
CG {ch}-{oLayer} ADD 0 "pip_router" 1 "{json}"
MIXER {ch}-{oLayer} FILL 0 0 1 1 0 DEFER
MIXER {ch}-{oLayer} KEYER 0 DEFER
MIXER {ch}-{oLayer} OPACITY 1 DEFER
```

#### C.4 Crossfade + PLAY commit sandwich

**Preroll:** 80 ms (180 ms if incoming hidden or merge+load transition).

**Bank crossfade** builds `crossfadeLines` (only **one** layer tweens — avoids ~50% composite dip):

```
# incoming on bank B (above outgoing):
MIXER {ch}-{pIn} OPACITY {targetOpacity} {fadeDur} [{tween}]
# incoming on bank A (below outgoing):
MIXER {ch}-{pOut} OPACITY 0 {fadeDur} [{tween}]
# + exitMedia not in takeJobs → teardown only, not faded here
# + global border opacity fade lines on 998/996 if gbWillFadeIn/Out
```

**Sequential chain** (`sendAmcpLinesSequential`):

```
MIXER {ch} COMMIT
PLAY {ch}-{pLayer}                    # minimal form in crossfade branch
MIXER {ch}-{pLayer} OPACITY 0 0       # per job incomingStartsHidden
… all crossfadeLines …
MIXER {ch} COMMIT
```

**Merge transition** (no bank crossfade, has playPlan):

```
MIXER {ch} COMMIT
PLAY {ch}-{pLayer}
… merge play lines …
MIXER {ch} COMMIT
```

**Cut / simple play** (no crossfade lines):

```
MIXER {ch} COMMIT
PLAY {ch}-{pLayer} {clip} [LOOP] [MIX …] [SEEK …] [AF …]   # full serializeClipCommandPlan
MIXER {ch} COMMIT
```

If no plays: `MIXER {ch} COMMIT` only.

#### C.5 Browser-as-CG (per job)

**Sequential** after main play:

```
CG {ch}-{pLayer} CLEAR
CG {ch}-{pLayer} ADD 0 highascg_browser_url 1 "{urlJson}"
CG {ch}-{pLayer} PLAY 0
CG {ch}-{pLayer} UPDATE 0 "{urlJson}"
→ MIXER {ch} COMMIT
```

Video layer uses `PLAY … [HTML] black` from load/play plan; URL lives in CG.

#### C.6 Clip-end fade scheduling

No immediate AMCP; schedules later pipeline **9**.

### Phase D — Teardown (`runSceneTakeLbgTeardown`)

**After** fade clock elapses (if crossfade/merge fade ran):

**Sequential** stop/clear per exit layer (+ PIP removes; merge clears both `ln` and `ln+100`):

```
STOP {ch}-{layer}
MIXER {ch}-{layer} CLEAR
# PIP remove lines…
```

If border removed from look:

```
CG {ch}-998 CLEAR
MIXER {ch}-998 CLEAR
CG {ch}-996 CLEAR
MIXER {ch}-996 CLEAR
```

```
→ MIXER {ch} COMMIT
```

---

## 2. PGM → PRV bus exchange

**When:** `routes-scene.js` detects program + single preview bus (`bus1`, no `bus2`).

**Order:**

1. Full **pipeline 1** on **PGM** `channel` with incoming look.
2. `clearSceneProgramLookStackLayers(amcp, prvChannel)` — pipeline **5**.
3. **Pipeline 1** on **PRV** with `forceCut: true`, `currentScene: null`, `incomingScene: previousPgmScene`, `skipLayerVisualEquality: true`.

---

## 3. PRV look preview (editor)

**Entry:** `pushSceneToPreviewImpl` → `postAmcpPreviewPipeline`  
**Files:** `client/lib/scenes-preview-push-scene.js`, `client/lib/amcp-preview-batch.js`

Builds one `queue` per preview channel, then `MIXER {previewCh} COMMIT` at end. Side borders on other channels get their own mini-pipeline + COMMIT.

### Full layer push (content changed)

Per layer with source:

```
PLAY {ch}-{ln} {clip} [LOOP] [AF "…"]
MIXER {ch}-{ln} ANCHOR 0 0 DEFER
MIXER {ch}-{ln} FILL {x} {y} {sx} {sy} 1 DEFER
MIXER {ch}-{ln} ROTATION {deg} 0 DEFER
MIXER {ch}-{ln} OPACITY {op} 0 DEFER
MIXER {ch}-{ln} KEYER {0|1}
MIXER {ch}-{ln} VOLUME {vol} DEFER
# browser CG tail (same 4 CG lines as take)
# effect lines from effect-registry
# PIP add/remove lines from pip-overlay-amcp.js
```

### Geometry-only / content unchanged

Only changed mixer lines (diff vs snapshot); may skip PLAY.

### Layer reset (leaving preview stack)

```
STOP {ch}-{ln}
MIXER {ch}-{ln} CLEAR
# PIP remove lines
```

### Global border

Fetches lines from `POST /api/scene/border-lines` (pipeline **10**), appends to queue.

### Send order

1. Split `MIXER {ch} COMMIT` out of batchable lines.
2. Chunks of **64** → `POST /api/amcp/batch` (fallback `raw-batch`, then per-line `/api/raw`).
3. Each COMMIT → `POST /api/raw`.

---

## 4. Exit layer fade + delayed clear

**Entry:** `runExitLayers` → `fadeExitLayerOpacities` + `runExitLayersStopAndClear`  
**File:** `scene-exit-layers.js`

### Fade

```
MIXER {ch}-{pLayer} OPACITY 0 {dur} [{tween}] DEFER   # per layer
→ batchSendChunked(..., { skipMixerPreCommit: true })
→ MIXER {ch} COMMIT
```

### After `fadeMs + 5`

```
STOP {ch}-{pLayer}
MIXER {ch}-{pLayer} CLEAR
→ batchSendChunked (no skip flag on stop/clear batch)
→ MIXER {ch} COMMIT
```

---

## 5. Clear occupied program look stack

**Entry:** `clearSceneProgramLookStackLayers(amcp, channel)`  
**Used before:** PRV exchange.

Per occupied physical layer (from playback matrix + OSC + live scene):

```
STOP {ch}-{L}
MIXER {ch}-{L} CLEAR
→ batchSend per chunk
→ MIXER {ch} COMMIT
```

---

## 6. Timeline playback tick

**Entry:** UI `_tick` (40ms) → `_syncAmcpOnTimelineTick` (AMCP on **state change** only).  
**Force path:** `play()`, `seek()`, inspector edits → `_applyAt(id, ms, true)`.  
**File:** `src/engine/timeline-playback-amcp.js`

The 40ms tick updates playhead + WS only. Transport AMCP fires on:

| Event | Command |
|-------|---------|
| New clip (tick or play/seek) | `PLAY …` or `LOAD … SEEK …` or `PLAY … LOOP` |
| User seek / scrub (`force`) | Same as new clip at frame |
| Pause | `PAUSE {ch}-{L}` (per layer, except `loopAlways`) |
| Resume | `RESUME {ch}-{L}` |
| Clip ended (tick) | `STOP {ch}-{L}` |
| Stretched clip while playing | `CALL … SEEK {frame}` at most every **500ms** (`TIMELINE_AMCP_DRIFT_MS`) |
| Normal clip while playing | **(none)** — Caspar decodes at 1× |

Mixer deltas (when changed):

```
MIXER {ch}-{L} FILL {fx} {fy} {sx} {sy} 0
MIXER {ch}-{L} OPACITY {op}
MIXER {ch}-{L} VOLUME {vol}
# On effect change: neutral reset block + effect lines → batchSendChunked
```

End of frame: `MIXER {ch} COMMIT` for each dirty channel.

---

## 7. Fade to black (FTB)

**Entry:** `runFadeToBlackAllLayers`  
**File:** `ftb-pgm-prv.js`

Per channel, per occupied layer:

```
MIXER {ch}-{L} OPACITY 0 {durationFrames} {tween}
→ batchSendChunked
→ MIXER {ch} COMMIT
```

Wait `maxFadeMs + 200`, then per channel:

```
CLEAR {ch}
→ MIXER {ch} COMMIT
```

---

## 8. Clip end fade (scheduled)

**Entry:** `ClipEndFadeWatcher._executeFade`  
**File:** `clip-end-fade.js`

At clip end minus fade length:

```
MIXER {ch}-{L} OPACITY 0 {fadeFrames}
→ MIXER {ch} COMMIT
```

After fade duration + 50 ms:

```
STOP {ch}-{L}
MIXER {ch}-{L} CLEAR
# PIP remove lines for overlay slots
→ MIXER {ch} COMMIT
```

---

## 9. Global border — line builders (API)

**Entry:** `POST /api/scene/border-lines` returns lines; client or server sends them.  
**File:** `src/engine/global-border.js`

| Mode | Stack |
|------|--------|
| **Enable, cut** | ADD path (see C.1) `initialOpacity: 1` |
| **Enable, fade in** | ADD `initialOpacity: 0` + `MIXER … OPACITY 1 {fadeDur}` |
| **Update** | `CG … UPDATE 0 "{json}"` |
| **Disable, fade out** | `MIXER … OPACITY 0 {fadeDur}` (+ scheduled CLEAR later in routes) |
| **Disable, cut** | `CG … CLEAR` + `MIXER … CLEAR` |

### Preset crossfade (`POST /api/scene/border-preset-crossfade`)

```
# Prepare inactive layer (UPDATE or full ADD at opacity 0)
CG/MIXER … on {toLayer}
MIXER {ch}-{fromLayer} OPACITY 0 {fadeDur} [DEFER if in batch]
MIXER {ch}-{toLayer} OPACITY 1 {fadeDur} [DEFER]
```

Layers: **998** ↔ **996** on PGM; **997** on PRV mirror.

---

## 10. Startup LED test pattern

**Entry:** `runStartupLedTestPatternIfNeeded`  
**File:** `src/bootstrap/startup-led-test-pattern.js`

Per output channel, layer **999**:

```
CG {ch}-999 CLEAR
MIXER {ch}-999 CLEAR
CG {ch}-999 ADD 0 "highascg_startup_led" 1 "{json}"
CG {ch}-999 PLAY 0
CG {ch}-999 UPDATE 0 "{json}"
MIXER {ch}-999 FILL 0 0 1 1 0
MIXER {ch}-999 OPACITY 1
→ batchSendChunked(flat, { skipMixerPreCommit: true })
→ MIXER {ch} COMMIT   # per channel
```

CEF replay at 4 s / 10 s repeats full stack.

---

## 11. PIP overlay HTTP routes

**Files:** `routes-pip-overlay.js`, `pip-overlay.js`

Apply:

```
# buildPipOverlayAmcpLines* (see C.3)
→ sendPipOverlayLinesSerial (sequential)
→ MIXER {ch} COMMIT
```

Remove:

```
CG {ch}-{oLayer} CLEAR
MIXER {ch}-{oLayer} CLEAR …
```

---

## 12. HTTP AMCP batch endpoint

**Entry:** `POST /api/amcp/batch` body `{ commands: string[] }`  
**File:** `routes-amcp.js`

```
→ amcp.batchSendChunked(lines)   # server-side; same rules as above
```

`POST /api/amcp/raw-batch`: **sequential** `amcp.raw` per line (slow; avoid for large stacks).

---

## 13. Legacy dual-bank take (retained, unused by API)

**Entry:** `runSceneTake` — exported from `scene-transition.js` but **not** called by `routes-scene.js`.  
**File:** `scene-take.js`

Per incoming layer on **inactive** bank:

```
STOP {ch}-{pIn}
MIXER {ch}-{pIn} CLEAR
PLAY {ch}-{pIn} {clip} [LOOP] [AF …]
MIXER {ch}-{pIn} FILL … 0
MIXER {ch}-{pIn} ROTATION … 0
MIXER {ch}-{pIn} OPACITY {0|target} 0
MIXER {ch}-{pIn} KEYER 1
MIXER {ch}-{pIn} VOLUME …
→ batchSendChunked(all layer buildLines)
→ MIXER {ch} COMMIT
```

If crossfade:

```
MIXER {ch}-{pOut} OPACITY 0 {fadeDur} [{tween}]
MIXER {ch}-{pIn} OPACITY {target} {fadeDur} [{tween}]
→ batchSendChunked
→ MIXER {ch} COMMIT
→ wait fadeMs
→ STOP + MIXER CLEAR each pOut
→ MIXER {ch} COMMIT
```

---

## 14. Timeline-only take (retained, unused by API)

**Entry:** `runTimelineOnlyTake` — **not** called from `routes-scene.js` today.  
**File:** `scene-transition.js`

```
runExitLayers (pipeline 4) for media exits
timelineEngine.play(timelineId)
MIXER {ch} COMMIT
```

Timeline frames use **pipeline 7**, not LOADBG take.

---

## Command plan examples (`amcp-command-plan.js`)

| Plan | Serialized example |
|------|-------------------|
| LOADBG + MIX | `LOADBG 1-10 "AMB/a.mp4" MIX 25 linear` |
| LOADBG + LOOP + SEEK | `LOADBG 1-10 "clip.mov" LOOP SEEK 100` |
| PLAY (promote BG) | `PLAY 1-10` |
| PLAY + clip + SEEK + LENGTH | `PLAY 1-10 "next.mp4" MIX 25 linear SEEK 12 LENGTH 100` |
| PLAY + AF | `PLAY 1-10 "clip" AF "pan=16c|c2=c0|c3=c1"` |

---

## Suggested audit checklist

- [ ] Confirm production take path is **only** `runSceneTakeLbg` (not `runSceneTake`).
- [ ] For each transition mode (CUT, MIX, MERGE, bank crossfade), trace one layer through phases C.1–C.5.
- [ ] Compare PRV preview queue (pipeline 3) vs PGM take for same look — layer numbers and DEFER usage differ.
- [ ] Verify `MIXER {ch} COMMIT` never appears inside `/api/amcp/batch` chunks from preview.
- [ ] After merge take, confirm teardown clears `N` and `N+100`.
- [ ] Timeline layers (200+) never cleared by `clearSceneProgramLookStackLayers` (by design).

---

## Related docs

- `docs/reference/amcp-mapping.md` — REST ↔ AMCP method map  
- `docs/reference/amcp-clean-look-fade.md` — fade behaviour notes  
- `work/work-orders/07_WO_AMCP_PROTOCOL_API.md` — protocol WO history  
- `work/work-orders/sweep1.md` — module split for scene-take-lbg
