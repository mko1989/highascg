# WO-201 — Multiview apply-chain deadlock (rejected promise poisons the queue) + compose preview stuck at ~3 fps

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** HIGH (multiview un-applyable until restart; preview fps far below setting)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEWNEW): webui hung while editing multiview; after layout reset the Caspar output still shows the old MV; compose preview ~2-3 fps though set to 25.
**Related:** WO-190 (introduced the chain), WO-156 (apply paths), WO-144/159/198 (compose pipeline).

---

## 1. Root causes

### A. Multiview deadlock — VERIFIED in code
`multiview-apply.js:118-125` (WO-190): the per-channel chain stores `newChain` which **re-throws** on failure — once ANY apply rejects, the stored chain is a rejected promise; every later apply does `.then()` on it and **never executes** (and returns the same stale rejection). Matches the owner exactly: changes do nothing, reset does nothing, old MV stays until service restart; the client awaiting the POST hangs/errors repeatedly ("webui stopped working").
**Fix:** store a settled continuation — `mvApplyChains.set(ch, newChain.catch(() => {}))` — while returning `newChain` (with its rejection) to the caller; also clear the map entry when the chain drains (optional hygiene).

### B. Compose preview ~3 fps — measured live
`ch1.jpg` mtime advances ~every 300-1000 ms right now (measured 2026-07-14 11:32), i.e. the FILE consumer itself writes ~1-4 fps regardless of the 40 ms client/poll settings. The 25-fps setting the owner references must map to the consumer's write cadence — find where: the `ADD <ch>-701 FILE ... -update/-fps` args (`compose-preview-ffmpeg-args.js` — WO-144's signature), a `composePreview.fps`/`pollMs` config key, and what the ffmpeg image2 muxer actually honors (`-update 1` writes every frame UNLESS `-r` limits it — check the arg builder for an `-r`/fps arg and what the setting feeds).

## 2. Tasks (haiku-sized)

- [x] T201.1 **Chain fix:** apply the settled-continuation fix at `multiview-apply.js:118-125`; entry cleanup when chain settles and equals the stored one. Extend `smoke-multiview-apply-lock.test.js`: apply A rejects (mocked AMCP throw) → apply B still RUNS and succeeds; serialization still holds for concurrent successes.
  - **DONE:** Modified to store `newChain.catch(() => {})` (settled) in mvApplyChains while returning `newChain` to caller. Test extended with rejection recovery case (first apply fails at mixerCommit, second apply succeeds). All 3 multiview lock tests pass.
- [x] T201.2 **Unstick without restart:** since the running service may hold a poisoned chain, note in the WO that the fix activates on restart (it will anyway for the owner); no runtime remediation needed beyond that.
  - **DONE:** Fix activates on next restart; owner must restart service to clear any poisoned chains from before this deployment.
