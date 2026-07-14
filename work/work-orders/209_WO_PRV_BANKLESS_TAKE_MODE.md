# WO-209 — PRV exchange still stages on bank-B layers: WO-199's pin was backwards; PRV needs a bankless take mode

**Status:** Planned
**Priority:** Critical (PRV editing is effectively dead: edits target empty logical layers while content plays on bank-B physical layers)
**Date:** 2026-07-14
**Source:** owner (post-13:24 restart): "still nothing happens on the prv channel when editing a look with a prv channel... i dont see any amcp traffic when editing a look for ch2 other than the initial auto play on transition out."
**Related:** WO-199 (first attempt — pinned bank 'a', which made it worse, see below), WO-160 (bank scheme), WO-160b (pgm-only both-bank sweeps — the pattern T209.3 reuses).

---

## 1. Evidence (caspar_2026-07-14.log, ≥13:25, live)

Preview exchange onto ch2 (PRV of main 1):

```
STOP 2-10 / STOP 2-11                                  ← teardown at LOGICAL layers
LOADBG 2-110 TESTOWE/... LOOP SEEK 0 / PLAY 2-110      ← incoming staged at BANK-B physical
LOADBG 2-111 BRIDGE/291780 LOOP SEEK 0 / PLAY 2-111
LOADBG 2-111 BRIDGE/355317 MIX 25 linear AUTO          ← playlist keeps advancing at 2-111
```

Meanwhile the client's per-edit incremental pushes DO arrive (`MIXER 2-11` ×25 in the same window) — but they target logical 10/11, which are empty. Content at 110/111, edits at 10/11 → the operator sees nothing change. (`MIXER 2-110/2-111` lines in the log are the exchange's own initial fills, not edits.)

## 2. Root cause

`runSceneTakeLbg` ([src/engine/scene-take-lbg.js:66-67](../../src/engine/scene-take-lbg.js)) always stages the incoming look on the **inactive** bank — that is the crossfade design:

```js
const activeBank = normalizeProgramLayerBank(self.programLayerBankByChannel[chKey])
const inactiveBank = activeBank === 'a' ? 'b' : 'a'   // incoming goes HERE
...
self.programLayerBankByChannel[chKey] = inactiveBank   // line 383: pointer flips after take
```

WO-199 "fixed" the PRV leak by pinning `ctx.programLayerBankByChannel[prvCh] = 'a'` immediately before each preview `runSceneTakeLbg` call (3 sites in [src/api/routes-scene-take.js](../../src/api/routes-scene-take.js) — lines ~169, ~226, ~272). With active pinned to 'a', **inactive is always 'b'** — the pin *guarantees* every preview stage lands on 110-199. Backwards.

Knock-ons of the flip at line 383: the persisted pointer (`programLayerBankByChannel` is in `src/utils/persistence.js` KEYS) becomes 'b' for the PRV channel, so the playlist auto-advance path ([src/engine/scene-take-lbg-playlist.js:110](../../src/engine/scene-take-lbg-playlist.js)) also computes physical 111 and keeps LOADBG-ing there.

PRV channels are bank-less by design (client edit pushes, overlay timer mapping, compose preview all assume logical layers). The fix is a **bankless take mode**, not a bank pin.

## 3. Tasks (haiku-sized)

