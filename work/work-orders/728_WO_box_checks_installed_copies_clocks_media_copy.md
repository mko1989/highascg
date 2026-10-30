# WO-728 — More automated checks: installed root copies, clocks, media copy between servers

**Area:** testing-ci, network
**Status: DONE (24.10.26) — all three run live on this box + .4 (green after fixes); smoke 11/11 in CI (+ the clock
step in the 3-sandbox scenario); the first live run found WO-729 (replication keys with a full shell).**

Owner, 24.10 (after WO-727): *"You can create more automated checks."*

## Investigation

What this session found by hand, that nothing in the repo would have caught again:
- **Stale root copies.** sshd ran a July forced command while the repo had the fixed one (WO-727); WO-511 was the
  same class (the updater rejecting its own new flag). Root helpers live in `/usr/local/lib/highascg/*` and
  `/usr/local/bin/highascg-*`, written once by setup / install scripts. Today on this box: 23 match the repo,
  2 differ — `highascg-apply-server-drop.sh` (WO-727, lands on the next update) and `decklink-dkms-cache-lib.sh`
  (WO-721's `DECKLINK_DKMS_CACHE_MOUNTS` test seam; same default behaviour; not in the WO-511 refresh list).
- **Clocks.** 17 s apart with NTP off (WO-724); signed cluster calls refuse past ±60 s. The ping already carries
  `serverTimeMs` (`routes-replication-get.js:91`).
- **Media copy between servers** (Send media push, WO-724; pull, WO-727) was only ever proven by hand, and only from
  this box to .4. CI has no sshd, so the offline smoke runs the wrapper directly, not through sshd + authorized_keys.

## What was done

- `tools/runtime/check-installed-helpers.js`: each installed file vs the repo file of the same name (also without
  `highascg-`, or plus `.sh` — that is how the forced command is matched); `deprecated/` is not a source; files
  without a repo file (heredoc / compiled) are listed as generated. Exit 1 when a copy differs, `--json`.
- `tools/e2e/replication-check.js --peer=<host>`: through the peer's sshd with this box's replication key and the
  app's own `rsyncArgs` / `rsyncSshOpts` (now exported): (1) the key runs only the forced command — a shell command,
  `/etc/passwd`, escaped `..`, an unescaped `;` must each be refused **by the wrapper** (its message), (2) push a
  folder whose names carry space, `&`, `(1)`, `'`, `[x]`, `#`, (3) pull it back byte for byte, (4) pull one file named
  on the remote command line, (5) always: empty `media/.highascg-check/` on the peer again (`--delete` on that
  folder only; the empty folder stays). `--peer=127.0.0.1` checks this box's own sshd + wrapper.
- `tools/e2e/cluster-scenario.js`: step 2 "clocks: every server within 5 s of the others" (ping `serverTimeMs` vs the
  request midpoint) — runs on sandboxes (CI) and `--live`.
- `tools/smoke/smoke-wo728-box-checks.test.js` (in FILES): the helper check on a fake repo + installed tree, WO-729's
  key restriction, the replication check's names.

## What was VERIFIED

- `check-installed-helpers.js` on this box: 23 same, 2 differ (the two above, both explained), 3 generated; exit 1.
- `replication-check.js --peer=192.168.0.4`: 5/5 pass (push 237 ms, pulls ≈220 ms each). `--peer=127.0.0.1`: **failed
  step 1 — `id` ran and printed `uid=1000(casparcg) … 27(sudo)`** → WO-729; after that fix 5/5 pass.
- Live cluster run (`--live=192.168.0.23:4200,192.168.0.4:4200 --yes`): 9 pass, 3 sandbox-only skipped, 0 failed;
  clocks spread 0 ms. Both kiosks back home afterwards (`origin=""`, .4's kiosk on 127.0.0.1:4200).
- Smoke 11/11; with `smoke-replication-ssh-setup` + `smoke-wo725-cluster-e2e` 33/33 (clock step passes on 3 sandboxes).
- Clean export: repo-integrity, max-lines, unwired-exports, `--no-http` boot, lint 214 warnings, format:check;
  test:ci 3133 tests, 3129 pass, 3 skipped, 1 fail = `smoke-wo498` (needs `.git`, passes 8/8 in the checkout).

## Open
- `decklink-dkms-cache-lib.sh` and the other non-updater helpers are refreshed only by
  `install-exfat-systemd-units.sh`; the WO-511 refresh could cover every helper this check matches.
- Fan-out end to end (WO-725 Open) still needs a simulated AMCP listener per sandbox.
