# WO-218 — Bank drift: visually-equal layers skip re-staging while the bank flips → producer and mixer state (CROP) end up on different banks

**Status:** Planned
**Priority:** High (answers WO-190's crop mismatch with hard evidence; also the "PRV cell on MV wrong after recall" family)
**Date:** 2026-07-14
**Source:** owner: "the route of pgm ch1 on multiview shows without the top cropping of the layer. even though it shows correctly on the actual pgm screen consumer. why?" + "the preview on the multiviewer doesnt show exactly what it should when a look is recalled to prv."

---

## 1. Hard evidence (live, 16:0x)

- Live look ch1: L11 = playlist layer with a `crop` effect.
- Caspar stage (INFO 1): producer plays at **physical 11 (bank A)**; layers 110/111 EMPTY.
- `MIXER 1-11 CROP` → `0 0 1 1` (uncropped). `MIXER 1-111 CROP` → `0.278 0.074 0.761 1.0` (the real crop, on a producer-less layer).
- So the MV's `route://1` faithfully shows ch1: the visible layer at 11 is genuinely uncropped. The "correct" look on the PGM screen is the timeline layer 210 covering it. **The route was never the bug — the take pipeline split producer and mixer state across banks.**

## 2. Root-cause mechanism (to confirm with a failing test first)

[src/engine/scene-take-lbg-jobs.js:113-120](../../src/engine/scene-take-lbg-jobs.js): a layer judged `layerVisuallyEqual` (content+fill+effects unchanged) gets `continue` — NO job. But the take still flips `programLayerBankByChannel` ([src/engine/scene-take-lbg.js:392](../../src/engine/scene-take-lbg.js)) when OTHER layers had jobs. Consequences for the skipped layer:
- its producer stays on the OLD bank layer while the pointer now says the other bank;
- the next take that DOES stage it applies PLAY+MIXER (incl. CROP) at the new pointer's inactive bank — potentially the opposite bank from where a previous take left its mixer state;
- `clearStaleInactiveBankLookLayers` may stop the skipped layer's content or leave stale mixer values (CROP) marooned on the unused bank (today's 1-111).
Playlist advance compounds it: [scene-take-lbg-playlist.js:110](../../src/engine/scene-take-lbg-playlist.js) targets `physicalProgramLayer(n, activeBank)` — after drift, advances land on a layer whose mixer state was never set.

## 3. Tasks (haiku-sized)

- [x] T218.1 **Failing test first** (`tools/smoke/smoke-wo218-bank-drift.test.js`): two-layer look; take 1 stages both (bank flip); take 2 with layer A visually-equal and layer B changed → assert layer A's producer AND its mixer lines (CROP from effects) end up on the SAME physical layer that the post-take pointer implies, and no bank holds mixer state without a producer. Expected to FAIL at HEAD (documents the drift).
- [x] T218.2 **Fix — skipped layers must follow the flip:** when a non-merge take will flip banks, a visually-equal layer cannot be skipped outright: either (a) re-stage it on the target bank like any other job (simplest, forceCut LOADBG+PLAY same content + full mixer/effect lines — cost: producer restart on unchanged layers, which WO-155 tried to avoid), or (b) keep the skip but SWAP the producer to the target bank (`SWAP` AMCP) + re-emit its mixer/effect lines at the target layer. Prefer (b) if `SWAP <ch>-<La> <ch>-<Lb> TRANSFORMS` verifies cleanly against this Caspar build (check amcp docs/`src/caspar/` for a swap helper); fall back to (a) with a WO note.
- [x] T218.3 **Mixer-state hygiene:** after the flip, clear marooned mixer state on the vacated bank layer (`MIXER <ch>-<old> CLEAR`) so no future producer inherits stale CROP/FILL (today's 1-111 case).
- [x] T218.4 Re-run T218.1 (now green) + full take suites + gate; node --check/eslint.
- [ ] T218.5 **PRV-recall verification note:** after the fix + WO-209 (bankless PRV), recall-to-PRV should stage content+mixer at logical layers consistently — ask owner to re-check the MV PRV cell; if still mismatched, capture `INFO 2` + `MIXER 2-<L> CROP/FILL` per the §1 method and reopen.

## 4. Acceptance criteria

- [ ] A218.1 Cropped layer shows cropped on PGM screen, MV route cell, and compose preview simultaneously (owner check).
- [ ] A218.2 No bank layer ever holds mixer state without its producer after a take; gates green.

## 5. Work log

- 2026-07-14 — WO created from live split-brain evidence (producer 1-11 vs crop 1-111); supersedes WO-190's H1 (stale MV cell — refuted: the route renders ch1 faithfully).
- 2026-07-14 — **T218.1-4 completed**:
  - T218.1: Failing test `tools/smoke/smoke-wo218-bank-drift.test.js` created; demonstrates split-brain when visually-equal layer is skipped and bank flips (no SWAP, no re-stage emitted).
  - T218.2: Fix implemented using **SWAP (option b)**: src/engine/scene-take-lbg-jobs.js:45-52 track `skippedVisuallyEqualLayers` on visual-equal skip; scene-take-lbg.js:395-420 emit `SWAP <ch>-<fromPhys> <ch>-<toPhys> TRANSFORMS` before pointer flip when bank flips and layers were skipped. SWAP is safer and cleaner than re-stage (no producer restart, preserves mixer state via TRANSFORMS keyword).
  - T218.3: Mixer-state hygiene (scene-take-lbg.js:423-437): after pointer flip, emit `MIXER <ch>-<old> CLEAR` on vacated bank layers to prevent stale CROP/FILL from being inherited by next take.
  - T218.4: Full test suite: `node --test tools/smoke/smoke-wo218-bank-drift.test.js` (green); `node tools/ci/run-offline-tests.js` 194 tests (192 pass, 2 skipped server-integration tests); `node --check` syntax OK; `./node_modules/.bin/eslint --quiet` on modified files OK. Updated `tools/ci/run-offline-tests.js:57` to include new smoke test.
  - **Decision**: SWAP with TRANSFORMS (option b) preferred — Caspar helper exists (`src/caspar/amcp-basic.js:135-139`), producer ownership is atomic, no re-staging cost.
