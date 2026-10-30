# WO-755 — `test:ci:full` green again: 26 rotted tests outside the curated gate repointed and brought into CI

**Area:** testing-ci
**Status: DONE (25.10.26) — full suite on a clean export on .4, isolated from the network: 3958 / 26 fail before,
3978 pass / 0 fail / 15 skipped after; clean-export gates on .23 green (test:ci 3297 / 0, now including WO-498).**

Owner, 25.10: *"Anything to fix , fix it"* (after WO-753).

## Investigation

- CI runs only the curated list `tools/ci/offline-test-files.js` (`run-offline-tests.js`). `npm run test:ci:full`
  (`run-offline-tests-full.js`) runs every file `collect-offline-tests.js` finds: 617 files, 197 of them outside the
  curated list. The 2026-08-03 review (`work/reviews/2026-08-03-tools-tests-ci.md` findings 1–5) already said the full
  gate was "permanently red … so it is never run". The review wave was closed on its numbered summary rows; these
  findings were never fixed.
- Run isolated, because `test:ci:full` once wiped on-air layers (WO-235): `git archive HEAD` to `~/wo755-full` on .4,
  `npm ci`, then `sudo unshare -n` (loopback only, so nothing reaches :5250 or :4200) running as casparcg. 73 s:
  **3993 tests, 3958 pass, 26 fail, 9 skipped**, in 14 files. Before running, grepped the 617 files for
  `systemctl|pkill|killall|process.kill(|xdotool|wmctrl`: none outside the curated list spawns them.
- Each failure, with its cause:

| File | Failed | Cause | Kind |
|---|---|---|---|
| `test/api/routes-media-thumb.test.js` | file | `describe is not defined`: no `node:test` import, never ran an assertion | test bug |
| `smoke-mixer-effects-catalog` | 3 | rotation sends a centre-pivot `ANCHOR 0.5 0.5` then `ROTATION` (`scene-layer-rotation-amcp.js`, since 06-30); the test wanted one line | intended change |
| `smoke-amcp-offline-migration` | 1 | REST `/api/cg/clear` maps a look layer to its CG overlay host (`cg-routing.js` `normalizeCgRequest`): 10 → 700 | intended change |
| `smoke-meter-null-consumer` | 1 | index 96 → 720 in 8c0ba811 (96 is the streaming RECORD consumer; an ADD at a taken index replaces it) | intended change |
| `smoke-host-live-caspar-config` | 1 | read the box's own `config/` and expected a webpage host in it | box-state dependency |
| `smoke-scene-take-pgm-only` | 1 | needed `media/projects/tetst/02_BUMPER.*` on this box's disk (gone) | box-state dependency |
| `smoke-scene-live-preview-register` | 1 | `handlePreviewLiveRegister` became async; the test did not await | test bug |
| `smoke-wo160b-pgm-only-lbg` | 1 | WO-574: the transition rides the LOADBG and the PLAY is bare; the test read it off the PLAY | intended change |
| `smoke-wo172-device-view-sync` | 4 | the fixture had one main destination at index 1 and none at 0; since 90e58e42 a gap is re-ranked (phantom-pair fix), so it became screen 1 | intended change |
| `smoke-stream-output-project-sync` | 3 | imported `syncStreamOutputsToDeviceGraph` / `hardwareConfigHasStreamOperatorData`, which never existed in git (`git log -S` empty) | dead test |
| `smoke-cg-deck-thumb-contain` | 1 | imported `computeContainDestRect`, which never existed; the thumb draws with `drawImageContainInRect` | dead test |
| `smoke-companion-hot-backup-failover` | 6 | imports the sibling checkout `../companion-module-dev/…`, absent in an export (7 / 7 on .23 where it exists) | external dependency |
| `smoke-wo498-no-nginx-gzip` | 1 | `git ls-files` in a non-git export (the one failure the export gates always expected) | environment |
| `smoke-ws-restart-reconnect` | 1 | its spawned server was not ready within 60 s while 617 files ran; alone on .4: 3 / 3, and green in the re-run | load (not changed) |

- No production code had regressed: every subject either changed on purpose (and the test was not repointed) or the
  test depended on this box's state, a sibling repo, or git.
- Side check: the WO-719/720 host guards (pointer confine, Firefox, projects root, state file) key on
  `NODE_TEST_CONTEXT` or `HIGHASCG_SANDBOX`. Starting `node index.js --no-caspar` by hand on .4 while debugging had
  neither, so it ran as a production server. It held pointer barriers on .4's X display for about 40 s, and .4's
  own server re-confined 6 times (12:04:59–12:05:25), then nothing. The layout was unchanged (HDMI-0 primary at 0,0,
  DP-3 at 1920,0). Expected behaviour for a real start, not a bug. Neither full run caused a single re-confine on .4
  (0 in each window). The export gates' `node index.js --no-http` exits after config load (`index.js:107`), before
  anything touches X.

## What was done

Tests only, no production change. Assertions were repointed to what the code does on purpose, not loosened:
- `routes-media-thumb.test.js`: `const { describe, it } = require('node:test')`.
- `smoke-mixer-effects-catalog`: rotation expects exactly 2 lines and every other effect 1. The REST checks compare
  against the effect's own command (`.at(-1)`).
- `smoke-amcp-offline-migration`: expects `CG 1-${resolveTemplateCgHostLayer(10)} CLEAR`.
- `smoke-meter-null-consumer`: expects 720, plus the index staying below `DMX_FILE_CONSUMER_INDEX`.
- `smoke-host-live-caspar-config`: a fixture (defaults from an empty config dir plus one webpage host on channel 6)
  instead of the box's `config/`.
- `smoke-scene-take-pgm-only`: a scratch media root with `projects/tetst/02_BUMPER.mp4`.
- `smoke-scene-live-preview-register`: awaits the handler.
- `smoke-wo160b-pgm-only-lbg`: transition / duration / tween on the LOADBG plan, and the PLAY's opts `{}` (bare).
- `smoke-wo172-device-view-sync`: the fixture carries an uncabled Screen 1 at index 0.
- `smoke-stream-output-project-sync`: the two never-landed tests removed. The WO-261 guard stays: graph URL/key are
  never copied to `streamingChannel`.
- `smoke-cg-deck-thumb-contain`: the same letterbox assertions on the real `drawImageContainInRect`, through a fake
  2D context.
- `smoke-companion-hot-backup-failover`: the 6 Companion tests skip, with a reason, when the sibling checkout is
  missing. The HighAsCG-only test always runs.
- `smoke-wo498-no-nginx-gzip`: `git ls-files` when it is a checkout, else the disk (an export holds exactly HEAD's
  files).
- `tools/ci/offline-test-files.js`: the 12 repaired files join the curated list, so CI guards them from now on.
  `smoke-ws-restart-reconnect` stays out: it spawns a full server and skips under CI anyway.

## What was VERIFIED

- Each repaired file passes alone on .23: media-thumb 3, mixer catalog 4, offline migration 5, meter 5, host-live 1,
  preview register 1, pgm-only 7, wo160b 8, wo172 9, contain + stream sync 3, Companion 7, wo498 8 (also 8 in an export).
- **Full suite, isolated on .4, with the fixes: 3993 tests, 3978 pass, 0 fail, 15 skipped** (the 6 new skips are the
  Companion tests: no sibling checkout on .4), 67 s.
- Clean-export gates on .23: repo-integrity, max-lines, unwired exports, boot, format OK. test:ci 3297 pass / 0 fail
  (was 3249 / 1: the 12 files now in it, and WO-498 green on an export). Lint 214 warnings.
- Throwaway `~/wo755-full` on .4 removed afterwards.
