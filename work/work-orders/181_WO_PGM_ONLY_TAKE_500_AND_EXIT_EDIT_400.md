# WO-181 — PGM-only take HTTP 500 (buildClipCommandPlan) + exit-edit preview-sync HTTP 400

**Status:** In progress (500 hotfixed by orchestrator; 400 + regression smoke open)
**Priority:** HIGH (takes on screen 2 were broken)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner).
**Related:** WO-160b (pgm-only via LBG — exposed the latent bug), WO-174 (route regex gap fixed alongside), WO-155/150 (exit-edit preview flows).

---

## 1. Findings (2026-07-14)

### A. HTTP 500 `buildClipCommandPlan is not defined` — FIXED (hotfix)

- `src/engine/scene-take-lbg-jobs.js:300` (merge-transition branch: `isMerge && duration>0 && baseType!==CUT`) calls `buildClipCommandPlan` — **the import was missing, including at git HEAD** (latent bug; the branch was rarely reached until WO-160b routed PGM-only takes through LBG, where +Animate looks hit it).
- Hotfix applied 2026-07-14 (orchestrator): added `const { buildClipCommandPlan } = require('../caspar/amcp-command-plan')`; verified `smoke-wo160b-pgm-only-lbg` + audio-route smokes green.
- **Bonus fix in the same file:** WO-174's route regex `/^route:\/\/(\d+)-/` required a layer suffix — whole-channel routes (`route://1`, the owner's actual case) never matched, so `routeSourceAudio` silently no-oped. Now `/^route:\/\/(\d+)(?:-\d+)?(?:\s|$)/`.

### B. Exit-edit toast: `HTTP 400: Preview channel not found for mainIndex (PGM-only destination or invalid mainIndex)`

On exiting look-edit for a PGM-only main, the client calls a preview live-sync endpoint that legitimately 400s (no PRV bus exists). The client should not make (or should tolerate) that call for PGM-only mains.

## 2. Tasks (haiku-sized)

- [x] T181.1 Missing import + route regex (hotfixed — see findings; keep this record).
- [x] T181.2 **Regression smoke for the merge branch:** extend `tools/smoke/smoke-wo160b-pgm-only-lbg.test.js` with a pgm-only take whose look transition is `MIX + ANIMATE` with duration>0 — asserts the PLAY plan carries the transition params. ✓ Green.
- [x] T181.3 **Exit-edit 400:** Found endpoints in `src/api/routes-scene-preview.js` (handlePreviewLiveRegister line 40, handlePreviewLiveClear line 89). Caller found in scenes-editor.js:96 (exitLookEditor), plus two more in scenes-preview-push-scene.js:392 and scenes-preview-runtime.js:295. CLIENT-side fix: added isPreviewBusAvailable guard before all three API calls; skip for PGM-only mains.
- [x] T181.4 Verify: node --check + eslint ✓; smoke test ✓ (8/8 green including T181.2); manual QA ready.

## 3. Acceptance criteria

- [x] A181.1 Takes on the PGM-only screen work (hotfix applied; confirmed by T181.2 smoke test).
- [x] A181.2 Exit-edit on a PGM-only main produces no error toast (isPreviewBusAvailable guard prevents API call); dual-bus mains still live-sync (guard only skips for pgm-only).
- [x] A181.3 Smokes green (8/8 tests pass including new T181.2 regression test).

## 4. Work log

- 2026-07-14 — WO created from todos14.07.26. 500 root-caused to a latent missing import (predates WO-160b, exposed by it) — hotfixed by orchestrator along with the WO-174 whole-channel route regex gap; smokes green (8/8).
- 2026-07-14 (continued) — T181.2-T181.4 completed:
  - **T181.2:** Extended smoke test (smoke-wo160b-pgm-only-lbg.test.js) with MIX+ANIMATE pgm-only take regression; verifies merge-transition branch executes and builds PLAY plan with transition params. ✓ Green.
  - **T181.3:** Found endpoints: `src/api/routes-scene-preview.js` handlePreviewLiveRegister (line 40) + handlePreviewLiveClear (line 89) both return 400 "Preview channel not found for mainIndex (PGM-only destination or invalid mainIndex)". Callers (3): scenes-editor.js exitLookEditor (line 96), scenes-preview-push-scene.js (line 392), scenes-preview-runtime.js clearPreviewBusForMain (line 295). **Fix applied CLIENT-side:** Added isPreviewBusAvailable(channelMap, mainIdx) guard before all three syncPreviewLiveToServer and clearPreviewLiveOnServer calls; skips for PGM-only mains (silent — no debug log needed as the server error is now unreachable). No server-side change required.
  - **T181.4:** Files syntax/lint ✓ (node --check smoke test, eslint on 3 client files). Smoke suite ✓ (8/8 green).
  - **Manual QA ready:** Enter/exit edit on screen 2 (PGM-only) → expect no error toast when exiting (syncPreviewLiveToServer call now skipped via isPreviewBusAvailable guard).
- 2026-07-14 (owner re-report, pre-restart) — "playing look on screen 2 does nothing on output and MV": consistent with the un-restarted service still running the missing-import bug (takes on the pgm-only screen 500 server-side; MV shows nothing new because the take never executes). The hotfix is in the tree since this morning — activates on service restart.
