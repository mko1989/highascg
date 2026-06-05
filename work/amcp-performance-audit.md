# AMCP performance & network chatter audit

**Based on:** [`amcp-revision.md`](./amcp-revision.md) (2026-05-19)  
**Purpose:** For each pipeline, judge whether the **current command choice and send pattern** are well suited to the task, focusing on **TCP/AMCP round-trips**, **Caspar server work**, and **HTTP/WebSocket overhead** — not on visual correctness unless correctness blocks optimization.

**Rating scale**

| Rating | Meaning |
|--------|---------|
| **Optimal** | Hard to improve without changing product behaviour; batching and verb choice match Caspar strengths. |
| **Good** | Sound design; minor tuning only (config, chunk size, edge cases). |
| **Fair** | Correct but chatty; improvements are known and localized. |
| **Poor** | Systematic excess round-trips or wrong verb class for the job; should be on a roadmap. |
| **Constrained** | Chatty by necessity (protocol, CEF, DEFER/COMMIT semantics, or safety on unstable Caspar builds). |

**Round-trip (RT) shorthand**

- **1 RT** = one AMCP command through `_send` (wait for `202 … OK`), or one BEGIN…COMMIT block (one enqueue + one batch ack).
- **Sequential block of N lines** ≈ **N RT** when `amcp_batch: false`, or **⌈N / max_batch⌉ RT** when batching enabled (and chunk has ≥2 lines).
- **HTTP hop** = browser → Node → Caspar (adds latency; not extra Caspar RTs but doubles network chatter for preview).

---

## Executive summary

| Area | Verdict | Headline |
|------|---------|----------|
| **Default config** (`amcp_batch: false`) | **Poor** for production | Mixer-heavy paths already batch in code, but **single-line chunks still go sequential**; enabling batch is the largest global win. |
| **PGM LBG take** | **Good / Constrained** | LOADBG per layer + batched DEFER mixer + 2× channel COMMIT is the right Caspar model; cost scales with **layers × phases**. |
| **PGM→PRV exchange** | **Fair** | **Three** heavy sequences (PGM take + PRV clear + PRV take); unavoidable for current bus semantics without route mirroring. |
| **PRV preview** | **Fair** | Good **diff** logic; hurt by **HTTP batching**, optional **border-lines** fetch, and **PLAY-on-PRV** vs PGM LOADBG parity. |
| **Timeline tick** | **Good** (after 2026-05-19 fix) | UI tick ≠ AMCP; PLAY/SEEK only on clip/scrub/play/pause; stretched clips SEEK ≤2/s. |
| **FTB / exit clear** | **Good** | Batched opacity; **CLEAR channel** is optimal vs per-layer. |
| **CG borders / PIP** | **Constrained** | Sequential CG stacks and ADD+PLAY+UPDATE are **CEF-correctness** tax; UPDATE-only path is already optimal. |
| **Legacy `runSceneTake`** | **Fair** (unused) | Simpler batching story but **not** wired; kept for reference only. |

**Top 5 changes (impact × feasibility)**

1. **Enable `amcp_batch: true`** (and tune `amcp_max_batch_commands`) on stable Caspar builds — benefits all `batchSendChunked` paths + preview `/api/amcp/batch`.
2. **Batch PIP/CG line groups** with `batchSend` where no `MIXER ch COMMIT` is inside the chunk (today: `sendAmcpLinesSequential` = 1 RT per line).
3. **Timeline:** batch keyframed mixer lines per channel when values change (transport is already event-driven).
4. **Preview:** optional **server-side preview take** (reuse LBG builders on PRV) for full-scene edits — drops HTTP per-chunk overhead (larger refactor).
5. **PGM→PRV:** after PGM take, consider **route-based PRV mirror** of PGM output instead of second full take (architecture change; largest latency win for 2-bus sites).

---

## Global transport & configuration

