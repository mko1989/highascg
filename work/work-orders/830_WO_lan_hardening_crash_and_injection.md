# WO-830 — LAN hardening: remote crash, injection, secrets (sweep §2, without the auth switch)

**Area:** network
**Status: DONE (30.10) — 830a/b/c verified offline and live on the box (§3d); the owner installed both root wrapper copies, and `cmp` shows them identical to the repo (root, 0755)**
**Source:** the 29.10 code sweep, `work/sweep-29.10.2026/REPORT.md` §2 (items 1–24). Owner 30.10: *"yes we need better
auth handling. im putting that off till last … id like it to be hardened"* and *"there are a lot of bugs to fix"*.
**Related:** WO-811 (the auth switch itself stays there and comes last), REVIEW-2026-08-03, WO-418/419.

Three commits, none needs the auth decision:

- **830a — crash class (items 1–8):** each is a one-request remote restart, because process-guards exits(1) on any
  uncaught exception.
- **830b — injection and validation (items 9–15, 23):** root command injection via the vcam label, arbitrary file write
  via caspar-config apply, unchecked update asset, plugin id traversal, replication host/rsync, nuclear password fail-open,
  AMCP CR/LF.
- **830c — secrets and UI (items 16–22, 24):** nuclear password field autosave, redacted GET echo, open redirect,
  malformed cookie, support-bundle redaction, SRT passphrase drop, config dump in the journal, release from a dirty tree.

Item 25 (nuclear routes open to the LAN) is the WO-811 decision.

## 1. Investigation

See REPORT §2 tables and the batch MDs named there; each item carries file:line and how it was checked ([V] verified, [A] agent-read).

## 2a. What was done (crash class) — WO-830a

Each item was re-read and reproduced before fixing; all eight were real. Comments in the code cite `WO-830a`.

