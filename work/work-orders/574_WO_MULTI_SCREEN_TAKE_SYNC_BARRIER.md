# Work Order 574: Multi-screen take (preset ▶ / global take) starts the screens at different times

**Status: IN PROGRESS — implemented + offline-tested (2454 tests, 0 fail); owner-QA on the real two-screen rig owed (not measured on air)**

**Parent / context:** WO-150 B150.6 (concurrent per-channel take POSTs), WO-259 (two-phase BEGIN…COMMIT take batching)

## 1. Investigation

Owner (21.09): hit ▶ on a saved look preset (new play button on the preset card, same day) — "noticeable time
difference between the two screens… the actual play/take for different screens [should be] as close as possible".

- Client already dispatches one `POST /api/scene/take` per PGM channel concurrently
  (`client/components/scenes-editor-support.js` `takeScenesToProgram`, B150.6) — so the skew is NOT client-side sequencing.
- Server (`src/api/routes-scene-take.js`): each POST runs its own pipeline — awaited PRV staging `runSceneTakeLbg`
  (bus1), then the PGM `runSceneTakeLbg`: buildTakeJobs → Phase A (CLEAR/LOADBG/pre-hide, one BEGIN…COMMIT) →
  prebuffer sleep (80 / 180 ms, or ≥600 ms when the look has a shader — `scene-take-lbg-amcp-pipeline.js`) →
  Phase B (PLAY + crossfade OPACITY, one BEGIN…COMMIT).
- The two channels are independent pipelines whose duration depends on each look's content (layer count, media probe,
  shader warm-up, PRV staging). Phase B therefore fires whenever each channel happens to finish: a 2-screen preset
  with a shader on one screen and plain media on the other is skewed by hundreds of ms. They also share one AMCP
  connection, so there is no mechanism that aligns them.
- `runSceneTakePgmOnly` is dead code (header of `scene-take-pgm-only.js`) — a single pipeline to instrument.

## 2. What was done

Rendezvous barrier just before Phase B; everything before it (staging, LOADBG, Phase A, warm-up) stays parallel.

- `src/engine/take-sync-barrier.js` (new): `joinTakeGroup({id,size})` → `{arrive(), leave()}`; `withTakeGroup()` wrapper.
  Release when every member has arrived or left; cap `HIGHASCG_TAKE_SYNC_TIMEOUT_MS` (default 1500 ms, from first
  arrival) so a stuck peer can never hold air; late arrivals pass straight through.
- `routes-scene-take.js`: handler wrapped in `withTakeGroup(body.takeGroup, …)` — the slot is released in `finally`, so an
  early 400 / exception / follower-skip on one screen never makes the other wait. `awaitPlayBarrier` is passed ONLY to
  the two calls that put content on PGM (pgm/prv path + direct-program path) — never the PRV staging / exchange calls.
- `scene-take-lbg.js` → `scene-take-lbg-amcp-pipeline.js`: `awaitPlayBarrier()` awaited after the prebuffer sleep,
  immediately before the Phase B `try`.
- Client: when a batch has >1 job, every POST carries `takeGroup {id, size}`. Dispatch was moved AFTER the job-building
  loop so `size` equals the POSTs actually sent (jobs skipped for unmapped channel / missing look would otherwise make
  the group wait out the timeout).
- Alternative rejected: a barrier at the route level before the PGM `runSceneTakeLbg` — leaves Phase A + warm-up skew
  in front of the PLAY, which is the part that varies most.
- **Round 2 (owner 21.09: "the per-screen amcp plays should be batched together as the last amcp sent")**: the barrier
  alone still left each channel sending its OWN Phase B (BEGIN…COMMIT) back-to-back over the shared AMCP connection.
  Now a take hands its Phase B over as a *plan* `{amcp, channel, leadingCommit, block, trailingCommit}`
  (`playSync.arrive(plan)` from `sendStaggeredTakePlays`' two-phase path) and the group sends ALL screens' plans as one
  merged sequence on release: every leading `MIXER n COMMIT` (parallel) → ONE `BEGIN…COMMIT` with all screens' PLAY/fade
  lines (forceBatch, the last batch sent) → trailing `MIXER n COMMIT`s (parallel; these fire the deferred tweens —
  they cannot live inside a batch). A send failure rejects every waiting take (each logs its own Phase B failure).
  Branches with no plan (timeline-only, shader-only, rollback `take_two_phase_batch:false`) call `playSync.arrive()`
  as a plain gate and send their own lines. `playSync` replaces the earlier `awaitPlayBarrier` option.
  Caveat: `batchSendChunked` splits at `amcp_max_batch_commands` (default 64) — a merged block over that limit is sent as
  two consecutive batches (screen 1's lines first), still back-to-back but no longer one atomic batch. Two screens'
  looks normally stay well under it; raise `HIGHASCG_AMCP_MAX_BATCH` if a very large preset needs it.
  Physical limit: the channels' own frame clocks — a batch applied "at once" still lands on each channel's next frame.
- Split (owner asked): `scene-take-lbg.js` was 522 lines at HEAD (over the CI limit). Post-teardown bank bookkeeping
  (skipped-layer SWAP, pointer flip, vacated-layer CLEAR, orphan sweep, timersVisibility) moved verbatim into
  `scene-take-lbg-bank-finalize.js` (`finalizeTakeBankState`) → 448 + 129 lines; `check-max-file-lines` now 0 over.

## 3. VERIFIED

- `tools/smoke/smoke-wo574-multi-screen-take-sync-barrier.test.js` (6 tests, in the curated list): released together only
  when the last peer arrives (Δ<25 ms), leave/throw releases the slot, timeout caps a missing peer + straggler passes,
  and source pins for client tagging / server wiring / barrier position between warm-up and Phase B.
- Round 2 tests (fake AMCP recording wire order): nothing sent until the last screen is ready; ONE batch containing both
  screens' lines, leading commits before it, trailing commit only where requested, after it; failure rejects all
  screens; a straggler after timeout sends its own plan.
- The split is covered by the existing behavioural smokes that drive `runSceneTakeLbg` (wo209 bankless, wo218 bank-drift,
  wo259 two-phase) + the source-text pins, all green.
- `npm run test:ci`: 2454 tests, 2452 pass, 0 fail, 2 skipped.
- NOT verified: real-rig timing. Owner-QA: recall a 2-screen preset with ▶ and compare the two screens' transition starts;
  server log has no barrier line yet — if skew persists, add a timestamp log at `awaitPlayBarrier` release.
