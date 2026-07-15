# INFRA/SYSTEM/MISC Work Order Review — 2026-07-15

Scope: spot-check of WO-155,157,158,159,161-168,170-180,182-185,187,188,189,194,197,198; deep-check of WO-193,200,202,214,216 (recent/higher risk). Read-only throughout — no code edited, no services restarted/mutated, GET-only live probes.

## Gate results

**`node tools/ci/run-offline-tests.js`** (curated CI bundle): **202 tests, 200 pass, 0 fail, 2 skipped, 0 cancelled.** 15.28s. The 2 skips are intentional/labeled (`WsClient reconnects after server kill+restart` and `sendAmcp rejects on timeout` — both explicitly "run locally without CI=1", not failures).

**Aggregated smoke run** — every smoke test file any WO in scope mentioned, deduped (57 files), run in one `node --test` invocation: **375 tests, 362 pass, 12 fail, 1 skipped.** None of the 12 failures are in files that belong to the CI gate above (all 57 files were cross-checked against `tools/ci/run-offline-tests.js`'s `FILES` list — zero overlap with the 6 failing files), so the official gate is unaffected. Failing files and root cause:

| File | Failing tests | Root cause |
|---|---|---|
| `smoke-amcp-offline-migration.test.js` | 1 | Pre-existing, disclosed in WO-155's work log (unrelated CG-clear assertion). |
| `smoke-compose-preview-dirty.test.js` | 1 | Pre-existing, disclosed in WO-155/159 logs (PNG-vs-JPEG content-type stem-match, WO-144-documented). |
| `smoke-config-generator-routing.js` | 1 | Pre-existing, disclosed in WO-161/172 logs (`<consumers/>` self-close expectation never matched by generator). |
| `smoke-host-live-caspar-config.test.js` | 1 | Pre-existing, disclosed in WO-161/172 logs (fixture drift, unrelated `extraLiveSources`/webpage_host assertion). |
| `smoke-mixer-effects-catalog.test.js` | 3 | Pre-existing, disclosed in WO-158's log (ROTATION vs ANCHOR AMCP line-builder mismatch; verified pre-existing on a pristine worktree, out of WO-158 scope). Real product bug, but not owned by any WO in this review's scope. |
| `smoke-stream-output-project-sync.test.js` | 3 | Pre-existing, disclosed in WO-172's log — `syncStreamOutputsToDeviceGraph`/`hardwareConfigHasStreamOperatorData` don't exist anywhere in `src/`/`client/` (confirmed by grep) — dead/stale test referencing removed functions, unrelated to WO-172. |
| `smoke-live-audio-capture.test.js` | 2 | **New finding, not disclosed by any WO** — see Bug #2 below. WO-164's 2026-07-13 work log claims "all 17 pass, no regressions" for this file; it no longer holds as of this review. |

Every one of the 57 smoke test paths mentioned across the reviewed WOs exists on disk (no phantom test claims found).

## Live read-only probes

Initial probes against `localhost:8001` (`/api/state`, `/api/timers/list`, `/api/system/hardware`, `/api/system/time`) all 404'd — turned out port 8001 is **Bitfocus Companion's** admin server (`node-runtimes/main/bin/node main.js --admin-port 8001`), not HighAsCG. The actual HighAsCG server is PID 1280885 (`/usr/bin/node /home/casparcg/highascg/index.js`) listening on **port 4200**. Re-probed there:

- `GET /api/state` → 200
- `GET /api/timers/list` → 200
- `GET /api/system/time` → 200 (used for WO-193 verification below)
- `GET /api/system/hardware` → connection error (curl exit, no HTTP response) — not investigated further per read-only/no-mutation scope; worth an owner look but not concluded to be a code defect from a single GET.

## Verdict table

| WO | Verdict | Note |
|---|---|---|
| 155 | VERIFIED | Snapshot key-symmetry + PRV deck-thumb redraw match code; owner-gated ACs correctly left unchecked. |
| 157 | SPOT-OK | UI-only "screens row" change matches; engine fan-out correctly scoped out and unchecked. |
| 158 | VERIFIED | Crop helper + 8 DOM drag handles present; pre-existing mixer-effects-catalog failure honestly disclosed. |
| 159 | VERIFIED | Truncate/staleness/blocklist-reset all present; ACs honestly left unchecked (no live restart performed). |
| 161 | VERIFIED | Atomic write, save-serialization, configVersion all present; owner-gated deletions correctly unchecked. |
| 162 | VERIFIED | Scanner config path fix confirmed; `casparcg-scanner.service` observed live/active. |
| 163 | VERIFIED | Map fully removed, no dangling route/build step. All ACs correctly checked. |
| 164 | DISCREPANCY | Fix itself (OSC-staleness gate) verified correct in code, but the log's "17/17 pass" smoke claim no longer holds — see Bug #2. |
| 165 | SPOT-OK | Code matches; Status header stale ("Planned" despite being implemented) — cosmetic. |
| 166 | DISCREPANCY | Code exists but AC checkboxes ([x]) contradict their own text ("QA testing required", "gates green" claimed without a test:ci run). |
| 167 | SPOT-OK | Implementation matches; minor "gates green" overclaim (only node --check/eslint run, not test:ci). |
| 168 | VERIFIED | Exclude-list slimming and leak-guard assertions all present; caveats honestly inlined. |
| 170 | DISCREPANCY | Companion module files exist but ACs checked while text says "needs live Companion QA"; version drift noted (1.0.2 claimed in log vs 1.0.3 now shipped). |
| 171 | SPOT-OK | Extensive real implementation; independently confirmed a flagged pre-existing dead-code issue in previs-settings-panel.js. |
| 172 | VERIFIED | Most rigorous WO in the batch; transparently disclosed 3 pre-existing unrelated smoke failures (matches this review's own findings). |
| 173 | VERIFIED | Batched AMCP send confirmed; minor hardcoded-fps TODO noted, not a correctness bug. |
| 174 | VERIFIED | Route audio-channel-pick logic matches spec exactly. |
| 175 | VERIFIED (bookkeeping DISCREPANCY) | FTB fix correct in code; all task/AC checkboxes left unchecked despite work log claiming completion. |
| 176 | SPOT-OK | Pure placeholder WO, nothing to verify, correctly represented. |
| 177 | VERIFIED | Whitelist + recent-edit guard present and match log; manual-QA items correctly unchecked. |
| 178 | VERIFIED | Slider opt-in present in both widgets; Manual-QA checklist unchecked but non-blocking. |
| 179 | VERIFIED | All 4 features (slot-listen default, transform helpers, mirror UI, sampling) present. |
| 180 | SPOT-OK | Pure research WO, zero code changes, correctly represented as not-started. |
| 182 | VERIFIED | CPU-of-machine normalization matches code and smoke fixtures exactly. |
| 183 | SPOT-OK | Client rendering claims verified; server-side "no changes needed" claim taken on faith, not independently re-derived. |
| 184 | VERIFIED | Guard/atomic-write/cleanup/retry logic all present. |
| 185 | VERIFIED | Root-cause fix (scope-aware Take/Cut) matches description precisely. |
| 187 | VERIFIED | New template-thumb module wired correctly into both consumers. |
| 188 | DISCREPANCY (minor) | All 6 tasks checked `[x]` while all 3 ACs remain `[ ]` (hardware-dependent, honestly so) — Status header still "Planned", consistent overall. |
| 189 | VERIFIED | Hardware summary aggregator/route/client/smoke all present. |
| 193 | DISCREPANCY (bug found) | Auth-ordering is sound (server enforces password before mutation, no bypass) — but see Bug #1: a `ReferenceError` on every successful POST. |
| 194 | VERIFIED | Fail-open logging + LOG_DIR fallback + hardlink-free install all match; ACs correctly unchecked (next-boot dependent). |
| 197 | SPOT-OK | Tabs implementation matches; one AC checked despite its own "(owner check after reload)" caveat — minor. |
| 198 | VERIFIED (bookkeeping DISCREPANCY) | All 4 described fixes genuinely in code; Status/checkboxes never flipped from "Planned"/unchecked despite log claiming full completion+testing. |
| 200 | VERIFIED | Zero `new Function`/`eval` in `client/` app source (only hits were in vendored `client/node_modules/.vite/deps/grapesjs.js`, correctly out of scope). Whitelist regex + identifier-free grammar give real defense in depth; smoke test explicitly covers adversarial inputs. |
| 202 | SPOT-OK | Both hotfixed bugs (destructive innerHTML skeleton, dead 304 check) genuinely fixed. Gap: neither fix has regression-test coverage; client never explicitly sends If-None-Match (relies on implicit browser HTTP caching, unverified via real browser trace). |
| 214 | DISCREPANCY (bug found) | The specific bug WO-214 claims to have fixed (`programChannels?.[screenIdx]`) is genuinely fixed. But see Bug #3: `screenIdx: null` ("all screens") is mishandled nearby, and the smoke test is string-grep-only, not behavioral. |
| 216 | VERIFIED | `node --test test/wol-packet.test.js`: 15/15 pass. package.json + manifest both 1.0.3. tgz artifact confirmed (78,511 bytes). WoL packet construction (6×0xFF + 16×MAC) correct. |

## Ranked real bugs

**1. `src/api/system-time.js:179` — `ReferenceError` crashes every successful system-time POST (NTP toggle or manual time set), after the sudo mutation already ran.** (WO-193)
`handleSystemTimePost(body, ctx)` names its second parameter `ctx`, but line 179 reads `isTimePasswordRequired(_ctx)` — `_ctx` only exists as a parameter name in the sibling `handleSystemTimeGet(_ctx)`. The throw happens *after* `execFileSync('sudo', ...)` (lines 132-159) already changed the system clock / NTP mode, so the underlying change succeeds but the handler's catch block (line 182) returns a 409 error to the client. Every successful time change currently looks like a failure to the operator. Independently reproduced by reading the file (confirmed `_ctx` has no binding in `handleSystemTimePost`'s scope). Directly contradicts WO-193's own "Verified" claim for A193.1.
**Fix:** change `isTimePasswordRequired(_ctx)` to `isTimePasswordRequired(ctx)` at line 179. Also worth adding a POST-path smoke test — the existing `smoke-system-time.test.js` (16 tests) only covers `parseTimedatectlOutput` fixtures and CLI-arg validation, never calls `handleSystemTimePost` itself, which is why this shipped undetected.

**2. `src/config/live-audio-input.js:143-156` (`listPortAudioHwIdentities`) reads the box's live `config/casparcg.config` file even when the caller passes a fully-specified mock config — production behavior (and smoke test outcomes) silently depend on live system state instead of the passed cfg.** (surfaced via WO-164's smoke claim)
`resolveLiveAudioCaptureBaseUri` → `listPortAudioHwIdentities` parses `<portaudio><device>`/`<device-name>` out of whatever file `configPath` points to and unions it into the "PortAudio hw identities" set regardless of what `cfg.default_alsa_card`/`default_alsa_device` say. `tools/smoke/smoke-live-audio-capture.test.js` uses `cfgBase.configPath = config/casparcg.config` (the box's real, live config) to keep its fixtures "realistic," but that means the test's "different card" scenario (line 41-49, `live_audio_input_1_device: 'alsa://hw:2,0'`) silently breaks whenever the live box's actual PortAudio device happens to also be `hw:2,0` — which it currently is (confirmed: `grep -A3 '<portaudio>' config/casparcg.config` → `<device>hw:2,0</device>`). Reproduced in isolation (`node --test tools/smoke/smoke-live-audio-capture.test.js` fails the same 2 assertions standalone, not just in the combined run). This is exactly why WO-164's 2026-07-13 log claim ("re-ran ... smoke-live-audio-capture.test.js ... all 17 pass") no longer holds today — not because of a WO-164 regression, but because the live config file's PortAudio device changed sometime after 2026-07-13 (plausibly during WO-166's live-audio-device-swap work, also in this batch) and flipped this test's fixture premise.
**Fix:** point the smoke test at a fixture XML file rather than the live `config/casparcg.config`, and/or have `listPortAudioHwIdentities` only consult the on-disk XML when the caller doesn't already provide device identity via `cfg` fields — otherwise any future live hardware/config change on this box will keep silently flipping this test (and could plausibly cause a real capture path to unexpectedly force dsnoop mode on production once the live PortAudio device happens to collide with the input device's card number).

