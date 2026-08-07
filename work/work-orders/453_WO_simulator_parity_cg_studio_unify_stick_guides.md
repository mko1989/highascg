# WO-453 — Simulator parity with the real server, CG Studio unification, Mac/Win stick guide overhaul

**Status: DONE (2026-08-07 — CI run 31168238103 green in 1m31s on deaf87f incl. the new sim-parity smoke + boot gate; release published: https://github.com/mko1989/highascg/releases/tag/2026-08-07_120130, highascg-server_2026-08-07T120130Z.tar.gz 47 MB. Owner QA remains: run the sim on a prep laptop.)**

Owner (todos07.08.26): make a GitHub release; the standalone client/simulator "wasn't updated for
a long time" and must work the same way as the actual server; check the Mac/Windows
flashing/partitioning guides; CG Studio was a simulator module but is now part of main highascg —
the simulator should use the same integration.

## Investigation FIRST

### The simulator was a dead shell (9 weeks / 668 commits of drift)

`amcp-simulated.js` had TWO commits ever (last 2026-06-05); 28 commits touched `src/caspar/`
since. But the structural finding is worse than staleness:

- **`--no-caspar` never reached the simulator at all.** `index.js` (old :270) skipped
  `ConnectionManager` construction entirely, so `appCtx.amcp` stayed `null`. `AmcpSimulated` is
  only instantiated inside `AmcpClient`, and `offline_mode` only reroutes sends *of an existing
  client* (`amcp-client-transport.js:173/187/209`). The sim stack was unreachable dead code; its
  only exercisers were three smoke tests.
- Consequences: TAKE and every playout path silently no-oped (`timeline-playback-amcp-send.js`
  guards bail on `!self.amcp`); unguarded sites (`routes-mixer-stretch.js:12`,
  `operator-gui-channel.js:184-215`, …) threw on null; the whole post-connect bootstrap
  (`index.js` status handler: fetchInfo/INFO CONFIG, CLS/TLS query cycle, periodic hooks) never
  ran → zero channels, empty media/template catalogs, connection eye red.
- **No OSC in sim** → all timers 00:00, no progress, playlists never advanced (WO-251 advance is
  OSC-driven), clip-end fade + loop watchdog blind. `startOscPlaybackInfoSupplement` requires an
  active OscState, `canRunPeriodicSync` returns false offline — no fallback path existed.
- The stub answered 5 command shapes with empty data (`INFO` → `''` → zero channels parsed);
  ~120 real client methods fell through to a blind `202 OK`; empty command string crashed it
  (TypeError on `.toUpperCase()`).
- **Launcher chain hard-broken:** `sim-app-root.cjs` probed `not-needed/` (deleted with the
  abandoned server/client split) and never the repo root → Electron "Simulation" tab dead;
  `win/HighAscg-Simulation.cmd` + `mac/…command` pointed at pre-reorg `tools/portable-desktop/`;
  npm scripts `portable:sim`, `portable:sim:check`, `launcher:sim-install` all deleted from
  package.json while docs/code still referenced them; the portable-desktop syntax CI workflow had
  been deleted, which is why none of this was caught.

### CG Studio divergence

`client/tools/electron-launcher/cg-studio/` was an rsync mirror of `src/cg-studio/` (11 files),
hosted by the launcher on its own :4300 server — one commit stale: it lacked the `f533f9e`
export rewrite for `lt-engine-controls.js`, so templates exported from the launcher wrote a
`src="lt-engine-controls.js"` reference that 404s on air. Main highascg has mounted the same
package IN-PROCESS since WO-265 (module registry: `/cg-studio/` static + `/api/cg-studio`,
workspace tab, enabled by default). Since the simulator runs the real server, the launcher's
local host + mirror were pure drift surface. Hardcoded `/Users/marcin/highascg` fallbacks in the
sync + host scripts.

### Mac/Windows flashing guides

Root cause of most breakage: the 2026-06-08 reorg (`b797edf`) moved `tools/live-usb/` →
`tools/eggs/live-usb/` and the Mac/Win helper scripts → `client/tools/live-usb/`; guides were
never repointed. Three mutually incompatible stick layouts circulated (`drop-update/` canonical
per WO-47 vs legacy `update/server/` vs sim-only `sim/highascg/`); `MANUAL_STICK_WINDOWS_MACOS.md`
framed legacy union-persistence as required; `BUILD_AND_FLASH.md` had the wrong exFAT margin
default (1152 vs real 1536) and a no-op `ls -t` dd example; `stick-tools/README.md` had 7 of 8
references dead; `DEV_RELEASE_GITHUB.md` referenced five nonexistent npm scripts and
contradicted itself on the layout. The macOS seed script still created legacy `update/server/`;
the Windows one created no drop dir at all.

## What was done

### Simulator core (this session, by hand)
- `index.js`: `--no-caspar` forces `HIGHASCG_OFFLINE_MODE=1` (survives config rebuilds);
  `ConnectionManager` now constructed unconditionally (offline: no TCP, sends → sim); offline
  boot emits one synthetic `status {connected:true, version '2.4.0 (Simulated)'}` so the entire
  real post-connect bootstrap runs; sim OSC feeder started after `startOscSubsystem()`.
- `src/caspar/amcp-simulated.js` rewritten (317 lines) + new `amcp-simulated-state.js` (209):
  real response SHAPES — `INFO CONFIG` = the config-generator XML for the current app config
  (identical channel plan to a live Apply), `INFO` = per-channel status lines derived from that
  plan, `INFO <ch>` = 2.6-dev-schema stage XML from live sim playback state, CLS/CINF = recursive
  scan of the real media ingest dir (`local-media-paths.js`), TLS = template/ scan, DATA
  round-trips, THUMBNAIL RETRIEVE = base64 PNG, MIXER value store, stateful
  PLAY/LOAD/LOADBG(AUTO)/PAUSE/RESUME/STOP/CLEAR/SWAP/CALL-LOOP/CG. Empty-command crash fixed.
  `HIGHASCG_SIM_CLIP_SEC` sets sim clip duration (default 30s), read per clip.
- NEW `src/caspar/sim-osc-feeder.js` (93): 200ms tick reports sim playback through
  `oscState.handleOscMessage()` — the production UDP ingress — with the 2.6-dev address schema
  (`…/foreground/producer`, `file/time [elapsed,duration]`, `paused`, `loop`). Natural end
  promotes a LOADBG AUTO background (name change = the exact signal WO-251 playlist advance keys
  off) or empties the producer. Timers/progress/playlist advance/clip-end fade all ride the
  UNMODIFIED production pipeline.
- `src/utils/query-cycle.js`: two `socket.isConnected` gates relaxed with `ctx.amcp?.isOffline`
  (requestData already routes through offline-aware `amcp._send` since the 2026-07-19 fix).
- `src/caspar/amcp-batch.js`: offline short-circuits to `sequentialRaw` instead of burning a
  guaranteed `Not connected` rejection per batch.

### Launcher + CG Studio (agent, verified)
- `sim-app-root.cjs` probes the repo root (checkout beats stale bundle; `not-needed/` gone);
  `.cmd`/`.command` fixed for the moved tree (work from any cwd); `portable:sim` +
  `portable:sim:check` npm scripts restored; `sync-sim-server.sh` + stub deleted.
- CG Studio: launcher mirror (11 files) + `sync-cg-studio.sh` DELETED; `main-cg-studio.js`
  174→66 lines, pure window opener at `http://<serverIp>:<port>/cg-studio/index.html` (address
  from the same header fields the Simulation tab uses); `launcher:prepare` removed from
  package.json; registry entry now says server-hosted, `defaultEnabled: true`;
  `docs/MODULES.md` + launcher README rewritten to the WO-265 reality; `/Users/marcin` fallbacks
  gone. Standalone dev mode `npm run cg-studio` (src/cg-studio, :4300) KEPT. Exports orphaned by
  the mirror deletion pruned (`buildStudioUrl` deleted; `getPackageDir`/`EXPORT_ID_RE`/
  `fixStudioAssetPaths`/`DATA_FIELDS` un-exported, still used internally) — WO-367 gate clean.
- Stick seed scripts aligned to canonical layout: macOS now seeds `drop-update/`+`applied/`
  (was legacy `update/server`), Windows ps1 gained both dirs.

### Guides (agent, links verified)
All seven guides repaired per audit: reorg paths, `drop-update/` everywhere (legacy noted once),
persistence demoted to legacy opt-in, margin 1536, real npm scripts only, dd examples fixed,
BRIDGE doc's broken markdown fences rebuilt, added explicit "never `rsync -a` onto exFAT (chown
EPERM exit 23; use `rsync -rLt --modify-window=2` or cp)" warnings, `DEV_RELEASE_GITHUB.md`
rewritten around `release:github-server` as canonical.

