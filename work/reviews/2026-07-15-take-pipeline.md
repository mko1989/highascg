# Take Pipeline / Bank Engine Review — 2026-07-15

Scope: WO-160 (+160b), WO-181, WO-199, WO-209, WO-211, WO-217, WO-218.
Method: read each WO in full; verified claimed changes at claimed file:line; ran named smokes; adversarially read scene-take-lbg.js, scene-take-lbg-jobs.js, scene-take-lbg-merge.js, scene-take-lbg-playlist.js, scene-take-pgm-only.js, scene-take-lbg-amcp-pipeline.js, scene-exit-layers.js, look-layer-ranges.js, routes-scene-take.js, routes-scene-preview.js, app-context.js, live-deck-state.js, index.js, client guard sites; read-only live probes against the running box (`/api/state`, `/api/raw` query-form AMCP only).

## Verdict table

| WO | Verdict | Notes |
|---|---|---|
| WO-160 (+160b) | VERIFIED | Band SSOT (`look-layer-ranges.js`), PIP compact-index formula (`pip-overlay-utils.js`), pgm-only routed through LBG bank pipeline, `scene-take.js` deleted, dead-code claims true. `smoke-wo160-layer-bands` (21) + `smoke-wo160b-pgm-only-lbg` (7/7 here) all green. |
| WO-181 | VERIFIED | `buildClipCommandPlan` import present (scene-take-lbg-jobs.js:6); route regex fixed (line 167, matches whole-channel + layer-suffix routes); `isPreviewBusAvailable` guard present at all 3 claimed client sites (scenes-editor.js:99, scenes-preview-push-scene.js:393, scenes-preview-runtime.js:295 `clearPreviewBusForMain`). Routes `/api/scene/take` and `/api/scene/live/preview*` are registered (wildcard `POST /api/scene/*` in router.js:385 plus explicit `/clear` route at 383-384) — no unregistered-route problem. |
| WO-199 | VERIFIED (superseded by WO-209, as documented) | The three `ctx.programLayerBankByChannel[bus1]='a'` pin lines and the `defaultLookLayersForSweep` 110-199 sweep both exist exactly as logged. WO-199's own work log correctly flags itself as backwards; WO-209 supersedes it. |
| WO-209 | VERIFIED, with one real gap (see Finding 1) | `banklessTake` opt implemented (scene-take-lbg.js:70-77, 393-465); 3 call sites wired (routes-scene-take.js:180, 232, 285); startup normalization wired (`live-deck-state.js:74-80` + `index.js:247-257`). `smoke-wo209-bankless-preview` 3/3 pass. **Gap:** call site 1 (line 172-181, `previewOnly` branch) passes `forceCut: !!b.forceCut` instead of hardcoding `true` like the other two sites — the WO's own root-cause note ("all preview exchanges are forceCut:true") is not actually enforced there. Currently unreachable from the shipped client (verified: the only client caller, `pushSceneToPreviewViaServer`, always passes `forceCut:true` at every call site) but reachable via direct API call. |
| WO-211 | VERIFIED | LOOP leak fix at scene-take-lbg-jobs.js:184-186 (multi-item list forces `isLoop=false`); manual-advance/playlist-advance paths confirmed not to leak LOOP; `shouldForceAdvance` pure predicate correctly reads `layerOsc.file.elapsed/duration` (matches `osc-state.js:387-388` field names, not the wrong `playback.position` pattern); watchdog PLAY call uses `self.amcp.play(channel, pLayer)` which exists (`amcp-basic.js`). All 9 WO-211 smoke tests pass. |
| WO-217 | VERIFIED | `buildMergeOutgoingOpacityDeferLines` now takes `activeBank`/`phys`, excludes `incomingPhys` from the fade set (scene-take-lbg-merge.js:28-58); called with those params from scene-take-lbg.js:301-303. Opacity emission made unconditional (scene-take-lbg-jobs.js:245-248, guarded by `incomingStartsHidden` correctly, not by a `!=1` check anymore). 3/3 smoke pass. |
| WO-218 | VERIFIED | SWAP block runs strictly before the pointer flip and is mutually exclusive with `clearStaleInactiveBankLookLayers` (merge-only) — no ordering hazard. `shouldFlipBank` excludes both `isMergeTransition` and `banklessTake`, so the SWAP path can never fire for banklessTake — confirmed **no degenerate `SWAP 1-10 1-10`** is possible (also defensively guarded by `if (fromPhys !== toPhys)`). `SWAP ... TRANSFORMS` raw string matches the typed helper's format (`amcp-basic.js:135-139`). 1/1 smoke passes. **Live probe found the exact split-brain pattern this WO targets is still visible in current air state** — see Finding 1 in bugs below (root cause is a persistence gap, not this WO's take-time logic; the take-time fix itself is verified correct). |

