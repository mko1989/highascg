# WO-756 — The rest of the 2026-08-03 tools review: the clock-setting test, the eggs cleaner, the exFAT conf, the inert timeout, local CI

**Status: DONE (25.10.26) — the time test run as root on .4 left NTP and the date alone (16 / 0); cleaner and exFAT conf
proven by dry run; test:ci 3322 / 0, the same count three runs in a row; gates and lint green.**

Follows WO-755 (findings 1–5 of `work/reviews/2026-08-03-tools-tests-ci.md`). Owner, 25.10: *"Anything to fix, fix
it"*. The same day: both boxes are dev-only now.

## Investigation

All five findings were still true at HEAD d3227a9b:
- **6. The time test could set the clock.** `smoke-system-time.test.js` "accepts valid date-time" (and the 10:27:60
  case) ran the real `scripts/runtime/highascg-set-system-time.sh set 2026-07-14 …`. Its only guard is
  `id -u -eq 0`, after which it runs `timedatectl set-ntp false` and `set-time`. Under `sudo npm run test:ci:full`
  that turns NTP off and jumps the clock to July. The file was outside the curated list, so only the full run had it.
- **7. The eggs cleaner cleaned `scripts/`.** `scripts/eggs/clean-eggs-dev-host.sh:11` kept `ROOT=…/..` after moving
  down a level. Dry run: `Eggs dev host cleanup: /home/casparcg/highascg/scripts`, then `Done.` with nothing listed.
- **8. The exFAT tool's no-device path was dead.** `add-exfat-data-partition.sh:57` sourced `flash-iso-conf-lib.sh`
  beside it. The file lives only in `legacy-persistence/` (`finish-operator-stick.sh` was repointed, this one wasn't).
- **9. The timeout was inert.** Both runners set `NODE_TEST_TIMEOUT`, which `node --test` never reads (the timeout
  is the `--test-timeout` flag; nothing else in the repo reads the env).
- **10. Local CI had drifted.** `scripts/ci/run-local-ci.sh` lacked the max-lines and unwired-exports steps that
  gate `.github/workflows/ci.yml`.

## What was done

- `smoke-system-time.test.js`: every wrapper run gets a `timedatectl` stub (exit 0) first on PATH, in a scratch dir
  removed after the suite. The assertions are unchanged. The file joins `tools/ci/offline-test-files.js`.
- `clean-eggs-dev-host.sh`: `ROOT=…/../..`, and the usage lines name the real path.
- `add-exfat-data-partition.sh`: conf default, hint and `source` point to `legacy-persistence/`, as in
  `finish-operator-stick.sh`.
- `run-offline-tests.js` / `run-offline-tests-full.js`: `--test-timeout=${NODE_TEST_TIMEOUT || 60000 / 120000}` as
  a flag, so the env still overrides it.
  - **Dead end, recorded:** `--test-force-exit` was added too, because a timed-out test that leaves a live handle
    (a timer) keeps its file alive, and the run never ends (probe: 2 s with the flag, more than 120 s without).
    But with it, test:ci counted 3299, 3309, 3322 and 3322 tests in four runs, all with 0 failures. Files stopped
    early: run 1 lost the last two `describe` blocks of `smoke-wo232-template-tick.test.js`, sync source greps,
    with nothing reported. Losing tests silently is worse than a hang (CI's `timeout-minutes: 15` still catches a
    hang), so it is out and the reason is in the runner comment.
- `run-local-ci.sh`: the two missing steps, in CI's order.

## What was VERIFIED

- **Time test as root on .4** (HEAD's `src` + the new test in a scratch dir, `sudo node --test`): 16 / 0. Before
  and after: `NTP=yes`, `NTPSynchronized=yes`, date 2026-10-25. As a user on .23: 16 / 0.
- Cleaner dry run after: root `/home/casparcg/highascg`, lists `dist-web/`, `dist/`, `cef-cache/`, `log/`.
- exFAT: `bash -n` OK. The repointed reader returns `DEVICE` from a scratch conf (`/dev/sdzz`). The tool itself
  stops at its root check before this point when run as a user.
- test:ci on the clean export, without force-exit: **3322 tests, 3313 pass, 0 fail, 9 skipped, three runs alike**.
  Max-lines, unwired, boot and repo-integrity OK. Prettier clean, lint 214 warnings, `run-local-ci.sh` `bash -n` OK.
- **Not done:** `verify:script-paths` (named in finding 10) is still in neither CI nor local CI, and it scans only
  `src/`, `run.sh`, `package.json` and systemd, so it would not have caught 7 or 8. Widening it is its own job.
