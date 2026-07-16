# WO-259 — Two-phase batched take: kill the per-command AMCP stagger in transitions

**Status:** OPEN
**Priority:** HIGH (owner-reported on-air artifact) — LIVE-CRITICAL CODE, escape hatch mandatory
**Owner check:** A259.1

## Owner prescription (verbatim)
"the transition is bugging. it seems like its sending amcp sequential making part of transition to happen before others. transition needs to be packed in to two begin comit. first set up. loadbg, mixers, cgs, with the transition time. second play and mixer comits."

## Investigation findings (2026-07-16, verified file:line — the fix design below follows them exactly)
- The pipeline is ALREADY phase-shaped (clear → border CG → per-layer mixerClear+LOADBG → pre-PLAY opacity → deferred MIXER flat → PIP CG → prebuffer sleep → leading `MIXER ch COMMIT` → PLAYs → crossfade OPACITY → trailing `MIXER ch COMMIT` → template CG → fadeWatcher): src/engine/scene-take-lbg-amcp-pipeline.js:97-452.
- The stagger is in TRANSPORT, not ordering: every command awaits its Caspar response (src/caspar/amcp-client-transport.js:158-175; sequentialRaw at amcp-batch.js:127-134). `amcp_batch` is **false** in config/general.json:2, so `batchSend`/`batchSendChunked` always fall back to sequentialRaw (amcp-batch.js:300-303). The PLAY block hardcodes `sendAmcpLinesSequential` (scene-route-deps.js:292,312,330) — it never batches even with the flag on.
- Batch machinery exists and validates: `runBeginCommitBatch` (amcp-batch.js:158-251); LOADBG/LOAD/PLAY/MIXER/CG permitted in batches (:118-119); `MIXER n COMMIT` FORBIDDEN inside a batch (:116); size cap `resolveMaxBatchCommands` default 64 (:35-51); sequential fallback on batch failure (:305-310).
- Ordering dependencies that constrain grouping (cite-verified):
  1. route:// PLAYs must stay staggered after their source PLAYs (scene-route-deps.js:283-332) — NEVER fold routes into the batch.
  2. pre-PLAY `OPACITY 0 0` must be committed before PLAY (scene-take-lbg-jobs.js:238-256 warns deferring = hard cut).
  3. FILL/ANCHOR intentionally immediate pre-PLAY (scene-take-lbg-jobs.js:276-281).
  4. Global border CG rides the swap COMMIT (amcp-pipeline.js:134).
  5. Historical note at scene-take-lbg.js:14 avoided batching LOADBG/PLAY "so Caspar can resolve each layer reliably" — this WO consciously revisits that; hence the escape hatch.
  6. WO-218 SWAP + WO-210 timersVisibility stay AFTER the transition window (scene-take-lbg.js:397-415, :467-480) — untouched.

## Fix design

**T259.1 — take-scoped batching** (`src/engine/scene-take-lbg-amcp-pipeline.js` + `src/caspar/amcp-batch.js`)
New config flag `take_two_phase_batch` (default **true** — owner asked for this behavior; explicit `false` restores today's byte-identical sequential path — the INSTANT no-code-change rollback). When on, the take pipeline sends:
- **Phase A** (one `runBeginCommitBatch`, chunked at the 64-command cap): per-layer `MIXER CLEAR` + `LOADBG` (with transition params where the plan carries them) + pre-PLAY opacity lines + deferred MIXER setup + FILL/ANCHOR + border/PIP `CG` lines. Then the leading `MIXER ch COMMIT` OUTSIDE the batch (constraint: never inside).
- **Phase B** (one `runBeginCommitBatch`): all **non-route** PLAYs back-to-back + crossfade OPACITY suffix lines. Then the trailing `MIXER ch COMMIT` outside the batch. Route PLAYs keep the existing staggered sequential path AFTER Phase B (dependency 1).
- Take-scoped: force-batch via an explicit opts/param on the batch helpers — do NOT flip the global `amcp_batch` flag (other flows keep their behavior).
- Keep: prebuffer sleep between A and B; sequentialRaw fallback on batch send failure; post-window SWAP/timers logic untouched; fadeWatcher untouched.

**T259.2 — PGM-only path** (`src/engine/scene-take-pgm-only.js`): apply the same two-phase grouping under the same flag (it shares the jobs model; report how its current emission differs and what you changed).

**T259.3 — smokes** (curated gate): with a recorded AMCP stub, flag ON: assert the exact wire shape — one BEGIN..COMMIT containing all Phase-A lines, `MIXER ch COMMIT`, one BEGIN..COMMIT with all non-route PLAYs, trailing `MIXER ch COMMIT`, routes after; no `MIXER n COMMIT` ever inside a batch; chunking at >64 lines. Flag OFF: byte-identical line sequence to today's (capture before/after in the test). Route-dependency case: route PLAY never inside Phase B.

**T259.4 — docs**: work-order note in scene-take-lbg.js:14 updated (the historical "don't batch LOADBG/PLAY" comment must now describe the flag trade-off, not a blanket rule).

## Constraints (LIVE-CRITICAL — strictest standard)
No git, no service ops, NO AMCP to the live server under any circumstances, no HTTP/WS to :4200/:5250, no vite build, curated gate ONLY. node --check + eslint --quiet on touched files; exact gate counts. The take pipeline has caused live outages before (WO-217): keep diffs minimal, show the before/after emission sequence for a 3-layer crossfade take in your report, and if ANY finding contradicts this WO's design, STOP and report instead of improvising. A259.1 (owner) validates on PRV/non-air first per the historical reliability note.

- [ ] T259.1 two-phase batches behind take_two_phase_batch (default true, false = byte-identical legacy)
- [ ] T259.2 PGM-only path
- [ ] T259.3 wire-shape smokes (flag on AND off)
- [ ] T259.4 comment/docs update
- [ ] A259.1 (owner) PRV-first validation, then a live multi-layer crossfade take: all layers transition together