## Ranked findings

### 1. `programLayerBankByChannel` persisted-to-disk state is desynced from live runtime state RIGHT NOW (High — restart-time outage risk, live-observed)

Live probe evidence (read-only, `/api/state` + query-form `INFO`/`MIXER ... CROP`):
- Runtime (in-memory, from `/api/state`): `programLayerBankByChannel: {"1":"b","2":"a","3":"a"}`.
- On-disk (`/home/casparcg/highascg/.highascg-state.json`, checked twice, ~2 min apart, no drift): `{"3":"a"}` — channels `1` and `2` are **entirely missing**.
- `INFO 1-11` / `INFO 1-111` confirm the runtime value is the one matching reality: layer 11 (bank A) is empty, layer 110/111 (bank B) hold the actual producers (`PROJECTS/TETST/02_BUMPER`, `BRIDGE/291780`) matching live look "Look 6"'s layers 10/11 — i.e. channel 1 really is on bank `b`.

If the Node process restarts right now, `LiveDeckState` rehydrates `programLayerBankByChannel` from disk (`{"3":"a"}`), so channel 1 would default to bank `a` while Caspar's actual on-air content still sits on bank-B physical layers 110/111 — this is precisely the split-brain WO-218 was written to prevent, except caused by a **persistence gap** rather than a same-take skip-logic gap, so WO-218's SWAP/CLEAR fix does not cover it.

`persistProgramLayerBanks()` runs unconditionally at the end of every `runSceneTakeLbg` call (scene-take-lbg.js:421) and `programLayerBankByChannel` is in `IMMEDIATE_KEYS` (synchronous flush, `persistence.js:117-118`), so in normal operation the disk copy should track the live object (same reference) after every take. The disk file's mtime did advance during this review session (some other key flushed) without picking up the correct bank map, which means the gap predates that flush.

**Likely contributing factor, disclosed for transparency:** while running the required smoke tests (`node --test .../smoke-wo218-bank-drift.test.js` etc.) in this session, one test's mock `self` object lacks `self.liveDeck`, so `persistProgramLayerBanks()` fell through to the raw-persistence branch (`scene-transition.js:26-34`) and wrote directly to `require('../utils/persistence')` — which resolves to the **same on-disk file the live production server uses** (`REPO_ROOT/.highascg-state.json`), since tests run from the same repo root as the live service. This produced a directly observed `ENOENT` on `rename '.highascg-state.json.tmp' -> '.highascg-state.json'` during the test run — i.e. a live cross-process race on the same state file. The live file's own mtime/content was not corrupted by this (rename failed, so the real file was untouched), but it is strong evidence that **any smoke test run against this checkout can race the live server's persistence writes**, which is a plausible explanation for how channels 1/2 dropped out of the persisted map.