## What was VERIFIED to work

- **Live sim boot on this box** (isolated: scratch config on :8091/OSC :16250, scratch state
  file): `INFO CONFIG loaded — channel resolutions match running server`; `/api/state` showed
  **2 channels, 63 media items (real CLS scan), 73 templates**, `server_version
  "2.4.0 (Simulated)"`, `caspar_connected true`. `POST /api/raw PLAY 1-10 LOOP` → OSC layer
  `type ffmpeg`, elapsed advanced 6.71→9.92 over ~3.2s wall; PAUSE froze elapsed (25.6 = 25.6
  across 1.5s); STOP → `type empty`. All through the production OscState → StateManager → WS
  pipeline.
- NEW `tools/smoke/smoke-wo453-sim-parity.test.js` (6 tests: shapes, generator-plan mirroring,
  empty-command, pause-freeze/stop/loop, feeder addresses incl. **LOADBG AUTO promotion**,
  index.js wiring source guards) — added to the curated gate list.
- Gates all green locally: offline suite **1888 pass / 0 fail / 2 skip** (was 1882 pre-session),
  eslint 0 errors, prettier clean, `check-max-file-lines` 0 over 500, `check-unwired-exports`
  clean, npm-audit-ci OK, `verify:repo-integrity` OK, `npm run build:client` OK (dist-web
  rebuilt; kiosk reload N/A — highascg service was found ALREADY STOPPED on this box, predating
  this session; new bundle loads on next service start).
- Agent-side: `resolveSimAppRoot({})` live-probed → repo root; end-to-end
  `launch-sim-from-exfat.cjs` spawned `index.js --no-caspar` successfully; `node --check`/
  `bash -n`/`ast.parse` on every touched script.
- Local boot-check (`node index.js --no-http`) deliberately NOT run here: the real CasparCG
  binary is ACTIVE on :5250 and a real-mode boot pokes it (LED test sweep). CI's boot gate covers
  that path, which this WO does not modify.

## Remains owner-QA

- Run the simulator on a prep machine (Mac/Win): `npm run portable:sim` or the double-click
  wrappers; confirm media/templates appear, timers run, a playlist advances, CG Studio button
  opens the server-hosted studio.
- The `highascg` systemd service on this box was already inactive when this session started —
  intentional? (`sudo systemctl start highascg` if not.)
- Pre-existing repo-wide file-mode flips (644→755, content unchanged, hundreds of files —
  probably an exFAT round-trip) left uncommitted; decide whether to commit or revert wholesale.