| Setting | Default | Performance impact | Recommendation |
|---------|---------|-------------------|----------------|
| `amcp_batch` | `false` | Every 1-line “chunk” and all `sendAmcpLinesSequential` paths = **full RT each** | Set **`true`** on field systems once Caspar build is verified; use `HIGHASCG_AMCP_BATCH=1` in systemd until JSON updated. |
| `amcp_max_batch_commands` | `64` | Larger chunks → fewer BEGIN…COMMIT cycles; risk on old Caspar stacks | Try **128** on 2.3+ stable builds; keep **64** if batch timeouts seen. |
| `amcp_mixer_commit_before_amcp_batch` | `true` | Extra **1 RT per mixer-only batch** (flush before DEFER batch) | Keep **on** for generic batches; take path correctly uses `skipMixerPreCommit: true`. |
| Single-command batch rule | ≥2 lines to BEGIN…COMMIT | Odd leftover line after split = **1 RT** | When batching on, prefer chunk sizes that avoid **len % max === 1** (pad or merge pairs). |

**Verdict:** Defaults skew **safe over fast**. Documented batching exists but is **off** until operators opt in — **not best suited** for low-latency production if Caspar is known good.

---

## Pipeline-by-pipeline audit

### 1. PGM scene take (LBG) — production

**Reference:** [amcp-revision §1](./amcp-revision.md#1-pgm-scene-take-loadbg-path--production)

| Phase | Current choice | RT order (typical, batch off) | Rating | Notes |
|-------|----------------|-------------------------------|--------|-------|
| A Early exit fade | Batched `MIXER OPACITY` + COMMIT | 1–2 batch + 1 COMMIT | **Good** | Could merge with C if no preroll needed; separate phase avoids fighting incoming prep. |
| B Merge extras | DEFER opacities in flatMixer batch | Included in C | **Optimal** | Same COMMIT as incoming mixer — correct use of DEFER. |
| C.1 Global border | Sequential CG (+ optional immediate OPACITY 0) | **4–7 RT** per border | **Constrained** | UPDATE path (1 RT) is **optimal** for param tweaks. ADD+PLAY+UPDATE is required for CEF ([`global-border.js`](../src/engine/global-border.js), startup LED comments). |
| C.2 `mixerClear` + `LOADBG` | **Per job**, not batched | **2 × jobs** RT minimum | **Constrained** | LOADBG must complete before PLAY; cannot batch LOADBG with unrelated layers safely. **mixerClear** per job is conservative (clears stale mixer); could be deferred into first mixer batch if layer empty — micro-optimization. |
| C.2 Mixer prep | `batchSendChunked` DEFER lines | ⌈lines / 64⌉ | **Optimal** | FILL non-DEFER on non-merge is intentional (geometry before PLAY). |
| C.2 Pre-play OPACITY 0 | Separate batch | +1 batch | **Good** | Split prevents DEFER/COMMIT race; small cost. |
| C.3 PIP | Sequential | **~4–8 RT × overlays** | **Fair → improve** | CG lines **can** go in BEGIN…COMMIT ([`validateBatchLine`](../src/caspar/amcp-batch.js) allows `CG`). Replacing `sendPipOverlayLinesSerial` with `batchSend` per overlay block (no channel COMMIT inside) would cut RT **~75%** for PIP. |
| C.4 PLAY sandwich | `COMMIT` + PLAY(s) + crossfade + `COMMIT` | **2 + plays + 1** sequential | **Constrained** | Two channel COMMITs are **required** to apply DEFER then run timed opacities. Minimal `PLAY ch-layer` in crossfade branch avoids re-sending clip — **good**. |
| C.5 Browser CG | Sequential 4× CG + COMMIT | **5 RT** | **Constrained** | Same CEF sequence as borders; not reducible without template change. |
| D Teardown | Sequential STOP/CLEAR (+ border) + COMMIT | **2 × exits + 1** | **Fair** | Could `batchSendChunked` STOP/CLEAR pairs (no CG) then one COMMIT — today uses sequential helper. |

**Verb choice: LOADBG + PLAY vs alternatives**

| Alternative | When better | Why LBG path does not use it |
|-------------|-------------|------------------------------|
| `LOADBG … AUTO` + single PLAY | Stinger-style auto transition | `useLoadAuto = false` — AUTO timing fought bank crossfade visibility ([`scene-take-lbg-jobs.js`](../src/engine/scene-take-lbg-jobs.js)). |
| `PLAY` only (preview style) | Fast PRV, cuts | PGM needs **inactive bank** or merge layer discipline; PLAY-only would show on wrong bank. |
| `LOADBG MIX` only (no manual opacity crossfade) | Single-layer dissolve | Bank crossfade still uses **paired MIXER OPACITY** for A/B layers — correct for dual-bank looks. |
| Legacy `runSceneTake` STOP+CLEAR+PLAY batch | Fewer LOADBG RTs | **Not API-wired**; LBG gives finer transition + merge modes. |

**Scaling:** Cost ≈ **O(layers with changes × (2 + mixerLines/64 + PIP + browser))** + **O(exits)**. Inherent for rich looks — not fixable without fewer layers or route-based output.

**Overall:** **Good / Constrained** — command **types** are appropriate; biggest wins are **batching on**, **PIP batching**, **teardown batching**, not switching away from LOADBG.

---

### 2. PGM → PRV bus exchange

**Reference:** [amcp-revision §2](./amcp-revision.md#2-pgm--prv-bus-exchange)

| Step | Cost | Rating | Assessment |
|------|------|--------|------------|
| Full PGM take | Pipeline 1 | **Required** | Incoming look must air on PGM. |
| `clearSceneProgramLookStackLayers` | Batched STOP/CLEAR per occupied layer | **Good** | Bounded to occupied layers, not 1–199 sweep. |
| Full PRV take (`forceCut`, skip visual equality) | Pipeline 1 again | **Fair** | Re-decodes previous PGM look on PRV — **high duplicate work** vs **route://** or **channel route** copy. |

**Best-suited alternative (roadmap):** Drive PRV from **PGM route** or shared producer so exchange is **0–1 RT** (route change) instead of full second take. Until then, **forceCut** and `skipLayerVisualEquality` are the right **minimizations** within the current design.

**Overall:** **Fair** — correct for “PRV shows last PGM look as hard cut”; **not** optimal for network/Caspar load.

---

### 3. PRV look preview (editor)

**Reference:** [amcp-revision §3](./amcp-revision.md#3-prv-look-preview-editor)

| Aspect | Current | Rating | Recommendation |
|--------|---------|--------|----------------|
| Transport | HTTP `POST /api/amcp/batch` (+ fallbacks) | **Fair** | Extra **HTTP RT** per chunk vs server-side TCP batch; WebSocket `amcp_batch` ([WO-07](../work/work-orders/07_WO_AMCP_PROTOCOL_API.md)) would remove hop. |
| Verb | `PLAY` + DEFER mixer | **Good for PRV** | Faster than LOADBG+PLAY for interactive edit; may flash briefly — acceptable on preview bus. |
| Incremental / geometry-only | Snapshot diff | **Optimal** | Skips PLAY when content unchanged — **best anti-chatter** feature in client paths. |
| Border | `POST /api/scene/border-lines` then AMCP | **Fair** | **+1 HTTP RT** per preview push per screen; could cache line templates client-side for param-only edits. |
| COMMIT | Stripped from batch, sent via `/api/raw` | **Good** | Required — cannot put in BEGIN…COMMIT. |
| Chunk size | Fixed **64** in client | **Good** | Should match server `amcp_max_batch_commands` (today may diverge). |

**Mismatch with PGM:** Preview uses **PLAY**; PGM uses **LOADBG**. Intentional (different buses/semantics) but means **double validation** — not a performance issue, a consistency issue.

**Overall:** **Fair** — diff logic is strong; **HTTP + sequential fallback + border API** dominate chatter more than mixer line count.

---

### 4. Exit layer fade + clear

**Reference:** [amcp-revision §4](./amcp-revision.md#4-exit-layer-fade--clear)

| Step | Pattern | Rating |
|------|---------|--------|
| Fade | `batchSendChunked` DEFER + COMMIT | **Optimal** |
| Delayed STOP/CLEAR | `batchSendChunked` after timer | **Good** |
| Timer | `fadeMs + 5` | **Good** | Small buffer avoids CLEAR before tween ends. |

**Alternative:** Single `CLEAR {channel}` after fade — **fewer RT** but clears **timeline + border** — **rejected** correctly.

**Overall:** **Good**

---

### 5. Clear occupied look stack

**Reference:** [amcp-revision §5](./amcp-revision.md#5-clear-occupied-program-look-stack)

| Aspect | Rating |
|--------|--------|
| Target only occupied layers (matrix + OSC + live scene) | **Optimal** |
| `STOP` + `MIXER CLEAR` pairs batched | **Good** |
| `mixerCommit` per chunk | **Good** |

**Overall:** **Good** — among the best-suited pipelines for both correctness and RT count.

---

### 6. Timeline playback tick

**Reference:** [amcp-revision §6](./amcp-revision.md#6-timeline-playback-tick)  
**Fixed:** 2026-05-19 — `_syncAmcpOnTimelineTick` replaces `_applyAt(…, false)` on the 40ms UI tick.

| Behaviour | Chatter | Rating |
|-----------|---------|--------|
| UI `_tick` (40ms) | WS `timeline.tick` only | **Optimal** |
| Play / pause / resume | `PLAY`+`SEEK` once, then `PAUSE`/`RESUME` | **Good** |
| Seek / scrub | `_applyAt(…, force)` → `PLAY` or `LOAD … SEEK` | **Good** |
| Clip boundary on tick | One `PLAY` or `LOAD` per new clip | **Good** |
| Normal 1× clip while playing | **No transport AMCP** | **Optimal** |
| Stretched clip (implicit loop) | `SEEK` at most every **500ms** if frame changed | **Good** |
| Keyframed mixer | `MIXER` only when value changes; `COMMIT` if dirty | **Good** |

**Optional next step:** batch mixer lines per channel per tick when keyframes animate (still diff-gated).

**Overall:** **Good** — transport is event-driven; the earlier audit was wrong to treat implicit-loop SEEK as per-tick by design intent, and that path is now throttled.

---

### 7. Fade to black (FTB)

**Reference:** [amcp-revision §8](./amcp-revision.md#8-fade-to-black-ftb)

| Step | Rating |
|------|--------|
| Per-layer opacity batch | **Good** |
| `CLEAR {channel}` once | **Optimal** vs per-layer CLEAR |
| Wait then COMMIT | **Good** |

**Overall:** **Good**

---

### 8. Clip end fade (scheduled)

**Reference:** [amcp-revision §9](./amcp-revision.md#9-clip-end-fade-scheduled)

| Step | RT | Rating |
|------|-----|--------|
| `mixerOpacity` + COMMIT | 2 | **Optimal** |
| Delayed STOP + CLEAR + PIP remove + COMMIT | 4+ sequential | **Fair** | Could batch STOP/CLEAR/PIP removes before final COMMIT. |

**Overall:** **Good** — low frequency (once per clip); not a systemic chatter source.

---

### 9. Global border API lines

**Reference:** [amcp-revision §10](./amcp-revision.md#10-global-border--line-builders-api)

| Path | Rating |
|------|--------|
| UPDATE-only on drag | **Optimal** |
| Fade in: ADD stack + opacity tween | **Constrained** |
| Preset crossfade dual layer | **Good** | Two layers + opacity tweens — correct for glitch-free preset swap (WO-43). |

**Overall:** **Good** for interactive UPDATE; **Constrained** on first enable.

---

### 10. Startup LED test pattern

**Reference:** [amcp-revision §12](./amcp-revision.md#12-startup-led-test-pattern)

| Aspect | Rating |
|--------|--------|
| One batched flat stack per channel | **Good** |
| CEF replay at 4s / 10s | **Fair** | **Duplicates full stack** — network cost for reliability; disable replays if boot stable. |
| Layer 999 isolation | **Optimal** | Does not touch look layers. |

**Overall:** **Good** at boot; replay timers are **optional chatter**.

---

### 11. PIP overlay HTTP routes

**Reference:** [amcp-revision §13](./amcp-revision.md#13-pip-overlay-http-routes)

Same as take PIP: sequential + COMMIT — **Fair**; batch CG+mixin lines when not sharing a take COMMIT sandwich.

**Overall:** **Fair**

---

### 12. HTTP AMCP batch endpoint

**Reference:** [amcp-revision §14](./amcp-revision.md#14-http-amcp-batch-endpoint)

| Route | Rating |
|-------|--------|
| `/api/amcp/batch` → `batchSendChunked` | **Optimal** |
| `/api/amcp/raw-batch` | **Poor** if used for >10 lines | O(n) Caspar RT — debug only ([PERF-D4](../work/work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md)). |

**Overall:** **Good** API design; misuse of raw-batch is the risk.

---

### 13–14. Legacy take & timeline-only take

**Not API-wired** — no production chatter. Legacy `runSceneTake` batches STOP/CLEAR/PLAY/mixer in one chunk (**fewer LOADBG RTs**) but lacks merge/LBG semantics — **not a drop-in performance upgrade**.

---

## Cross-cutting comparisons

### When to use which clip verb (Caspar-aligned)

| Task | Best verb | HighAsCG today |
|------|-----------|----------------|
| Prepare off-air, swap on cue | `LOADBG` → `PLAY` | PGM LBG take |
| Air immediately (preview) | `PLAY` | PRV preview |
| Transition on same layer | `LOADBG … MIX` or `MIXER OPACITY` | Both (merge vs bank) |
| Scrub / sync | `CALL … SEEK` | Timeline |
| Remove all layers on channel | `CLEAR {ch}` | FTB |
| Remove one layer | `STOP` + `MIXER CLEAR` | Teardown, exit, preview reset |

### COMMIT frequency

| Pattern | COMMIT count | Justified? |
|---------|--------------|------------|
| LBG take crossfade | 2 per channel per take wave | **Yes** — DEFER apply + timed opacity |
| Preview push | 1 per preview channel | **Yes** |
| Timeline tick | 1 per dirty channel per ~40ms | **Yes** but high **rate** |
| FTB | 1 per channel × 2 phases | **Yes** |

Reducing COMMIT below Caspar’s deferred mixer rules would **break** fades — not recommended.

### Batching vs sequential (decision tree)

```
Commands contain MIXER <ch> COMMIT?
  YES → send outside BEGIN…COMMIT (sequential raw)
  NO, all CG?
  → prefer batchSend (BEGIN…COMMIT) if ≥2 lines and amcp_batch true
  NO, mixer only with DEFER?
  → batchSendChunked + skipMixerPreCommit; COMMIT separately
  LOADBG / PLAY?
  → always sequential (per layer); do not batch with unrelated layers
```

---

## Measurement checklist (optional profiling)

To validate this audit on a real machine:

1. Enable debug AMCP logging; count `AMCP →` lines for: (a) 8-layer MIX take, (b) one preview push, (c) timeline play 10s.
2. Repeat with `amcp_batch: true` and compare wall time take→air.
3. `ss -tn` / wireshark on loopback :5250 — packets per take.
4. Compare preview via HTTP batch vs hypothetical WS `amcp_batch` (future).

Record results in a table under this file if you run the test.

---

## Suggested implementation backlog (performance only)

| Priority | Item | Pipelines | Effort |
|----------|------|-----------|--------|
| P0 | Enable & document `amcp_batch` for production | All batched | Config |
| P1 | `batchSend` for PIP/CG blocks (no serial per line) | 1, 11, 13 | Small |
| P1 | `batchSendChunked` for teardown STOP/CLEAR | 1, 6 | Small |
| P2 | Timeline: batch mixer lines per channel when keyframes animate | 6 | Medium |
| P2 | Align preview chunk size with server `amcp_max_batch_commands` | 3 | Trivial |
| P3 | WS preview AMCP instead of HTTP batch | 3 | Medium |
| P3 | PRV exchange via route mirror vs second take | 2 | Large |

---

## Related documents

- [`amcp-revision.md`](./amcp-revision.md) — command stacks (what is sent)  
- [`work/work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md`](./work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md) — PERF-D4, PERF-E1, PERF-D2  
- [`work/work-orders/performance/PF-05-operational-footguns.md`](./work-orders/performance/PF-05-operational-footguns.md) — raw-batch misuse  
- [`docs/reference/amcp-mapping.md`](../docs/reference/amcp-mapping.md) — API surface