**Recommended fix (two parts, not applied — read-only review):**
1. Immediate/operational: trigger a normal take on channel 1 (or channel 2) to force a fresh `persistProgramLayerBanks()` flush, or otherwise re-sync disk before any planned restart.
2. Structural: smoke tests that can reach `persistProgramLayerBanks` / `persistence.set` must not use the real `REPO_ROOT/.highascg-state.json`. Either inject a mock `self.liveDeck`/`self.persistence` in every take-related smoke test, or make `src/utils/persistence.js` honor an env override (e.g. `HIGHASCG_STATE_FILE`) that test runs set to a scratch path. Grep smoke tests that build a bare `self` object and call into `runSceneTakeLbg` / `persistProgramLayerBanks` for the same gap.

### 2. WO-209 `banklessTake` + non-forced `forceCut` is a latent, not-currently-reachable gap (Medium)

`src/api/routes-scene-take.js:172-181` (the `previewOnly && bus1 != null` branch) passes `forceCut: !!b.forceCut` to `runSceneTakeLbg` with `banklessTake: true`, unlike the other two banklessTake call sites (lines ~229, ~282) which hardcode `forceCut: true`. WO-209's design assumption ("All preview exchanges are forceCut: true, so no crossfade needs the second bank") is therefore not actually true for this specific site.

Traced the consequence if `forceCut` were ever `false` here with `fadeDur>0` and existing PRV content (`shouldRunBankCrossfade=true`, `activeBank===inactiveBank==='a'`): the crossfade math in `scene-take-lbg-amcp-pipeline.js:228` (`if (pIn === pOut) continue`) and the `takeJobLogicalNums.has(ln)` exclusion at line 252 both correctly no-op for the same-bank case, so this does **not** reproduce a self-blank (WO-217-style) bug. The actual symptom would be milder: the take silently drops the requested transition (falls through to `sendPhasedTakePlays`, a hard cut) instead of the fade the caller asked for on that PRV layer — a UX/spec mismatch, not an outage.

Verified with a research pass that the only client caller of this branch (`pushSceneToPreviewViaServer` in `scenes-preview-runtime.js`) always passes `forceCut: true` literally at every call site, so this is not reachable through the shipped UI today — but it is reachable by any direct API caller (automation, future client code, `curl`) that posts `target:'preview'` without `forceCut`. Recommend hardcoding `forceCut: true` at this site too (matching the other two), for the same defense-in-depth reason WO-209 T209.2 gives for keeping the bank-'a' pin lines ("self-heal a stale ... pointer").

### 3. Smoke-test / live-persistence isolation gap is systemic, not a one-off (Medium — process risk)

Generalizing Finding 1: any future smoke test (or ad hoc `node -e` / debugging script) invoked from an agent's shell against `/home/casparcg/highascg` risks silently writing to the live box's `.highascg-state.json` whenever it constructs a bare `self`/`ctx` object without `.liveDeck` and exercises a code path that calls `persistProgramLayerBanks`, `persistence.set(...)`, or similar (grep shows several engine files fall back to `require('../utils/persistence')` directly when `self.liveDeck` is absent — this is a repo-wide pattern, not specific to one WO). This is a standing hazard for this repository's testing setup on a live box and should be fixed at the persistence-module level (env-overridable state file path) rather than by trusting every test author to mock correctly.

## Smoke test results (as run this session)

```
node --test tools/smoke/smoke-wo209-bankless-preview.test.js tools/smoke/smoke-wo211-playlist-loop.test.js \
  tools/smoke/smoke-wo217-self-blank-guard.test.js tools/smoke/smoke-wo218-bank-drift.test.js \
  tools/smoke/smoke-wo160b-pgm-only-lbg.test.js
→ 23/23 pass

node --test tools/smoke/smoke-wo160-layer-bands.test.js tools/smoke/smoke-wo160b-pgm-only-lbg.test.js
→ 29/29 pass (5 suites)
```

No `git` history / diff tooling available (not a git repo per env) — verification was done by direct file:line inspection against each WO's claims rather than `git diff`.