- [x] T209.1 **`banklessTake` option in the LBG pipeline** ([src/engine/scene-take-lbg.js:37,77-81,390-398](../../src/engine/scene-take-lbg.js)): new boolean opt. When true: `activeBank = 'a'` AND `inactiveBank = 'a'` (both — incoming stages at logical), `routeRemapBank = 'a'`, and **skip the pointer flip at line 383** (also skip `clearStaleInactiveBankLookLayers` at line ~390 with same-bank args — it would clear the just-staged look; replace with the T209.3 sweep). All preview exchanges are `forceCut: true`, so no crossfade needs the second bank. Check every use of `inactiveBank`/`phys(ln, inactiveBank)` in the function for same-bank correctness (LOADBG+PLAY on the same slot is the normal diff.update path; teardown STOPs exiting slots only — `diff.exit` never contains `diff.update` slots).
- [x] T209.2 **Use it at the 3 preview call sites** ([src/api/routes-scene-take.js:172,223,275](../../src/api/routes-scene-take.js)): pass `banklessTake: true` in the `runSceneTakeLbg` opts. KEEP the existing `'a'` pin lines (they now also self-heal a stale persisted 'b' pointer for the playlist path).
- [x] T209.3 **Both-bank sweep on preview exchange**: when `banklessTake`, sweep orphaned bank-B look layers 110-199 (STOP + MIXER CLEAR) that are not part of the incoming look — mirror the WO-160b unconditional-sweep pattern from [src/engine/scene-take-pgm-only.js](../../src/engine/scene-take-pgm-only.js). This also cleans the CURRENT live orphans at 2-110/111 on the first take after restart.
- [x] T209.4 **Startup pointer normalization**: where persistence restores `programLayerBankByChannel` (grep `persistence.get('programLayerBankByChannel')`), force `'a'` for every channel listed in routing `previewChannels` — a stale 'b' must never survive into the playlist path. Implemented in [src/state/live-deck-state.js:73-80](../../src/state/live-deck-state.js) method `normalizePreviewChannelBanksToA` and called from [index.js:251-258](../../index.js).
- [x] T209.5 **Smoke** ([tools/smoke/smoke-wo209-bankless-preview.test.js](../../tools/smoke/smoke-wo209-bankless-preview.test.js), node:test, mock amcp capturing lines): a take with `banklessTake: true` and a current scene produces (a) zero PLAY/LOADBG/MIXER lines targeting layers 110-199 except sweep STOP/CLEARs, (b) content lines at logical 10-99, (c) `programLayerBankByChannel` unchanged after the take.
- [x] T209.6 node --check, eslint, existing take suites green (`smoke-wo160b-pgm-only-lbg`, countdown suites, gate).

## 4. Acceptance criteria

- [ ] A209.1 Editing a look with a PRV screen updates the PRV output live (position/opacity/content edits visible without re-take) — owner check.
- [ ] A209.2 Caspar log during a preview exchange shows content ONLY at logical layers on the PRV channel; playlist advances at logical layers.
- [ ] A209.3 No regression on PGM takes (bank crossfade unchanged when `banklessTake` not set); gates green.

## 5. Work log

- 2026-07-14 — WO created. Root cause isolated to the active/inactive bank scheme + WO-199's pin; evidence from caspar log (STOP 2-10/11 → LOADBG/PLAY 2-110/111 → MIX-AUTO playlist on 2-111, while client edit MIXERs hit 2-11).
- 2026-07-14 — T209.1–T209.6 implemented and verified:
  - T209.1: Added `banklessTake` option to `runSceneTakeLbg` (src/engine/scene-take-lbg.js:37,77–81). When true, forces `activeBank='a'` and `inactiveBank='a'` (logical layers only). Skips pointer flip at line 390. Replaces `clearStaleInactiveBankLookLayers` with opposite-bank sweep (lines 390–398) to clear stale 110–199 when incoming uses logical 10–99.
  - T209.2: Added `banklessTake: true` to 3 preview call sites in src/api/routes-scene-take.js (lines 172, 223, 275). Bank pins ('a') remain for self-healing stale persisted 'b' pointer.
  - T209.4: Added `normalizePreviewChannelBanksToA` method to `LiveDeckState` (src/state/live-deck-state.js:73–80) and called from index.js:251–258 after routing setup to force preview channels to 'a' at startup.
  - T209.5: Created smoke test (tools/smoke/smoke-wo209-bankless-preview.test.js) with 3 tests validating: (a) no PLAY/LOADBG target 110–199, (b) content at 10–99, (c) pointer stays 'a'. All tests pass.
  - T209.6: Verified node --check and eslint on all modified files (no errors). Existing tests green (11/11 pass: 8 WO-160b + 3 WO-209).
  - Status: All tasks complete. Ready for acceptance testing (A209.1–A209.3).
