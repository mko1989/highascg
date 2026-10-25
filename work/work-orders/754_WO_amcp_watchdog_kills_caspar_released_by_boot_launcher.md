# WO-754 — The AMCP watchdog kills the Caspar the start-up launcher just released

**Status: DONE (25.10.26) — replay test fails before / passes after; live A/B on .4: release code killed the released Caspar, the fix did not. .4 keeps the release file until the owner updates it.**

Found by WO-753 (A9: cold boot of .4 on Ubuntu 26.04).

## Investigation

- .4 boots in `startup.mode: ask` (WO-645, the default). Caspar is held until a person presses Start operator here
  or Run headless, with no backstop.
- Boot 25.10 10:47:48; launcher answered by API at 10:53:08 (the HDMI-0 click from 24.10). .4 journals:
  ```
  10:53:08.865 [Boot screens] Caspar start released (…/caspar-screens-ready)
  10:53:09.931 [AMCP-Watchdog] AMCP down for 302s — no casparcg main process (waiting for run.sh)
  10:53:11.199 run.sh[7458]: Starting CasparCG … 2.5.1
  10:53:11.495 [AMCP-Watchdog] AMCP down for 304s with casparcg still running — killing hung process so run.sh can relaunch
  10:53:11.995 casparcg-server.service: Main process exited, code=exited, status=143
  10:53:22.190 casparcg-server.service: Scheduled restart job, restart counter is at 1.
  10:53:24.349 run.sh[7853]: Starting CasparCG …   (AMCP up; stays up)
  ```
  The Caspar that the answer released was killed 0.3 s after it started. systemd relaunched it 10 s later
  (`RestartSec=10`). Cost: about 13 s more dark time on every such boot, a needless SIGTERM during Caspar's GL/DeckLink
  init, and a "hung process" warning that is false.
- **It already happened on 24.10 at 20:12:** `[AMCP-Watchdog] AMCP down for 2463s with casparcg still running —
  killing hung process`, 2.8 s after `Caspar start released`, then `status=143`. The two other boots that day (10:02,
  18:08) were answered within 120 s and were not killed.
- Root cause, `src/bootstrap/caspar-amcp-watchdog.js` `evaluateAmcpWatchdogTick`:
  - `state.downSince` is set on the first tick with no AMCP client and is cleared only when the client connects.
  - While no Caspar main process exists, the tick returns `wait_runsh`, but `downSince` keeps aging.
  - The hung-process rule `if (downMs >= recoverMs)` (120 s) measures from `downSince`. So the first tick that sees a
    freshly launched main, after more than 120 s of boot hold, decides it is hung.
  - The rule's intent is "a casparcg process has been running for 120 s and AMCP never came up". The time when no
    process existed is not a hang.
- Same class as run.sh's own `CASPAR_BOOT_HANG_SEC` (180 s), which correctly counts from its own launch.
- `tools/smoke/smoke-caspar-amcp-watchdog.js` (4 tests, passes) is not in `tools/ci/offline-test-files.js`, so CI
  never ran it.

## What was done

- `src/bootstrap/caspar-amcp-watchdog.js`: the state gains `lastNoMainAt`, the last tick with AMCP down and no casparcg
  process (cleared when the client connects). The hung rule measures `hungMs = now - max(downSince, lastNoMainAt)`, the
  time a process has existed without AMCP, so a held run.sh no longer counts. The "recovery in Ns" warning uses the
  same number (it would have said 0 s after a long hold).
  - Alternatives rejected: resetting `downSince` when a process first appears loses the "AMCP down for Ns" warnings
    while held; skipping the watchdog while the boot gate is held would tie it to WO-645's file layout, but the rule
    is about any time without a process (a stopped unit, a crash-loop backoff) and not only the launcher.
  - Unchanged: a process that is there when AMCP drops is still killed after 120 s (the existing test keeps passing).
- `tools/smoke/smoke-caspar-amcp-watchdog.js`: a replay of .4's timeline (300 s with no process, then a fresh one):
  no kill while it is younger than 120 s, a kill once it has run 120 s without AMCP. The smoke joins
  `tools/ci/offline-test-files.js`; it was never in CI before.
- `tools/ci/unwired-exports-baseline.json`: one entry the gate reported as no longer orphaned
  (`config-reload-signature.js: hashSubsystemReload`, unrelated) removed, as the gate asks.

## What was VERIFIED

- Smoke: the new test failed on the old code (`a process younger than recoverMs is booting, not hung`); 5 / 5 after.
- Gates: test:ci 3249 pass / 1 fail (WO-498, export-only); repo-integrity, max-lines, unwired exports, boot, format
  OK; lint 214 warnings.
- Live A/B on .4 (`c753/wd-ab.sh`): `systemctl stop casparcg-server` for 150 s, then start, then 45 s of journal:
  - release code: `AMCP down for 155s with casparcg still running — killing hung process`, Caspar exit 143 ×1;
  - fixed code: `AMCP down for 151s — no casparcg main process (waiting for run.sh)`, then `Caspar port is up but
    client disconnected for 156s — nudging reconnect`; exit 143 ×0, AMCP up.
  - .4's file put back afterwards (md5 `ad159d6c…`, the release's); .4 gets the fix with its next update.
- Deployed on .23 (server restart).
