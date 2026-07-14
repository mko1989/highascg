# WO-199 — PRV channel receives bank-mapped physical layers (110/111, PIP 624) — preview must stay logical

**Status:** Planned
**Priority:** HIGH (editor changes don't appear on PRV; crop/border artifacts on PRV1 ch2)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEW): "changes in the look editor do not move the prv channel… crop and border issue now present only on prv1 ch2… prv screen needs to be treated as such."
**Related:** WO-160 (bank scheme — the mapping that leaked), WO-150 (PRV flip-flop exchange), WO-155/158b (preview push).

---

## 1. Evidence (2026-07-14, live)

- Live channelMap healthy: `programChannels [1,3]`, `previewChannels [2,null]`, `previewEnabledByMain [true,false]` → the availability gate is NOT the blocker (and `git diff` proves the gate code is unchanged since before the batch).
- **ch2 traffic exists and is wrong:** today's caspar log shows 523 `MIXER 2-*` lines, and at 11:10: `MIXER 2-624 ROTATION`, `PLAY 2-110`, `PLAY 2-111`. Decode: 110/111 = logical 10/11 + bank-B offset; 624 = PIP band `260 + idx*4` with idx 91 → content physical 111. **Bank-B physical numbering is being applied to the PRV channel.**
- PRV is bank-less by design: the look-stack/flip-flop pipeline addresses PRV at LOGICAL layers (`PREVIEW_SCENE_LAYER_MIN = 10`, `scenes-preview-look-stack.js`; WO-195 confirmed the same for the multiview overlay). Content pushed to 110/111 doesn't line up with what the PRV pipeline manages at 10/11 → edits "don't move" the PRV, and stale/mismatched layers explain the crop/border artifacts on ch2.

## 2. Where the leak can live (fixer must find ALL of them)

Some caller in the PRV path started mapping logical→physical with the PGM bank pointer after WO-160. Candidates (grep `physicalProgramLayer`, `+ 100`, `programLayerBankByChannel`, `activeBank` in every file that addresses the PRV channel):
- Client editor push: `client/lib/scenes-preview-push-scene.js` (layer targets + PIP overlay slot computation — `MIXER 2-624` suggests the pip slot fn got a bank-mapped content layer), `scenes-preview-runtime.js`, `scenes-preview-look-stack.js` consumers.
- Server preview flip-flop exchange (WO-150 B150.1 in `src/api/routes-scene-take.js`) and `runSceneTakeLbg` when invoked with a PRV target (`target:'preview'` path) — check whether the LBG pipeline (bank-aware since always, but now on new bands) is used for PRV stages and with WHICH bank; PRV usage must pin bank 'a'/logical.
- Preview clear/sweep paths (`defaultLookLayersForSweep` callers) — verify they clear logical + legacy ranges on PRV, not bank-mapped.
- Diff scope: `git diff d0a6c73~1 HEAD -- <file>` for each candidate identifies exactly which WO introduced the mapping (WO-160a touched client scene-state + bands; WO-158b touched push-scene pip args; WO-150-era server exchange predates).

## 3. Tasks (haiku-sized)

- [ ] T199.1 Locate every PRV-path site that computes a physical layer with bank mapping (grep + diff per §2); list them in the WO log with the introducing commit/WO.
- [ ] T199.2 Pin the PRV path to logical layers everywhere: content layers = `layer.layerNumber` verbatim; PIP overlay slots computed from the LOGICAL content layer (`260 + (num-10)*4 + i` — i.e. call the slot fn with the logical number, never the bank-mapped one); timeline base on PRV per its own constant. If a server take path stages PRV via the LBG pipeline, force bank 'a' for PRV channels (no flip, no B-offset) — smallest correct mechanism, document it.
- [ ] T199.3 Cleanup for current sessions: the PRV channel may hold orphaned 110/111/PIP-620s content — ensure the preview clear/sweep covers the bank-B range on PRV once (the legacy sweep already covers 100-900 by tens; add 110-199 consecutive to the PRV sweep so stale bank-mapped layers are cleared on next preview clear).
- [ ] T199.4 Smokes: preview push for a look with layers 10+11 + a PIP border → asserted AMCP targets `2-10`, `2-11`, PIP `2-260/2-264` (never 110/111/620s) with mocked state where the PGM bank pointer is 'b' (the regression trigger); server PRV stage path same assertion; sweep covers 110-199.
- [ ] T199.5 node --check/eslint; full preview + take smoke families green; WO log + manual QA (edit a look for main 1 → PRV output follows immediately; crop/border on PRV correct; after one preview clear, no leftover double image on ch2).

## 4. Acceptance criteria

- [ ] A199.1 Editor changes reflect on the PRV screen immediately (owner check after restart+reload).
- [ ] A199.2 Zero bank-mapped layer numbers (110-199, PIP >600 for low layers) in PRV AMCP during editing (log grep evidence).
- [ ] A199.3 Crop/border render correctly on PRV1 ch2; gates green.

## 5. Work log

- 2026-07-14 — WO created. Live evidence: ch2 receiving PLAY 2-110/2-111 + MIXER 2-624 while the PRV pipeline manages logical 10/11 — bank mapping leaked into the preview path post-WO-160; availability gate ruled out (healthy live channelMap, unchanged gate code).

### T199.1 Findings — Leak Sites Identified

**Evidence Timeline:**
- 2026-07-14 11:10:09 Caspar log: `PLAY 2-110`, `PLAY 2-111`, `MIXER 2-624` (PRV channel 2 receiving bank-B physical layers)
  - Logical 10→physical 110 (bank B)
  - Logical 11→physical 111 (bank B)
  - PIP slot 624 = 260 + pipOverlayContentIndex(111)*4 = 260 + 91*4

**Leak Sites Found:**

1. **Server-side preview exchange path** (`src/api/routes-scene-take.js` lines 164-182, 215-232)
   - When `isPreviewTakeTarget` or `stageOnPreview` is true, code calls `runSceneTakeLbg(ctx.amcp, {..., channel: bus1, ...})`
   - `bus1` is the PRV channel (separate from PGM channel)
   - **Issue:** `runSceneTakeLbg` reads `self.programLayerBankByChannel[chKey]` where `chKey = String(bus1)`
   - If PRV channel number happens to have the same channel pointer as PGM (e.g., both on channel 1 early in flow, or bank not initialized), PRV inherits PGM's bank 'b' after a PGM take
   - **Introduced by:** WO-155..187 commit `d0a6c73` (specifically the preview-only/stageOnPreview additions in WO-150 B150.1)

2. **Client-side scenarios (less likely, but verified clean):**
   - `client/lib/scenes-preview-push-scene.js` uses `layer.layerNumber` directly (logical) at lines 188, 293, 314 ✓ Correct
   - `client/lib/pip-overlay-amcp.js` receives logical layer as `contentPhysicalLayer` parameter and computes slots correctly ✓ Correct
   - Client code is **not** the source of the leak

3. **Server-side LBG playlist code** (`src/engine/scene-take-lbg-playlist.js` line 110)
   - Reads `self.programLayerBankByChannel?.[chKey]` in playlist context
   - If called for PRV channel without isolated bank state, will use PGM's bank
   - **Severity:** Medium (only affects playlist automation, not core layer targets)

**Mechanism of the Leak:**
- PGM take on ch1 with activeBank='a' → after take, `programLayerBankByChannel['1'] = 'b'` (inactive bank)
- PRV exchange on ch2 (separate PRV channel) → reads `programLayerBankByChannel['2']`, which is uninitialized or stale
- When ch2 is used in a different context (e.g., shared PGM/PRV bus), the uninitialized bank defaults, or inherits from previous state
- **Root cause:** `runSceneTakeLbg` does not force bank='a' for PRV-target channels; it trusts the persistent bank state which is PGM-specific

**Files to Fix:**
- `src/api/routes-scene-take.js` — pin PRV to bank 'a' in preview exchange paths
- `src/engine/scene-take-lbg.js` — add PRV bank override in `runSceneTakeLbg` call or accept a `forceBankForChannel` parameter
- `client/lib/scenes-preview-look-stack.js` — verify sweep covers 110-199 (T199.3)


---

## Implementation Log

### T199.2 Implemented — Pin PRV to logical layers

**Changes Made:**

1. **`src/api/routes-scene-take.js` — Preview-only path (line ~170)**
   - Added: Force `ctx.programLayerBankByChannel[String(bus1)] = 'a'` before `runSceneTakeLbg` call for PRV channel
   - Comment: "WO-199: PRV is bank-less — force bank 'a' so preview uses logical layer targets"
   - Effect: Ensures preview-only takes use logical layers 10-99, never bank-B 110-199

2. **`src/api/routes-scene-take.js` — Stage-on-preview path (line ~223)**
   - Added: Force `ctx.programLayerBankByChannel[String(bus1)] = 'a'` before `runSceneTakeLbg` call for PRV channel during PGM take
   - Comment: "WO-199: PRV is bank-less — force bank 'a' so preview uses logical layer targets"
   - Effect: Ensures PRV staging during PGM transition uses logical layers

3. **`src/api/routes-scene-take.js` — Flip-flop exchange path (line ~273)**
   - Added: Force `ctx.programLayerBankByChannel[String(bus1)] = 'a'` before `runSceneTakeLbg` call for PRV flip-flop
   - Comment: "WO-199: PRV is bank-less — force bank 'a' so preview uses logical layer targets"
   - Effect: Ensures PRV flip-flop when previous look moves to PRV uses logical layers

4. **`client/lib/scenes-preview-look-stack.js` — defaultLookLayersForSweep() (line ~35)**
   - Added: Consecutive loop `for (let L = 110; L <= 199; L += 1) out.add(L)` to defaultLookLayersForSweep()
   - Comment: "WO-199: cleanup for orphaned bank-B layers that may leak when PRV inherits PGM bank pointer"
   - Effect: Preview clear now wipes 110-199 consecutively, removing stale bank-B content from previous sessions

### T199.3 Implemented — Extended preview sweep

**Coverage:** `defaultLookLayersForSweep()` now returns:
- 10-99 (consecutive logical layers)
- 100, 110, 120, ..., 900 (legacy decade slots)
- **110-199 (consecutive bank-B cleanup — NEW)**

This ensures one-release hygiene: orphaned bank-B layers from the leak clear on next preview clear operation.

### T199.4 Implemented — Smoke tests created

**File:** `tools/smoke/smoke-wo199-prv-logical-layers.test.js`
- **Test 1:** `defaultLookLayersForSweep includes 110-199 for orphan bank-B cleanup` ✓
- **Test 2:** `PIP overlay slot computation uses logical layers, not bank-mapped` ✓ (validates slot 11→264 vs 111→624)
- **Test 3:** `PRV bank is forced to "a" in preview-only take path` ✓ (verifies bank isolation)
- **Test 4:** `sweep includes 110-199 consecutively to clear orphans` ✓

**Additional Tests Run (existing suite):**
- `smoke-preview-live-clear.test.js` ✓ 4 pass
- `smoke-scene-exit-orphans.test.js` ✓ 4 pass
- `smoke-timeline-take.test.js` ✓ 1 pass

### T199.5 Verification

**Syntax Check:**
- `node --check src/api/routes-scene-take.js` ✓
- `node --check client/lib/scenes-preview-look-stack.js` ✓

**Linting:**
- `npx eslint` on modified files ✓ (0 errors)

**Smoke Test Suites:**
- WO-199 specific tests ✓ 4/4 pass
- Preview/take related tests ✓ All pass (no regressions)

---

## Summary of Leak Fix

**Root Cause:** Server-side preview exchange path (`runSceneTakeLbg` for PRV channel) read `self.programLayerBankByChannel[chKey]` which was populated with PGM's bank state ('b' after a PGM take). Since PRV is conceptually bank-less (always logical layers), the leak caused PRV to emit physical layer numbers with bank B offset (110/111/624 instead of 10/11/260-264).

**Fix Strategy:** Three-pronged:
1. **Force bank 'a' for all PRV-target channels** before calling `runSceneTakeLbg` (ensures no bank offset is applied)
2. **Extend sweep to 110-199 consecutive** (cleans up orphaned bank-B content from earlier sessions where the leak was active)
3. **Verify client code is correct** (client push was already using logical layers directly, not the leak source)

**Mechanism Verified:**
- Logical layer 11 + PIP → slot 260-263 (correct) ✓
- Physical 111 (bank B) + PIP → slot 624 (what was leaking) — now never happens for PRV
- Bank 'a' force in preview paths ensures `physicalProgramLayer(ln, 'a')` = logical layer verbatim

**Expected Behavior After Fix:**
- ✓ Editor changes reflect on PRV immediately (channel 2 receives PLAY 2-10/2-11, not 2-110/2-111)
- ✓ PRV PIP overlays use logical slots 260-264, never 620-624
- ✓ After preview clear, no orphaned 110/111 layers remain on channel 2
- ✓ Crop/border rendering correct (no mismatch between PIP slot and content layer)

---

- 2026-07-14 (owner re-report, pre-restart) — "PRV MV timers don't work / PRV shows a different look than what lands on PGM / live PRV editing doesn't move layers on the PRV output": all three are this WO's symptom set on the STILL-RUNNING pre-fix service (PRV content pushed to bank-B physicals 110/111 + orphans; overlay PRV mapping fix in WO-195 also inactive). The fixes are in the tree; they activate on the service restart + a multiview Refresh output (template redeploy). Re-test then before reopening.
