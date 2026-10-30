# WO-717 — Screen-consumer policy enforced on every Caspar launch, whoever wrote the config

**Area:** devices-config, caspar-build
**Status: DONE (23.10.26). Verified: the WO-717 smoke 5/5, the WO-716 smoke 6/6, the generator/routing/vsync smokes
43/43, the run.sh/supervisor smokes 68/68. Box: after `systemctl restart casparcg-server`, the supervisor log has
the policy line and Caspar is back on 5 channels.**

Owner, 23.10 (after WO-716): *"Make sure the vsync and GPU texture always follow best practice. And doesn't change
even on template iso."*

## Investigation

WO-716 fixed the generator and the ISO template file. Several paths still write `casparcg.config` without the
generator, and any of them could bring back vsync on or gpu-texture off:

| path | evidence |
|---|---|
| config editor one-shot XML / saved `casparServer.casparConfigOverride` | `routes-caspar-config.js` `writeCasparConfigToDiskUnserialized`: `oneShot \|\| persistedOverride \|\| buildConfigXml(…)` |
| project bundle apply (`payload.casparcgConfig`) | `routes-project.js:200`, written verbatim |
| ISO template copied to `casparcg.config` by shell | `tools/eggs/live-usb/install-iso-defaults.sh`, `reset-iso-operator-config.sh:34-42` |
| a stick restore / exFAT sync / Syncthing peer / hand edit | plain file copies, no node involved |

The one point every Caspar start goes through is `run.sh` `run_caspar()`. The systemd unit
`casparcg-server.service` runs `ExecStart=/home/casparcg/highascg/run.sh` from the repo, and AMCP `RESTART` and
Apply relaunches loop through it.

## What was done

- New `src/config/screen-consumer-policy.js` is the one home of the policy and its reasons.
  - It holds `SCREEN_VSYNC_XML` / `SCREEN_GPU_TEXTURE_XML`. The generator now imports them from here.
  - `enforceScreenConsumerPolicy(xml)` forces `<vsync>false</vsync>` + `<gpu-texture>true</gpu-texture>` on every
    `<screen>` element. It replaces any value or self-closing tag and inserts missing lines at the block's
    indentation.
  - XML comments are skipped, everything outside `<screen>` stays byte-identical, and a second run changes nothing.
- New `tools/runtime/enforce-screen-consumer-policy.js <file>` applies it to a file: tmp + rename, and only when
  something changed. Any error prints one line and exits 0, because a launch must never be blocked.
- `run.sh` `run_caspar()`: runs the tool on `$CONFIG_PATH` before every launch and writes its line to the
  supervisor log.
- `routes-caspar-config.js` and `routes-project.js`: enforce before writing. On generated XML this is a no-op.
- New `tools/smoke/smoke-wo717-screen-consumer-policy-enforced.test.js` (curated list). It covers stale and
  self-closing tags, missing tags with indentation, a commented-out consumer left alone, other consumers untouched,
  idempotence, the ISO template already being clean, the file tool (rewrite once, no temp file left, missing file
  OK), and source pins for run.sh (enforce before `"$CASPAR_BIN"`) and both write paths.

Why enforce at launch as well as fixing the writers: a file copied by shell, eggs or Syncthing never passes through
node. Enforcing in `run.sh` is the only check that covers whatever file Caspar actually reads.

## What was VERIFIED

- The tool on the pre-WO-716 ISO template (`git show HEAD~1:config/casparcg.config.iso`): `fixed 1` → the output is
  byte-identical to today's fixed template. A second run says `already`, and `/nonexistent` → `cannot read`, exit 0.
- Smokes: WO-717 5/5, WO-716 6/6, generator/routing/vsync 43/43, and run.sh/supervisor (WO-400/407/444/507-508/
  638/645, proc-stats) 68/68. `sh -n run.sh` OK. ESLint is clean on the new and changed files; Prettier and the
  500-line check pass.
- Box: `sudo systemctl restart casparcg-server` → `/tmp/caspar.log`
  `18:51:00 [screen policy] 0 screen consumer(s) already vsync off + gpu-texture on`. The disk config is the
  5-channel generated one with no `<screen>`. `INFO` shows 5 channels playing, and the Godot client stayed up.
