# tools/replication — sweep 29.10.2026 (batch 119)

Files: 3 · lines: 554 · findings: 0 BUG-HIGH, 2 BUG, 2 DEAD, 1 RISK, 6 QUALITY

Scope notes: all three files read in full; `node --check` clean. Nothing executed. The server side was cross-checked: header `X-HighAsCG-Replication-Token` (src/api/routes-replication-shared.js:10), `/api/replication/playhead-export` (routes-replication-get.js:227), `status.peer`/`status.amcpFanout.active` (src/replication/replication-service-status.js:235,297) all match what measure-playhead-drift.js reads. WO-273 (work/work-orders/273_WO_SCRIPTS_TOOLS_CLEANUP.md:212) deliberately left tools/replication/*.js in place as operator/QA diagnostics.

## tools/replication/compare-caspar-parity.js
- `BUG` tools/replication/compare-caspar-parity.js:132-143 — the config comparison ignores the CLI: the backup config is always fetched by `ssh 192.168.0.25 'cat /home/casparcg/highascg/config/casparcg.config'` and the leader config is always read from the local checkout, while AMCP INFO uses `--backup-host`/`--leader-host` (156-158). Failing case: `--backup-host 10.0.0.9` → INFO from 10.0.0.9, config from 192.168.0.25 (or an ssh failure) in one report; the section titles "LEADER (.20 local)" / "BACKUP (.25)" are also stale. Fix: use `args.backupHost` for ssh and the path.
- `QUALITY` tools/replication/compare-caspar-parity.js:151 — after an ssh failure the fallback config object has no `bytes`/`md5`: the summary prints `bytes: undefined`, and `diffConfigs` reports every channel as "only on leader" plus `config md5: X vs undefined`, which reads as a real difference.
- `QUALITY` tools/replication/compare-caspar-parity.js:165-167 — `l10?.timeSec != null` is true for NaN (the parser yields NaN when `<time>` is missing), so the report prints `L10 drift ... NaNms`.
- `QUALITY` tools/replication/compare-caspar-parity.js:118-120 — "consumer types" are every attribute-less tag inside `<consumers>` minus four names, so parameter tags (`device`, `windowed`, ...) count as consumers and produce noisy diffs.
- `RISK` tools/replication/compare-caspar-parity.js:146-147 — fixed `/tmp/casparcg-backup.config`; `writeFileSync` follows a pre-planted symlink on a shared /tmp.
- `DEAD` tools/replication/compare-caspar-parity.js:1 — no code references. grep: `rg -n "compare-caspar-parity" . --glob '!work/sweep*'` → only work-orders/docs mentions (65_WO, HOT_BACKUP runbook text); kept deliberately per WO-273.

## tools/replication/measure-playhead-drift.js
- `QUALITY` tools/replication/measure-playhead-drift.js:154,169-172 — the leader's `/api/replication/status` must answer even when `--backup` is given (only `status.role`/`amcpFanout` are printed), and any single failed sample (`fetchPlayheadExport` throws) aborts the run instead of recording a gap; a 60 s QA run (HOT_BACKUP_TWO_BOX_QA_RUNBOOK.md:41) is lost on one timeout.
- `QUALITY` tools/replication/measure-playhead-drift.js:27 — `--token` on the command line is visible in `ps`; the config-file default (147) is the safer path and is what the header (line 12) recommends.

## tools/replication/poll-amcp-drift.js
- `BUG` tools/replication/poll-amcp-drift.js:274-277,289-290 — the header says "Live AMCP INFO drift poll" (line 214) and its sibling is documented "measure only — no AMCP", but `main()` sends `LOADBG 1-10 3825579625-preview.mp4 SEEK 0` and `PLAY 1-10` to BOTH hosts, and the default leader is `127.0.0.1` (line 219) = the local playout. Failing case: run it on an on-air box → channel 1 layer 10 is replaced by a hard-coded clip (or error 404 if that file is absent); no confirmation or `--yes`. Also, `amcp()` only resolves on `2xx` for non-INFO commands (245), so a 404/501 reply is reported as "timeout ... " after 5 s, hiding the real answer. Fix: say so in the header, require `--yes`, handle 4xx/5xx.
- `QUALITY` tools/replication/poll-amcp-drift.js:219-225 — backup IP 192.168.0.25 (env override only), channel/layer/samples are constants.
- `DEAD` tools/replication/poll-amcp-drift.js:1 — no references at all. grep: `rg -n "poll-amcp-drift" . --glob '!work/sweep*' --glob '!work/code-audit-raw.json'` → none (only the audit JSON); kept deliberately per WO-273 (diagnostic).
