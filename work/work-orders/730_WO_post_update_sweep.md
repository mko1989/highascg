# WO-730 — Post-update sweep: one command (and an automatic run) that checks the whole box after an update

**Status: DONE (24.10.26) — sweep green-or-explained on this box; the server's own run after restarting on
1eb47065 logged 23 pass / 4 warn / 0 fail and GET /api/system/update/sweep served it; smoke 10/10; gates green.**

Owner, 24.10: *"id like to have a sweep check so after each update it can be run and check the full integrity and
compatibility of the whole app/system"*

## Investigation

The checks existed but were scattered and partly rotten:
- CI gates (`tools/ci/*`) run on a clean checkout, never on the box with its real config, projects and root copies.
- `tools/startup/verify-*.sh` (sudoers, Caspar autostart, DeckLink) run only by hand.
- `tools/startup/run-health-checks.sh` has rotted: stick test-03 calls `findmnt -L` (not a flag), the plymouth step
  FAILs on an installed disk, the storage probe FAILs. Not used by the sweep; left as is.
- WO-728's checks (installed root copies, replication through the real sshd, clocks) are one-offs.
- Nothing tries **this box's projects** against new code. A project that no longer loads would only show at load
  time, on air.

First run of the sweep on this box (17 s) found:
- `check-require-integrity.js` **exits 1 on this box**: 11 Syncthing conflict copies in `projects/` (ignored by
  git, so CI never sees them).
- `systemctl show` prints `ExecMainStartTimestamp` as `Sat 2026-10-24 16:41:52 CEST`. Since the WO-727 time-zone
  change (Europe/Warsaw), `Date.parse` cannot read it, so "since the unit started" silently became nothing. Start
  times now come from `/proc/<MainPID>/stat`.
- Caspar's journal lines carry its own `[2026-10-24 …]` stamp before `[error]`. The noise filters (boost socket
  exceptions when a client hangs up or an acceptor closes, `local_endpoint: Bad file descriptor`) must match after
  that stamp is removed. With the stamp removed: 60 lines → 0.
- **The live server reads projects from `~/bridge/projects`** (56 files, `/api/project/list` `path`), not the repo's
  `projects/` (61 files, stale). The sweep takes the folder from the server's own list.
- Old project files have no `slug` field (only `name`), so "did it load" is `activeSlug` from `/api/project/list`.

## What was done

`tools/sweep/` — read only on this box. No Caspar command, no project load on the live server, no restart.

| group | checks |
|---|---|
| code | running build = build on disk; server/kiosk restarted after the newest code change (future mtimes counted, not compared); Node vs engines; `npm ls`; require integrity; conflict copies; root-installed helpers (WO-728); binaries the app runs |
| system | core units + `systemctl --failed`; NTP + time zone; disk (fail < 2 % / 1 GB, warn < 10 % / 10 GB); GPU; ports 4200/5250/8000; replication keys rsync-only (WO-729); the three `verify-*.sh` scripts |
| app | 16 read-only live GETs; Caspar connected + channels aligned; Caspar started after its config changed; error lines in server/Caspar journal and kiosk log since each started; kiosk connected; **headless client compile** (own `XDG_DATA_HOME`, dead server address); config + project JSON parse |
| sandbox | on a throwaway sandbox server (WO-719): **every parameterless GET route** (94) without 5xx/timeout; **every project of this box loads** with this code |
| cluster | peers online, same build, clock offset (request midpoint); a signed call to each peer (WO-712, a look that cannot exist → 404); `--peers`: media copy both ways (WO-728) |

- `run-sweep.js`: `--quick` (no compile/sandbox), `--peers`, `--tests` (offline suite), `--only=`, `--json`.
  Reports go to `~/.local/state/highascg/sweep/<stamp>.{json,md}` + `last.json`, keeping the 20 newest. They live
  outside the repo because Syncthing would carry them to the peers. Exit 1 on a fail; warnings do not fail.
- `src/system/sweep-after-update.js` + `index.js`: when the code id (BUILD_STAMP + git HEAD, read from `.git`
  without running git) differs from `last.json`, the server spawns the sweep 120 s after start and logs one summary
  line. Off in a sandbox and with `HIGHASCG_SWEEP_AFTER_UPDATE=0`.
- `GET /api/system/update/sweep` returns the last report (404 before the first). Contract docs regenerated.
- `tools/ci/run-offline-tests.js`: the two pre-checks merged into one loop (the file was at the 500-line limit).

The sweep is a separate process, not part of the server, so a broken sweep cannot take the server down. It also runs
the same way by hand, over SSH, or from the updater.

## What was VERIFIED

- Full sweep on this box, after the fixes above: code/app/sandbox **14 pass, 4 warn, 0 fail in 17.5 s**. Every
  warning is real:
  - the server is older than this uncommitted code;
  - the 11 conflict copies;
  - 2 root helpers differ (apply-server-drop arrives with the next update; decklink lib = the WO-721 test seam);
  - DeckLink: no driver .deb in bridge, module not loaded.
  - System group: 9 pass. Cluster group skips (not linked right now).
- 94 routes on the sandbox: 77×200 3×400 14×404, no 5xx. All 56 projects load (1.7 s). Client compile 6 s, clean.
- `tools/smoke/smoke-wo730-sweep.test.js` **10/10** (in FILES):
  - disk rule; plain-key detection; Caspar noise vs a real error;
  - route list;
  - code id through loose + packed refs;
  - the once-per-update gate;
  - server wiring pins;
  - markdown escaping (this caught names not being escaped);
  - keeps 20;
  - a real sandbox run on fixture projects naming the broken one.
- Clean-export gates: repo-integrity, max-lines, unwired-exports, boot, lint (214), format:check all pass.
  `test:ci` 3143 tests. The contract-doc failure was fixed by regenerating; it passes 3/3 after. WO-498 fails only
  in the export (no `.git`) and passes 8/8 in the checkout.

- **Automatic run, live:** `kill -TERM` of the server → journal
  `[sweep] new code 2026-10-23_194203+1eb47065eeab: sweep in 120 s`, then 2 min 18 s later
  `[sweep] after update …: 23 pass, 4 warn, 0 fail — GET /api/system/update/sweep`. The route returned that report
  (`auto: true`, same codeId). The `verify-*.sh` scripts pass under systemd, without a tty.
- The run also showed that the godot kiosk has **no F5 reload**. CLAUDE.md's deploy loop still says F5 (web-kiosk
  era). The client restarts by spawning itself (connection_menu.gd); the running kiosk's parent is init. The sweep's
  advice now says "restart the operator client".

## Open

- Run on .4 after it is updated to this commit.
- `run-health-checks.sh` rot (findmnt `-L`, plymouth, storage probe) — fix or retire.