| # | Change |
|---|---|
| 1 | `src/system/video-feed.js` `onUpgrade`: `new URL(req.url)` wrapped in try/catch → `HTTP/1.1 400` + destroy (before the origin/auth checks, which never ran for `GET //`). |
| 2 | `src/server/ws-server.js`: `ws.on('error', …)` logged, on both the `/api/ws` and the replication connection handlers (file is exactly 500 lines, so the listeners are single lines with trailing comments). Same fix on the video-feed client sockets (`video-feed.js` `addClient`) — it had the identical gap (invalid UTF-8 frame). |
| 3 | `src/osc/osc-state-audio.js`: `MAX_AUDIO_CHANNELS = 64`; clamps `nb_channels`, the `/N/dBFS` meter index (also an unbounded `levels.push` loop, not in the sweep) and the bundled-`volume` / per-layer sample counts. **Bind (coordinator):** `src/bootstrap/osc-lifecycle.js` `effectiveOscBind`: the wildcard `0.0.0.0` narrows to `127.0.0.1` when the Caspar host is loopback (this box: Caspar's `<predefined-client>` is 127.0.0.1:6251). An explicit address or a remote Caspar keeps the configured bind. |
| 4 | `src/utils/safe-unzip.js`: `entry.stream().pipe(ws)` → `stream/promises.pipeline()`. Reproduced pre-fix as a *hung* extraction (the error is swallowed by `.pipe()`, the promise never settles, the upload request never answers) rather than a hard crash; pipeline rejects and destroys both streams. Not done: the size caps trust the zip's declared `uncompressedSize`; a lying header is not capped on actual bytes. |
| 5 | `src/api/routes-ingest.js`: the hand-rolled read/`write()` loop is replaced by `writeBodyToFile()` (exported) = `pipeline(Readable.fromWeb(body), progress Transform, createWriteStream)`: error handling from the first write, real backpressure. The progress callback keeps the existing `setDownloadState` updates. |
| 6 | `src/stage/mvr-scene.js`: Symdef expansion keeps an *open path* set (a Symbol whose symdef is already being expanded is skipped), plus a visit budget of 4096 nodes per object and 500 000 per scene. `src/stage/mvr-gdtf.js`: GeometryReference target already open on the path is skipped (the old guard only caught `ref === node`); the fixture walk is capped at 4096 nodes / 512 parts. Reusing a symdef side by side (non-nested) is unaffected. |
| 7 | `routes-screens.js` (`src/api/`): `screenIdx` must be `0..15` (matches the `Math.min(16, …)` screen caps elsewhere) → 400 otherwise, so the legacy `screenLabels` padding loop cannot be driven to 1e9. `src/companion/satellite-preview-client.js` `subscribePageSession`: every row/col bound is truncated and clamped to `0..31`, min <= max (Companion pages are <= 32×32). `src/api/routes-companion-preview.js` not edited — it just forwards to the client, so the clamp sits at the single choke point. |
| 8 | `src/engine/scene-exit-layers.js:279`: `Math.max(1, Math.floor(resolveMaxBatchCommands(…) / 3))`. With cap 1–2 a 3-line batch exceeds the cap, `batchSend` rejects and the existing per-layer STOP/MIXER CLEAR fallback does the clear. |

## 3a. Verified — WO-830a

New tests (all mock- or temp-dir-based, no live state; the crash-class ones run the scenario in a child node process with an `uncaughtException` recorder):

- `tools/smoke/smoke-wo830a-ws-crash.test.js` (4 tests) — items 1–2, real http server + `ws` clients: `GET //` upgrade, 9 MiB frame on `/api/ws`, invalid-UTF-8 frame on `/api/video-feed`.
- `tools/smoke/smoke-wo830a-parsers.test.js` (16) — items 3, 6, 7, 8.
- `tools/smoke/smoke-wo830a-streams.test.js` (5) — items 4–5 (corrupt zip entry, `/dev/full` download), plus a valid-zip round trip.

Results: all 26 new tests pass on the fixed tree. Against the pre-fix tree (`git archive HEAD` copy, selected with `HIGHASCG_WO830A_ROOT`):
- items 1+2: child records `Invalid URL`, `Max payload size exceeded`, `Invalid WebSocket frame: invalid UTF-8 sequence` as uncaught exceptions, and no 400 is sent;
- item 3 (`nb_channels` 1e9, `/900000000/dBFS`), item 6 (self-referencing Symdef, 3 self-Symbols), item 7 (`screenIdx` 1e9, `colMax` 1e9): node dies with "JavaScript heap out of memory" (run with `--max-old-space-size=300`);
- item 6 GDTF A↔B reference cycle: test fails (unbounded parts);
- item 8 (cap 1 and 2): the process spins until killed by `timeout` (rc 124);
- item 4: extraction promise never settles (hang); item 5: the pre-fix loop shape against `/dev/full` ends in an uncaught `ENOSPC` (separate scratch repro).

Also run: the 52 existing smoke/test files that mention any touched module (393 tests, 0 fail), `eslint` on all changed files (0 new warnings; one pre-existing `broadcastLiveState` unused-var warning in ws-server.js), `check-max-file-lines` (nothing new over 500; ws-server.js is now exactly 500).

Open: actual-bytes cap in safe-unzip; new test files still need adding to the curated list `tools/ci/offline-test-files.js`.

## 2b. What was done (injection)

REPORT §2b items 9-15 and 23. None of these depend on auth enforcement (WO-811); all hold with it OFF.

- **9 Root command injection (vcam).** `src/virtual-output/v4l2-kernel-modules.js`: new `sanitizeCardLabel` (only `[A-Za-z0-9 ._-]`, max 64, everything else becomes `_`), `sanitizeAlsaId` (`[A-Za-z0-9_-]`) and `clampInt`; `writeVcamModulesConf` re-validates every value (VIDEO_NR 0-63, ALSA_INDEX 0-31, ALSA_PCM 1-8). `ALSA_ID` was also written unquoted from config, so it was a second injection point. `tools/runtime/highascg-vcam-modules-up.sh`: no longer `source`s the conf. It reads it line by line, requires `KEY=VALUE` with KEY from a fixed list, checks each value against a per-key regex and aborts on any unknown or odd line. Even the old root copy is safe against JS-written files now, because the JS only emits the safe charset.
- **10 Arbitrary file write.** New `src/api/caspar-config-path-guard.js`. `POST /api/caspar-config/apply` rejects (400) a `body.path` or `body.casparServer.configPath` that is not a `*.config` file in a trusted dir (default config dir, `CASPAR_CONFIG_PATH` dir, saved path's dir). The check uses realpath, including dangling symlinks, and refuses `..` and NUL. It runs before the body is merged into `ctx.config`. `writeCasparConfigToDisk` also refuses any target that is not `*.config` after symlink resolution, so a hostile saved settings path cannot be used either.
- **11 Server code replacement.** New `src/system/server-update-asset.js` (`resolveVerifiedAsset`, split out because `server-update.js` hit the 500-line limit). `startApplyJob` now installs only the asset the server resolved itself from the configured repo's release list. The name must match `highascg-server_[A-Za-z0-9._-]+.tar.gz`, and the URL must be `https://github.com/<repo>/releases/download/...` ending in that name. A body `assetUrl`/`assetName` is accepted only when it equals the verified asset, otherwise the call throws. The tar path is `basename(assetName)`.
- **12 Plugin RCE.** `src/plugins/plugin-manager.js`: `setEntry` refuses an invalid id and drops an invalid `moduleName`; `listPlugins` skips stored entries with an invalid id or moduleName (this covers the boot reload via `loadEnabledPlugins`); `resolvePlugin` and `enablePluginNow` re-validate. The `routes-plugins.js` enable route writes the entry first and then enables it, so the guard has to live in the manager. No route edit was needed.
- **13 authorized_keys injection.** `src/replication/replication-ssh-setup.js`: new `isValidPeerHost` (hostname, IPv4 or IPv6 literal only). `buildForcedCommandAuthorizedKeysEntry` returns null for an invalid `fromHost`, and `testReplicationSshToPeer` refuses one. `src/replication/connect-pair.js`: `registerFollowerOnLeader` rejects an invalid `followerHost` with 400, `connectToLeader` rejects an invalid `leaderHost`, and an invalid `followerCasparHost` falls back to `followerHost`.
- **14 rsync wrapper.** `tools/runtime/highascg-replication-ssh.sh`: the old `-*` pass-through is gone. Allowed options are `--server`, `--sender`, `--mkpath` and the short cluster `^-[vnlogDtprRz]+e\.[A-Za-z]*$`. The list was captured from real rsync 3.4.1 for the push, pull and dry-run probe commands (`sync-project-media-rsync.js`, `testReplicationSshToPeer`). A path token may no longer start with `-`.
- **15 Nuclear password fail-open.** `src/utils/nuclear-password.js`: `verifyNuclearPassword` requires an even-length hex salt of at least 8 bytes and a hex key of at least 16 bytes, and wraps scrypt in try/catch. `scrypt$ab$` and similar previously compared two 0-byte keys as equal.
- **23 AMCP CR/LF and parentheses.**
  - `src/caspar/amcp-utils.js`: `param()` now quotes on `[\s()]`. Bare tokens (`LINEAR`, `25`, `0.5`, `clip.mp4`, `folder/clip`) stay unquoted, so no wire string for normal commands changes. It already folded CR/LF and escaped `\` and `"`. `stripAmcpLineBreaks` is now exported.
  - `src/caspar/amcp-template-credential.js` `prepareAmcpLine`: folds CR/LF into a space. This is the single choke point for the single-command transport (`_sendPrepare`) and for every line of a BEGIN..COMMIT batch.
  - `src/engine/scene-template-cg.js`: the template name goes through `clipParamForPlay` (names with `/`, still always quoted) or `param()`.
  - `src/engine/timeline-playback-helpers.js` `buildEffectAmcpLinesPlayback`: numbers are coerced with a finite check and strings go through `param()`.
  - `src/api/routes-preview-nudge.js`: new `sanitizeEffectParams` runs on client effect params before they reach `buildEffectAmcpLines`.
- Out of scope: `buildEffectAmcpLines` in `scene-take-lbg-helpers.js` (wo833's file) still interpolates raw. The transport strip covers it, but it should reuse `buildEffectAmcpLinesPlayback`.

**Owner action (root copies are installed files, not mine to change):**
```
sudo install -m 0755 -o root -g root /home/casparcg/highascg/tools/runtime/highascg-vcam-modules-up.sh /usr/local/lib/highascg/highascg-vcam-modules-up.sh
sudo install -m 0755 -o root -g root /home/casparcg/highascg/tools/runtime/highascg-replication-ssh.sh /usr/local/bin/highascg-replication-ssh
```
The first is also what `scripts/setup/12-passwordless-sudo.sh` does on setup. The second is refreshed by the update drop helper only if already installed. Until the vcam script is reinstalled the old `source` still runs, but the JS no longer writes anything shell-active into the conf.

## 3b. Verified (injection)

- New `tools/smoke/smoke-wo830b-injection-validation.test.js`: 25 tests, all pass.
  - The vcam wrapper copy runs with a stubbed `modprobe` against `$(...)`, backtick, `;`, `PATH=` and `LD_PRELOAD=` confs: all refused, canary file never created. A valid conf still reaches `modprobe v4l2loopback ... card_label=Virtual cam`.
  - Caspar-config path guard: traversal, wrong name, outside dir, symlink dir, dangling symlink. The apply route returns 400 and writes nothing; `writeCasparConfigToDisk` refuses an `authorized_keys` target.
  - `resolveVerifiedAsset` cases, plugin id cases (including a stale stored entry on boot reload), host-validator cases, an `authorized_keys` entry with a newline `fromHost`, and `registerFollowerOnLeader` with a hostile host.
  - The rsync wrapper is run with a stubbed `rsync`: the 4 real option sets pass, `--daemon`, `--config=`, `--log-file=`, `--rsh`, `-T`, `--files-from`, `--write-batch`, `--delete` and `-e` are refused.
  - Nuclear-password broken-hash cases, `param()` cases, `prepareAmcpLine` CR/LF folding, `scene-template-cg`, timeline effect lines and the nudge sanitizer.
- Existing suites run on my changes and still green: `smoke-wo724-media-send-paths` (real rsync through the real wrapper), `smoke-replication-ssh-setup`, `smoke-virtual-camera`, `smoke-wo455/501/423-424/737/499`, `smoke-server-update-retain`, and about 260 other smokes that mention AMCP, CG, MIXER, `param(`, nuclear, plugin, replication, vcam, timeline or nudge. Failures in that run were not from these changes:
  - smoke-caspar-cls-id: `src/media/local-media-paths.js` is being changed by wo833.
  - smoke-stream-key-redaction: `stream-secret-redact.js` was touched at 11:03.
  - smoke-wo173-clip-start-batch: WO-837 `_layerChannels` is mid-edit.
  - smoke-wo379: shader stack clear, in wo833's area.
  - Sandbox smokes (wo725, wo730, wo753, ws-restart, wo749): `index.js` requires the missing `./src/sampling/dmx-sampling`, another agent's work in progress.
- eslint on all changed files: 0 errors (2 pre-existing unused-var warnings). `check-max-file-lines.js`: my files are under 500 (the one reported file, `client/lib/math-input.js`, is not mine).
- Not done live: no AMCP was sent, no API POST, no sudo. The root wrapper copies are unchanged (see the owner commands above).

## 2c. What was done (secrets/UI)

- **16 Nuclear password (web + Godot).** Web: `#set-nuclear-password` is now only the password that authorizes actions; `buildSettingsPayload` no longer sends it as `ui.nuclearPassword`, the password-field container is excluded from autosave (settings-modal.js `onSettingsFieldChange`), hydrate no longer prefills it. New explicit "Set a new password" block (new + repeat + "Set password" button, `validateNewNuclearPassword` in settings-nuclear-shared.js) that POSTs `{ui:{nuclearPassword}}`. Godot had the same flaw (settings_panes.gd `nuclear()` committed on Enter AND focus-out): now new + repeat + button, validation in `nuclear_model.gd new_password_error`.
- **17 Redaction echo.** Client: new `client/lib/settings-redacted.js stripRedacted`, used by `settingsState.save()` and the modal autosave POST. Server: `settings-post.js` strips every `"[REDACTED]"` value from the body (`stripRedactedMarkers`), never accepts `ui.nuclearPasswordHash` from a client, and an omitted `ui.nuclearPassword` now means "keep the stored hash" (same as the explicit mask).
- **18 Open redirect.** `login-page.js safeNext` checks raw and percent-decoded form (single leading `/`, no `//`, no backslash, no control chars); the served script applies the same rule before `location.replace`.
- **19 Malformed cookie.** `auth.js parseCookies` try/catch around `decodeURIComponent` (covers routes-auth.js via `extractAuthTokenFromRequest`).
- **20 Support-bundle redaction.** `redactObject(obj, {forSupport:true})` adds passphrase/passwd/psk/credential/streamkey/streamid/`*Key` keys and masks rtmp/srt URLs inside any string; the base regex is unchanged because GET /api/settings shares it (Devices round-trips `srtStreamId`). `redactStreamUrl` masks SRT `streamid` and `key|token|secret|password` query params (also RTMP query). `build-support-bundle.js` uses it for config/inventory/network and runs the three log files through `redactAmcpCommandForLog`.
- **21 SRT passphrase.** `buildSrtOutputUrl` throws `SRT_PASSPHRASE_INVALID` (message never contains the passphrase) outside 10-79 chars; `routes-streaming-channel-rtmp.js` turns it into a 400 `{error}` + warn log + `lastError`, no ADD STREAM is sent.
- **22 Config log.** `index.js` logs `redactObject(config, {forSupport:true})`.
- **24 Release.** `make-github-release-server.sh`: refuses uncommitted tracked changes (`--allow-dirty` to override; dry-run warns), documents the git-worktree recipe, and after `tar` fails + deletes the archive if it holds key/identity files.

## 3c. Verified

- `node --test tools/smoke/smoke-wo830c-secrets.test.js` (11 tests: payload/autosave pins, stripRedacted, settings POST with/without stored hash, open-redirect table + served script in `vm`, malformed cookie, redaction table, support bundle, SRT 400 through `handlePostRtmp` with mocked AMCP, index.js pin, release guard in a temp git repo) all pass. Repointed (honestly) `smoke-stream-output-ndi-srt` (drop -> refuse) and `smoke-stream-key-redaction` (streamid now masked).
- Related suites green (96 tests incl. wo261, wo244, wo611, log-record, api-auth, wo619, wo645, wo802...). eslint clean on changed files. Godot headless `run_tests.gd`: 23066 passed, 0 failed; `run-client.sh --check` boot OK.
- Not verified here: web UI in a browser (needs `npm run build:client` by the coordinator), Godot pane visually.

## 3d. Live re-test on the box (30.10, 16:25; node pid 3932352, restarted 15:57 with these changes)

- **Item 1.** A raw `GET //` WebSocket upgrade to :4200 → `HTTP/1.1 400 Bad Request`.
- **Item 2.** A 9 MiB frame on `/api/ws`:
  - the client sees close 1009;
  - the journal logs `[WS] socket error: Max payload size exceeded`;
  - node keeps its pid and the API answers 200 afterwards.
- **Item 3.** Caspar OSC is bound to `127.0.0.1:6251` only (`ss -ulpn`). It was the wildcard before.
- **Item 7.** `POST /api/screens/label {screenIdx: 1e9}` → 400 `screenIdx must be an integer from 0 to 15`.
- **Item 19.** A request with a malformed cookie (`%E0%A4%A`) → 200, with no crash.
- **Items 16–17.** `dist-web` (built 14:01) carries the new Set-password block and the `[REDACTED]` strip.
- **Not probed live** (offline tests cover them):
  - 10 caspar-config apply path (a wrong guard would write and apply a Caspar config);
  - 11 server update; 12 plugins; 13 replication pairing;
  - the zip, ingest and MVR parsers.
- **Root copies (§2b):** `cmp` against the installed `/usr/local/lib/highascg/highascg-vcam-modules-up.sh` and
  `/usr/local/bin/highascg-replication-ssh` both differed at 16:25. The owner ran the two `sudo install` lines; `cmp` then
  shows both identical to `tools/runtime/`, owned by root with mode 755.