**3. `client/lib/audio-mixer-rows.js:75` — `sendTo.screenIdx ?? 0` collapses the legitimate "send timeline to all screens" sentinel (`screenIdx: null`) to screen 0, so program-timeline audio mixer strips silently go missing for every program screen except the first when a timeline is sent to "All."** (WO-214)
`normalizeTimelineSendTo` (`src/engine/timeline-playback-helpers.js:155-168`) and its client twin both legitimately produce `screenIdx: null` for "all screens," and downstream AMCP-send code (`src/engine/timeline-playback-amcp-send.js:367,376`, `src/engine/timeline-take.js:116-118`) explicitly branches on `=== null` to loop over all screens. `getActiveTimelineForChannel` in `audio-mixer-rows.js:75-78` does not: it does `sendTo.screenIdx ?? 0`, then indexes `cm.programChannels?.[screenIdx]` — so only the program channel at index 0 will ever match, and every other program channel's mixer view silently omits timeline-clip audio strips even though the timeline is genuinely live there. WO-214's own smoke test (`smoke-wo214-timeline-mixer-rows.test.js`) does not catch this: it only does `String.includes()` checks against the raw source text (confirmed by reading the file — no import of `getActiveTimelineForChannel`/`collectProgramAudioRows`, no stubbed `stateStore`), so it would pass even with this bug present.
**Fix:** in `getActiveTimelineForChannel`, when `sendTo.screenIdx === null`, check membership across all of `cm.programChannels` rather than defaulting to index 0. Follow-up: replace the smoke test with one that actually calls `collectProgramAudioRows` against a stubbed `stateStore`, including a `screenIdx: null` case, per WO-214's own original task spec (T214.4).

**4. (Lower priority, pre-existing/disclosed, not caused by any WO in this batch) `smoke-mixer-effects-catalog.test.js` — ROTATION effect dispatches `MIXER ... ROTATION 45` where the line-builder used elsewhere in the app expects `MIXER ... ANCHOR 0.5 0.5`.** Both WO-158 and this review confirm this is pre-existing (fails on a pristine worktree) and out of scope for the batch reviewed here, but it is a live, reproducible AMCP-command mismatch for the mixer-effects REST endpoints and is worth a dedicated WO.

## Notes on checkbox hygiene (lower severity, pattern across several WOs)

Several WOs (166, 170, 175, 188, 197, 198) check acceptance-criteria or task boxes `[x]` while the adjacent text says something is still pending (owner QA, hardware verification, "gates green" without an actual `test:ci` run). None of these represent hidden/undisclosed problems — the caveat is usually right there in the same line — but the checkbox state itself is misleading if read in isolation (e.g. a dashboard that only counts `[x]`/`[ ]`). Recommend a lightweight convention (e.g. `[x]*` or a distinct "owner-pending" marker) to distinguish "code-verified" from "fully accepted."