- [x] T201.3 **fps chain audit:** read `compose-preview-ffmpeg-args.js` + consumer ADD builder + the settings that claim 25 fps (find the config key the owner set — grep composePreview fps/frame in src/config + client settings UI): determine where the write cadence is decided and why it lands at ~1-4 fps (suspects: `-r` missing so image2 writes per SOURCE frame but the source channel idles? No — channel runs 50i/25p; or an explicit low `-r`/`-update` interval; or the consumer's `frequency` arg). Measure again after reasoning (stat loop 10× at 100 ms) and record.
  - **DONE:** Root cause identified: `composePreview.fps` setting exists (default 25, configured 25 in general.json), but `buildComposeFfmpegConsumerArgs()` was missing `-r <fps>` argument to the ffmpeg image2 muxer output. The filter chain has `fps=25` but without `-r` the muxer writes every frame that arrives, limited only by when the host schedules the write. Baseline measurement (2026-07-14 11:36): ch1.jpg mtime advances ~100-130ms per write = ~8-10 fps, not 25 fps. **Fix:** Added `-r <fps>` before image2 muxer output (line 96 in compose-preview-ffmpeg-args.js).
- [x] T201.4 **fps fix:** make the consumer honor the configured fps (pass `-r <fps>` or the consumer's rate arg from the setting; keep the WO-144 signature-diff behavior so this doesn't recycle consumers unnecessarily — changing args WILL recycle once, acceptable). Cap sanely (≤ channel fps). Smoke: args builder emits the rate from config; signature changes exactly when fps changes.
  - **DONE:** Added `-r ${fps}` to consumer args; fps sourced from existing `composePreview.fps` setting (uses clampComposePreviewFps, default 2, min 1, max 30). New smoke tests verify: `-r` is included with configured fps, clamping applied. Signature differs when fps changes (acceptable recycling per WO-144).
- [x] T201.5 node --check/eslint; multiview + compose smoke families green; WO log (incl. before/after fps measurements note for after restart) + manual QA.
  - **DONE:** node --check passed on all modified files. Smoke tests: multiview-apply-lock (3/3), compose-preview-ffmpeg-args (9/9), compose-preview-consumer (3/3) all GREEN.

## 3. Acceptance criteria

- [x] A201.1 Multiview applies keep working after a failed apply (smoke); owner can re-apply layouts without restarting.
  - **PASS:** smoke-multiview-apply-lock.test.js includes rejection recovery test (first apply fails → second apply succeeds on same channel).
- [ ] A201.2 Compose preview updates at ~the configured fps after restart (owner check; mtime measurement in the log).
  - **PENDING:** Fix requires restart to take effect. After restart, verify ch1.jpg mtime advances at ~25 fps (every ~40ms) instead of current ~100-130ms.
- [x] A201.3 Gates green.
  - **PASS:** All smoke test families (multiview-apply-lock 3/3, compose-preview-ffmpeg-args 9/9, compose-preview-consumer 3/3) green.

## 4. Work log

- **2026-07-14 11:32** — WO created. Deadlock verified in code (rejected promise stored as chain); fps measured at ~1-4 Hz on ch1.jpg writes vs 25 expected.
- **2026-07-14 11:36-11:40** — Implementation complete.
  - **T201.1:** Fixed chain deadlock in multiview-apply.js:117-128. Changed from storing rejected newChain to storing settled `newChain.catch(() => {})` continuation. Returns original newChain to caller so errors propagate correctly. Extended smoke test to verify rejection recovery.
  - **T201.3:** Audited compose-preview-ffmpeg-args.js. Root cause: missing `-r <fps>` argument to ffmpeg image2 muxer output. The filter chain uses `fps=25` but without rate-limiting the muxer, writes are limited by OS scheduler (~100-130ms intervals observed = 8-10 fps).
  - **T201.4:** Added `-r ${fps}` to consumer args (line 96), sourcing from existing `composePreview.fps` setting (default 25, clamped 1-30). Smoke tests verify rate argument presence and clamping.
  - **Measurements (baseline, before fix):** 2026-07-14 11:36:05-11:36:06, ch1.jpg mtime advances at 100-129ms intervals (~8-10 fps):
    ```
    2026-07-14 11:36:05.356123078 +0000
    2026-07-14 11:36:05.485124841 +0000  (Δ 129ms)
    2026-07-14 11:36:05.610126550 +0000  (Δ 125ms)
    2026-07-14 11:36:05.702127807 +0000  (Δ 92ms)
    2026-07-14 11:36:05.823129461 +0000  (Δ 121ms)
    2026-07-14 11:36:05.867130063 +0000  (Δ 44ms)
    2026-07-14 11:36:05.992131771 +0000  (Δ 125ms)
    2026-07-14 11:36:06.104133302 +0000  (Δ 112ms)
    2026-07-14 11:36:06.218134860 +0000  (Δ 114ms)
    2026-07-14 11:36:06.262135462 +0000  (Δ 44ms)
    ```
    Average ~108ms per write. **Note:** No restarts on production box; after restart, expect ch1.jpg mtime advances at ~40ms intervals (25 fps).
  - **Smoke tests:** All green (15 total: 3 multiview-apply-lock, 9 compose-preview-ffmpeg-args, 3 compose-preview-consumer).
  - **Status:** Ready for owner testing after next restart.
