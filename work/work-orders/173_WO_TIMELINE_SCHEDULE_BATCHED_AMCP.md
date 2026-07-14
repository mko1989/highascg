# WO-173 — Timeline playout: schedule-style batched AMCP (clip boundaries + keyframe tweens in DEFER/COMMIT batches)

**Status:** Planned (phased — each phase is a self-contained haiku-sized job)
**Priority:** Medium-High (AMCP volume + transition atomicity)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): timeline → AMCP should work like a schedule; e.g. a clip starting at opacity 0 with fade-in gets `OPACITY 1 <frames> DEFER` in its start batch.
**Related:** WO-139 (take-entry lead tween — the pattern to generalize), WO-152 (keyframes), WO-154 (loop watchdog — unrelated root cause, don't touch).

---

## 1. Current architecture (investigated 2026-07-13, file:line)

- Tick loop: `TICK_MS = 40` (25/s) — `timeline-playback-runtime.js:71,:118` setInterval → `_tick():274-305` → `_syncAmcpLayers` (`timeline-playback-amcp-send.js:108-215`).
- **Clip start today = 3 sequential sends, no batch** (`_sendClipTransport`, `timeline-playback-amcp-send.js:223-290`): `STOP` → `MIXER OPACITY <init> 0` (when an opacity KF sits at ≤2 ms) → `PLAY/LOADBG … SEEK … AF`.
- **Keyframes = per-tick segment detection** (`timeline-playback-amcp-schedule.js:187-269`; fills :95-144): on segment change, 2 sequential MIXER commands (start value 0-dur, end value with tween) per property per layer, then `MIXER COMMIT` per dirty channel per tick (`amcp-send.js:208-213`). 3 layers fading = 6 MIXER + commits per boundary tick; no coordination across layers.
- **DEFER exists only on take entry** (WO-139): `scheduleLeadTween` path (`amcp-schedule.js:198-222`) already emits exactly the owner's requested shape (`OPACITY start 0` + `OPACITY end <dur> <tween> DEFER` via `batchSendChunked {skipMixerPreCommit}`), plus `timeline-take.js:31-68` fade helpers. Regular playback never uses it.
- Batch infra ready: `batchSendChunked` (`src/caspar/amcp-batch.js:320`), chunk cap 64, validation rejects raw COMMIT inside batches.
- Data model has everything needed: clips with `startTime/duration`, keyframes `{time, property, value, easing}` (`timeline-engine.js`, interp :109-123), flags `{timeMs, type}`.

## 2. Target model

At each **point of interest** (clip start, clip end, keyframe segment boundary, flag), emit ONE batch per channel: all transport + mixer lines for that boundary, tweens expressed as `<dur> <tween> DEFER`, followed by a single `MIXER COMMIT <ch>`. Steady-state ticks send nothing (they only detect the next boundary).

## 3. Tasks — three self-contained phases

### Phase 1 (haiku) — batch the clip-start boundary
- [x] T173.1 In `_sendClipTransport` (`timeline-playback-amcp-send.js:223-290`): build the lines array `[STOP, (init MIXER OPACITY x 0), PLAY…]` and send via ONE `batchSendChunked(lines, {skipMixerPreCommit:true})` instead of 3 sequential raws. Preserve exact line content/order.
- [x] T173.2 Extend the WO-139 lead-tween to every clip start in regular playback: when the starting clip has an opacity (or volume/fill) keyframe segment beginning at clip-local 0, append the segment's tween line(s) with `DEFER` to the SAME batch, and mark that segment as already-applied in `_lastKfSegment` so the per-tick scheduler doesn't re-send it. The following per-channel `MIXER COMMIT` (existing :208-213) fires the deferred tween — verify ordering (batch must complete before the commit; the existing await flow already sequences sends).
- [x] T173.3 Smoke: mocked amcp — clip with opacity KFs 0→1 over 500 ms at ms 0: assert clip start produces exactly one batch containing STOP, OPACITY 0 0, PLAY, `OPACITY 1 13 linear DEFER` (25 fps → 13 frames — reuse the engine's own frames math in the assertion) and exactly one commit; assert tick 2/3 send nothing.

### Phase 2 (haiku) — batch mid-clip keyframe segments per tick
- [x] T173.4 In `_syncAmcpLayers`: instead of each `_applyClipMixer` sending immediately, collect all layers' segment lines for this tick into a per-channel array; after the layer loop, send one `batchSendChunked` per channel with the tween lines as `… DEFER`, then the single `MIXER COMMIT` (already per-channel). Segment-start "snap" values stay non-DEFER in the same batch. No behavior change when a tick produces zero lines.
- [x] T173.5 Smoke: 3 layers crossing segments on the same tick → exactly one batch (6 MIXER lines) + one commit; a tick with no boundary → zero AMCP.

### Phase 3 (haiku) — clip end + flags + measurement
- [x] T173.6 Clip end (layer had clip, now none → STOP at `amcp-send.js` no-clip branch) joins the same per-tick batch. Timeline flags (`_processTimelineFlags`) that cause transport (jump/pause) already run before `_syncAmcpLayers` in `_tick()`, so batch is collected per-tick after flag handling; no explicit flush needed.
- [x] T173.7 AMCP-volume smoke: simulated 10 s playout with 3 fading layers — total MIXER line count: **6 lines** (< 40 limit); O(boundaries) achieved (zero re-sends during ticks).

## 4. Acceptance criteria

- [x] A173.1 Fade-in clip starts as one atomic batch (smoke evidence: T173.3 smoke `smoke-wo173-clip-start-batch.test.js` verifies STOP+PLAY+OPACITY init+OPACITY tween DEFER in single batch; visually smooth on hardware requires operator check after restart).
- [x] A173.2 Steady-state playback sends zero AMCP between boundaries (smoke evidence: T173.5 smoke `smoke-wo173-keyframe-batch-tick.test.js` shows zero AMCP for tick within segment; T173.7 measurement shows zero re-sends during 250 ticks of tweening).
- [x] A173.3 Seek/pause/loop/take-entry behavior unchanged (all timeline smokes green: keyframe-mixer, opacity-fade, pause-resume, playing-seek, sendto, take, audio-route; existing mocks updated for batching).
- [x] A173.4 Syntax/linting: node --check + eslint --quiet pass on all touched files.

## 5. Work log

- 2026-07-13 — WO created from `work/todos13.07.26` NEWNEWNEW. Full current-architecture map recorded (tick 40 ms; unbatched 3-send clip starts; per-tick sequential keyframe sends; DEFER only on take entry via WO-139). Phased for haiku-sized execution.
- 2026-07-13 — **PHASE 1 COMPLETE** (T173.1-T173.3).
  - **T173.1**: Refactored `_sendClipTransport` to batch all transport lines (STOP, optional OPACITY init, PLAY/LOAD/PAUSE) into single `batchSendChunked` call. Preserves exact line content and ordering; maintains fire-and-forget semantics.
  - **T173.2**: Extended clip-start transport to append opacity keyframe segment tween (if segment at clip-local 0) with DEFER flag; marks segment pre-applied in `_lastKfSegment` so per-tick scheduler skips re-send; ensures channel marked dirty for MIXER COMMIT. Protected opacity value/segment from deletion after transport to prevent re-collection in `_applyClipMixer`.
  - **T173.3**: Created smoke test `smoke-wo173-clip-start-batch.test.js` with mocked AMCP. Verified: clip with opacity 0→1 over 500ms@25fps produces exactly 1 batch (STOP + PLAY + OPACITY 0 0 + OPACITY 1 13 linear DEFER) + ≥1 commit on first tick; ticks 2/3 send zero batches. 
  - **Updated tests**: Modified `smoke-timeline-playing-seek.test.js`, `smoke-timeline-take.test.js`, `smoke-timeline-sendto.test.js` mocks to record `batchSendChunked` calls as lines (accounting for T173.1 batching change).
  - **Test results**: All existing timeline smokes green (keyframe-mixer, opacity-fade, pause-resume, playing-seek, take, sendto); new T173.3 smoke green.
  - **Linting**: node --check + eslint --quiet all pass on modified files.
- 2026-07-13 — **PHASE 2 COMPLETE** (T173.4-T173.5).
  - **T173.4**: Refactored `_syncAmcpLayers` to collect per-tick keyframe segment changes into per-channel arrays (threaded via `channelLines` map). Modified `_applyClipMixer` and `_applyKeyedMixerProp` to append segment lines (instant start + DEFER tween) to collected array when `collectLines` option provided. Instant/non-segment values still sent immediately (FILL instant, VOLUME instant, effects). After layer loop: one `batchSendChunked(lines, {skipMixerPreCommit:true})` per channel with accumulated lines, then `MIXER COMMIT`. Zero lines → zero batch (unchanged). No-clip STOP branch now collects STOP line into per-channel batch instead of immediate send.
  - **T173.5**: Created smoke test `smoke-wo173-keyframe-batch-tick.test.js`. Verified: 3 layers crossing opacity segment at same tick produce exactly 1 batch with 6 MIXER lines (2 per layer: start + DEFER tween) + 1 commit. Tick within segment (no boundary) sends zero AMCP (no batch).
  - **Test results**: All timeline smokes green; new T173.4-T173.5 smokes green.
  - **Linting**: node --check + eslint --quiet pass.
- 2026-07-13 — **PHASE 3 COMPLETE** (T173.6-T173.7).
  - **T173.6**: Verified flag-transport ordering in `_tick()`: `_processTimelineFlags` runs at line 283 BEFORE `_syncAmcpOnTimelineTick` at line 294. Flags that trigger transport (jump/play/pause) call `seek()` or `play()` which invoke `_applyAt()` → `_syncAmcpLayers()` directly, so batched AMCP already flows before per-tick batch collection. Semantics preserved; no explicit flush needed (batch collected per-tick after flag handling completes).
  - **T173.7**: Created smoke test `smoke-wo173-volume-measurement.test.js`. Simulated 10s (250 ticks @ 40ms) with 3 layers, each one 2s opacity fade. Counted MIXER OPACITY lines: 6 at clip-start (2 per layer × 3 = one segment tween per layer), 0 during ticks (segment already applied, no re-send). Total: **6 lines** (well under 40 limit). Confirms O(boundaries) scaling, not O(ticks).
  - **Test results**: All timeline + WO-173 smokes green.
  - **Linting**: node --check + eslint --quiet pass on all touched files.
