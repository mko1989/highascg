# Code sweep 29.10.2026 — report for decision

Every tracked code file of HighAsCG was read in full, one batch at a time, by a sweep agent working under the
contract in [README.md](README.md). The per-file findings are in the batch MD files indexed by
[COVERAGE.md](COVERAGE.md). This report is the decision list. It covers the high-severity bugs first, then the
notable bugs by area, then dead code and quality themes. Each entry carries a recommendation.

**Coverage: 140/140 batches done.** Totals across all batch files: 28 BUG-HIGH, 470 BUG, 721 DEAD, 766 RISK, 1643 QUALITY.

**How to read the tags**

- **[V]**: I re-checked the finding myself by reading the code, running it, or reproducing it. Every finding
  in this report's tables has [V] unless it says otherwise.
- **[A]**: the sweep agent reproduced it (with a mock, a scratch dir or a loopback) and I checked that the code
  matches the description.

The sweep itself was read-only. Since then, two things in this report are fixed: the two WO-828 smoke fixes
(`3c736ad5`) and the timeline items 3a–3d (WO-829, `1fe41899`). Everything else waits for your decision.

---

## 1. Decisions needed first

1. **WO-811 (auth) is no longer only about a login screen.** Section 2 lists 13 ways a device on the LAN can
   restart node, replace the server code, write any file, or get a root shell. Most of them only matter because
   `enforceAuth` is off and node listens on `0.0.0.0:4200`.
   - **Recommendation:** fix the crash class and the injection class (2a, 2b) regardless of auth, because they
     are cheap and some are reachable before auth anyway. Then decide whether to turn WO-811 enforcement on, or
     to bind the API to the operator NIC only.
2. **The next ISO build is broken** (4a). It is a one-line path change, but it must happen before the next
   `eggs produce`. While you are there, the kernel pin file (4c) must be fixed, or the documented sync script
   purges the running kernel.
3. **On-air timeline bugs** (3a–3d) sit in the WO-828 area: timeline in a look. WO-828's own scenarios pass, but
   a timeline that loops while a clip ends exactly at its end, and a timeline edited while on air, both leave
   stale picture on PGM.
   - **Done:** WO-829 fixes 3a–3d and the deleted-layer half of 3j, with a smoke and a live wire test.
4. **Delete or keep the dead modules** listed in section 6. The biggest ones are `src/sampling` (deprecated by
   WO-807), `client/tools/to-server/`, `scene-take-pgm-only.js` and `pixel-mapping-browser.js`.
5. **Decide the policy for tests that touch the live box** (section 7b): several smokes send AMCP to ch1, POST
   TAKE to the live API, or write into live `config/`, `data/` or `/run/highascg`.

---

## 2. Security and remote crash — the WO-811 group (BUG-HIGH)

### 2a. One request from the LAN restarts node

`process-guards` calls `process.exit(1)` on any uncaught exception, so each item below is a remote restart. On a
show, that means a PGM hiccup and every client reconnecting.

| # | Finding | Where | Check | Fix |
|---|---|---|---|---|
| 1 | `GET // HTTP/1.1` with `Upgrade`: `new URL("//", base)` throws before auth | src/system/video-feed.js:131 | [V] | try/catch → 400 |
| 2 | WebSocket frame over 8 MiB, or invalid UTF-8: there is no `ws.on('error')` | src/server/ws-server.js:283,422 | [V] grep | add the listener |
| 3 | One OSC datagram with a huge `nb_channels` drives an unbounded push loop (UDP :6251 on 0.0.0.0) | src/osc/osc-state-audio.js:48,96 | [A] | clamp, bind 127.0.0.1 |
| 4 | Corrupt zip entry in an upload: the entry stream error is uncaught | src/utils/safe-unzip.js:45-51 | [A] | `pipeline()` |
| 5 | Ingest download on a full disk: the write-stream 'error' listener is attached after the loop | src/api/routes-ingest.js:360-383 | [V][A] /dev/full | listener first, plus backpressure |
| 6 | Crafted MVR/GDTF with a self-referencing Symdef: a 420 B file expands to 131k parts and OOM | src/stage/mvr-scene.js:74-87, mvr-gdtf.js:58-69 | [A] | visited-set and depth cap |
| 7 | `/api/screens/<huge idx>` and companion preview `rowMax`/`colMax` have no bounds, so the heap OOMs | routes-screens.js:79, routes-companion-preview.js:140, satellite-preview-client.js:174 | [A] | clamp |
| 8 | `amcp_max_batch_commands` 1 or 2 gives chunkSize 0, an infinite loop, and a frozen node | src/engine/scene-exit-layers.js:278 | [A] | `max(1, …)` |

### 2b. Code execution, file write and secrets

| # | Finding | Where | Check | Fix |
|---|---|---|---|---|
| 9 | **Root command injection.** A virtual camera label `$(cmd)` is written to `/run/highascg/vcam-modules.conf`, which the NOPASSWD root wrapper runs `source` on | src/virtual-output/v4l2-kernel-modules.js:64-86 + tools/runtime/highascg-vcam-modules-up.sh:14 | [V] | parse key=value; never `source` |
| 10 | **Arbitrary file write.** `POST /api/caspar-config/apply` with `body.path` writes `body.xml` to any path, e.g. `~/.ssh/authorized_keys` | src/api/routes-caspar-config.js:316-328 | [V] | allow only the Caspar config dir and `*.config` |
| 11 | **Server code replacement.** `POST /api/system/update/apply` takes `assetUrl`/`assetName` from the body with no host or repo check, no checksum, and `../` in the name. The nuclear-password gate is open on this box | src/system/server-update.js:389-418 | [V] | use only the verified release asset; validate the name |
| 12 | **Plugin RCE.** An `enable` id like `../../..` makes node `require()` any `register.js`, and it re-requires it on every boot | src/plugins/plugin-manager.js:123-196 | [V] path | validate the id against the catalog |
| 13 | **Replication authorized_keys injection.** A newline in `followerHost` plants an unrestricted key line, which gives a full shell as casparcg | src/replication/connect-pair.js:277-291 → replication-ssh-setup.js:91 | [V] | reject any host that is not a hostname or IP |
| 14 | **Replication rsync wrapper** lets any `-*` option through, e.g. `--daemon --config=…` or `--log-file=`, so the peer can read and write any file | tools/runtime/highascg-replication-ssh.sh:58,112-119 | [A] local rsync | allow-list the options |
| 15 | **The nuclear password fails open** on an empty or undecodable stored hash: a 0-byte key compares equal | src/utils/nuclear-password.js:29-39 | [V] node -e | reject a key shorter than 16 bytes |
| 16 | The Settings nuclear-password field autosaves the typed value as the NEW password, so a typo'd reboot attempt replaces it | client/components/settings-modal.js:250-257 | [A] | a separate "set password" action |
| 17 | `settings-state.save()` posts the redacted GET back, which can store `"[REDACTED]"` as the hash | client/lib/settings-state.js:139 | [A] | never echo GET (memory: settings-post) |
| 18 | Open redirect: `/login?next=/%09/evil.example` | src/server/login-page.js:14,63 | [A] | allow only same-origin paths |
| 19 | Malformed cookie → `decodeURIComponent` throws → 502 instead of 401 on every gated route once auth is on | src/server/auth.js:119, routes-auth.js:22 | [A] | try/catch |
| 20 | Support bundles don't redact the SRT passphrase, stream keys, RTMP key URLs or the SRT streamid | src/support/redact-settings.js:3, stream-secret-redact.js:35 | [A] | extend the redaction lists |
| 21 | An SRT passphrase outside 10–79 chars is silently dropped, so the stream goes out **unencrypted** | src/streaming/streaming-channel-ffmpeg.js:140 | [A] | refuse to start; show an error |
| 22 | `index.js` logs the full config JSON to the journal and to the Logs-modal WS broadcast | index.js:106 | [V] | redact or drop |
| 23 | AMCP CR/LF injection: effect params, template names and preview-nudge params are not escaped; `param()` quotes only on whitespace, not `(`/`)` | routes-preview-nudge.js:79, scene-template-cg.js:165, amcp-utils.js:21, timeline helpers.js:37 | [A] | send everything through `param()`; quote on `[\s()]`; strip CR/LF in the transport |
| 24 | Release tarballs are built from the LIVE tree with no clean-worktree guard. The 57 local `dist/*.tar.gz` (newest 04.10) contain the TLS and device-identity private keys. **Today's public release 2026-10-30_052541 is clean.** | tools/release/make-github-release-server.sh:22 | [V] public asset | refuse a dirty tree; delete the old local tarballs |
| 25 | All nuclear routes (reboot, shutdown, restart) are open to the LAN: bind 0.0.0.0, `enforceAuth` false, `nuclearRequirePassword` false | src/api/routes-system*.js | [V] config | WO-811 decision |

**Recommendation.** Make WO-830 "LAN-hardening" one WO with three commits:

- items 1–8 (crash);
- items 9–15 and 23 (injection and validation);
- items 16–22 and 24 (secrets and UI).

None of these needs the auth decision.

---

## 3. On-air bugs (BUG-HIGH)

| # | Finding | Where | Check |
|---|---|---|---|
| 3a | A timeline loop wrap, or a retake, resets `_prevKey` without stopping layers. A clip that ends at the timeline end stays on air for the whole next pass (no `STOP 1-211`) | src/engine/timeline-playback-runtime.js:82-86 | [V] ran t2.js — **fixed WO-829** |
| 3b | `update()` of an on-air timeline stores the new timeline before `setSendTo`, so `routingChanged` is always false. Removing PGM from a timeline that is on air never STOPs PGM | src/engine/timeline-engine.js:67-74 | [V] read — **fixed WO-829** |
| 3c | The opacity lead tween is computed at clip-local 0, even when the transport starts mid-clip. That gives OPACITY 1 instead of the keyframed value, and the cache stops it ever being corrected | src/engine/timeline-playback-amcp-send.js:354-404 | [A] mock — **fixed WO-829** |
| 3d | Tween durations use the timeline fps (25), but Caspar counts channel frames (50p), so keyframed fades run at half length. `amcp-send.js:356` also hard-codes fps 25 | amcp-schedule.js:127,252,297 | [A] — **fixed WO-829** |
| 3e | The +Animate exit fade goes to the logical layer, not to `phys(ln, activeBank)`. On bank B the removed layer pops instead of fading | src/engine/scene-take-lbg-merge.js:45 | [V] read |
| 3f | A Phase B PLAY batch failure is only logged. The take still flips the bank and returns `{ok:true}`, so `scene.live` names a look while PGM is black | scene-take-lbg-amcp-pipeline.js:364 | [A] |
| 3g | Shader Live "clear from stack" calls `ctx.amcp.send`, which does not exist. It always returns 500 and the shader stays on air | src/api/routes-shader-stack.js:73,77 | [V] |
| 3h | `POST /api/swap` and the WS swap throw a TypeError, because AmcpClient has no `swap` (only `basic.swap`) | routes-amcp.js:261 | [V] |
| 3i | Media delete, move and LOADBG resolve the ACTIVE project's copy before the id given, and the stem fallback maps `B/INTRO` to `a/intro.mp4`. The wrong clip gets deleted or loaded | src/media/local-media-paths.js:149, local-media-api.js:133 | [A] real slug |
| 3j | A layer removed from an on-air timeline keeps playing (**fixed WO-829**). The neutral reset omits ROTATION, ANCHOR, GRID and KEYER, so a removed rotation leaves the layer rotated | timeline-engine.js:78-81, timeline-playback-helpers.js:14-27 | [A] |
| 3k | The web client's PRV look push sends dB to the linear `MIXER VOLUME`: unity gain → 0 (silent PRV), 0.5 → -6 | client/lib/scenes-preview-push-scene.js:253,289,331 | [V] (web only) |
| 3l | The streaming channel route ignores `channel_<N>` and plays `route://1` (PGM) | src/config/routing-map.js:470-483 | [A] |
| 3m | A malformed JSON body to `POST /api/clear` (and others) parses to `{}`, the channel defaults to 1, and **PGM is cleared**. `GET /api/mixer/clear` runs the POST handler | routes-amcp.js:241, response.js:9, routes-mixer.js:216 | [A] |
| 3n | The PIP band (260–979) overlaps the live-input audio routes (321–328) and the template CG band (700–899). `MIXER 3-321 CLEAR` un-hides an input on a look with 16+ layers | engine/pip-overlay.js, look-layer-ranges.js | RISK |

**Status.** 3a–3d and the deleted-layer half of 3j are fixed in WO-829; the neutral-reset half of 3j is left for your call. Make 3e–3h one small engine WO. Make 3i its
own WO, because it is data-destructive. 3k and 3l are one-liners.

## 4. Build, ops and data loss (BUG-HIGH)

| # | Finding | Where | Check |
|---|---|---|---|
| 4a | **The next ISO build exits 1.** `install-eggs-live-grub-theme.sh` requires `/usr/lib/penguins-eggs/…`, which eggs 26.10.25 removed; the theme now lives in `/etc/penguins-eggs.d/branding.default` | tools/eggs/live-usb/install-eggs-live-grub-theme.sh:21-31 | [V] |
| 4b | The liveroot bind-mount guard fails OPEN under pipefail (`… \| grep -q .`, SIGPIPE) exactly when many host mounts are bound, which is the case where eggs `rm -rf`'s the liveroot | tools/eggs/live-usb/eggs-liveroot-safety.sh:55-58 | [V] |
| 4c | `/etc/highascg/pinned-kernel` = 6.8.0-117, but the box runs 7.0.0-38. `sync-eggs-kernel-and-purge-stale.sh` would **purge the running kernel**, and `verify-eggs-prepare-host.sh` always fails | tools/eggs/… :25,53-61 | [V] |
| 4d | `08-caspar-cef-scanner.sh` resets `SCRIPT_DIR`, so it stops **and disables** casparcg-server. `reinstall-cef.sh`, the documented CEF repair, execs it | scripts/setup/08-caspar-cef-scanner.sh:14,62-69 | [V] |
| 4e | Replication boot reload runs before `ctx._replication` is set, so it is a no-op and the peer client never starts after a restart. `leaderYield` doesn't persist the role, so both boxes come back as leader | replication-service.js:129-131, promote.js:79-107 | [A] |
| 4f | The Godot timeline splitter drag saves a `ConfigFile` loaded at tab build. That clobbers every `ui.cfg` key written since: haze, previs folds, the per-origin API password | godot/…/timeline_tab.gd:77-82 | [V] |
| 4g | Renaming a project to an existing slug silently overwrites the other project | routes-data-project-handlers.js:333-363 | [A] |
| 4h | Deleting the LAST look never persists (`[]` is treated as absent) | src/engine/project-scenes.js:311-317 | [A] |
| 4i | An unparsable `general.json` is not quarantined, so the next save rewrites it from defaults and about 60 keys are lost | src/config/config-manager.js:290-297 | [A] |
| 4j | `atomic-file-write` uses a fixed `.tmp` name, so concurrent writes give ENOENT and data loss | src/utils/atomic-file-write.js:26 | [A] |
| 4k | `dev-push.sh` remote cleanup deletes every top-level entry not on its keep list, so the target loses `data/`, `.private/api-token` and `projects/` | scripts/deploy/dev-push.sh:98,109 | [A] |
| 4l | A multiview of non-standard size emits `<video-mode>custom</video-mode>` with no custom mode, so Apply writes a casparcg.config that won't boot | config-generator-consumer-attach.js:45,142 | [A] 1728×960 |
| 4m | The pointer-confine barrier constants are wrong (NegX/PosY), so the pointer escapes through the right and top edges | tools/runtime/confine-pointer-barriers.py:49-52 | [V] xfixeswire.h |
| 4n | The Godot test runner calls `quit(failures)` with an 8-bit exit, so 256 failures exit 0 and CI stays green | godot/client/tests/run_tests.gd:36 | [A] |
| 4o | Electron launcher: curly quotes in `index.html` kill the renderer (launcher only, not the box) | client/tools/electron-launcher/index.html:107 | [V] xxd |
| 4p | Web Device View: `1920x1080@50` matches `1080i5000` before `1080p5000` (list order) and is saved to the screen consumer as interlaced | device-view-destinations-inspector-modes.js:139-144 | [V] |
| 4q | Web Device View: Ctrl+Z and Delete are document-wide with no focus guard, so typing in another tab rolls back the live device graph | device-view-events.js:205-212 | [A] |

---

## 5. Other notable bugs, by area (BUG)

These are short. The batch MD has the failing case and the fix for each.

- **Look and take engine**
  - Teardown waits a full 2× fadeMs, because it polls the bank-A layer that never faded.
  - `ftb` duration 0 becomes 25 frames.
  - The global-border PRV mirror loses the PGM `enabled` flag.
  - New Project carries the old multiview layout.
  - Live-scene clears are fire-and-forget, then it broadcasts "live".
- **AMCP client**
  - A single-command timeout resets the send queue, so later commands overtake (STOP before CLEAR).
  - 500 FAILED swallows the next reply.
  - PING always times out.
  - `stop()` doesn't stop auto-reconnect.
- **Art-Net / sACN**
  - ArtDmx Length is read little-endian, so trimmed universes throw on every packet.
  - sACN 0–100 % is treated as 0–255, so the border is always OFF.
  - A project disk parse runs on every changed DMX frame (about 0.6 s/s main-thread block).
  - The follow self-loop guard is never re-evaluated (memory: artnet-out-loops).
- **Audio**
  - `setDefaultAlsaDevice` overwrites the whole `~/.asoundrc`.
  - Volume controls without a switch parse as OFF.
  - A removed live-audio slot keeps its PGM routes, so the next device goes straight to PGM (web and Godot).
- **Replication**
  - Timeline id traversal.
  - `connectToLeader` saves follower config before the leader answers, with no rollback.
  - The playhead export SEEKs 2000 instead of 1000 at 25 fps.
- **Media and thumbnails**
  - Custom thumbnail upload always writes 0 bytes.
  - PRINT capture matches the "newest PNG", which crosses channels.
  - Inode relink after a delete rewrites project references.
  - The ffprobe cache is never invalidated.
- **Godot client**
  - The media inspector re-saves trim on every blur and parses m:ss.FF as decimal seconds, which causes silent trim drift (WO-813 area).
  - countdown and lower-third sections POST the old layer's config to a newly selected layer (debounce after reassign).
  - The MIX + MERGE preset migrates to "MIX+ ANIMATE" and becomes a CUT. The web client does the same, and a golden test pins the wrong output.
  - Timeline snap is off by one frame when an edge sits exactly on a snap point. The web client has the same bug.
  - The timeline view has no vertical scroll.
  - Previs: Delete in Camera mode deletes the selected stage object.
  - The pixel map creates a 1×1 region on a click at zoom ≥13×.
- **Web client**
  - Countdown pos/font edits wipe each other (WO-320A pos never persists).
  - Several RMW-with-cached-GET silent reverts (WO-436 class).
  - Document shortcuts have no text-field guard: Space toggles playback, Ctrl+V pastes a clip.
- **Ops scripts**
  - The exFAT late-plug pipeline mostly never runs (68 "not mounted" vs 46 finished in the journal).
  - The DeckLink install reports "ok" on a failed `dpkg -i`.
  - `flash-stick-common` reports a failed exFAT format as success.
  - The Caspar supervisor's crash-loop give-up can never fire.
  - `tailscale-up` with an empty hostname sends `--hostname 0`.
  - The power button listener picks the Sleep button.
  - `install.sh` 26.04 package names have no candidate (`libsfml-*2.6`, `policykit-1`).
- **Tracking**
  - The presenter consent text says the photo is "deleted when the server restarts", but WO-675 reloads the roster. **Owner decision:** fix the text or the behaviour.
- **Demo (WO-815)**
  - The public demo `settings.json` still contains the venue names "Dioda" and "Proj" (`build-demo-data.py:175,198`).

## 6. Dead code — deletion candidates

Each one was grep-proven by its agent across client, src, godot, tools, scripts, CI and the string-concat
requires. Smoke-pinned text counts as live and is excluded.

| Candidate | Size | Note |
|---|---|---|
| `src/sampling/` | module | Deprecated by WO-807 and disabled in config. It also has 6 bugs. **Delete.** |
| `client/tools/to-server/` | ~20 files | Stale server patches, including a pre-WO-687 archive script that leaks keys. **Delete.** |
| `src/engine/scene-take-pgm-only.js` | 482 lines | Only a smoke uses it. Delete it together with the smoke. |
| `client/components/pixel-mapping-browser.js` | file | Would wipe the state store if rewired. |
| `client/components/sync-modal.js`, `publish-modal.js`, `preview-panel-math.js`, `inspector-panel-routing.js`, `device-view-refresh.js`, `replication-status-banner.js` | files | Unreferenced. |
| `device-view-bands-render.js` | ~270 lines | Unreferenced. |
| Dead CSS: `03d-mapping-editor.css`, 07b2/09a2/09b2/09b3/launcher-04 blocks, streaming/sync/publish CSS | ~700 lines | |
| `src/engine` WO-218 SWAP and equality-skip code | branches | Dead in production. |
| `caspar-restart-dirty-policy.js`, `show-revision-reconcile.js` (WO-495), Syncthing REST helpers | files | |
| `scripts/deprecated/`, `scripts/fix/*` (call a missing script), `install-exfat-units-{bridge,enable,exfat}.sh` | scripts | See scripts-deprecated.md for the per-file verdicts. |
| `tools/eggs/unused/`, the two WO-273 replication tools | scripts | Owner call: WO-273 kept them. |
| Godot test-only model functions (cable_model build/_relax, previs_uv_mapper.gd, network block in server_controls …) | ~300 lines | Golden tests are their only callers. |
| Unreachable routes: `/api/misc/*`, `/api/data/*` (410), `/api/config/apply`, the led-test-card POST shadow, `/api/system/caspar-arm` | routes | `routes-system-licenses.js` was never registered (WO-495 owner call). |

**Recommendation.** Make one WO-831 "dead code removal" with a commit per row, each running the offline suite.
The unwired-exports baseline will shrink as a side effect.

## 7. Quality themes

**a. The CI gates are weaker than they look.**

- The Godot runner exits 0 on 256 failures (4n).
- Godot tests are not awaited, so assert-then-crash counts as a pass.
- `npm-audit-ci.js` passes on a registry error.
- `check-unwired-exports.js` sees no names in a single-line `module.exports = {a, b}`, so **413 src files are
  never gated**, and `index.js` and `test/` are not roots.
- `check-script-paths.js` exits 1 today and is in no workflow.
- About 150 smoke files are not in the curated list. 23 have no npm script at all.
- Several assertions cannot fail (always-true asserts, `slice(indexOf)` pins, a skip on a missing optional dep).
- **Recommendation:** fix the four gate bugs, then curate the uncurated smokes in one pass, or delete them.

**b. Tests that touch the live box.**

- `smoke-amcp-migration-air-paths` CLEARs 1-10..15.
- `highascg-live-amcp` PLAYs on ch1.
- `smoke-scene-take.js` POSTs a forceCut TAKE.
- `smoke-replication-failover.js` POSTs leader-yield.
- Others write live `config/device-identity.json`, `/run/highascg/vcam-modules.conf`, `~/.config/highascg/caspar-env`, `data/shaders`, `template/shaders` or `projects/`, or mkdir on `/home/casparcg/exfat`.
- None of these are in CI, but `npm run …` reaches them.
- **Recommendation:** an env opt-in guard (`HIGHASCG_LIVE_TESTS=1`) in a shared helper, plus temp roots, the way
  `projects-root.js` does it since 8b9fc4e.

**c. Repeated patterns, each worth one grep-driven fix.**

- **process-guards exit(1) plus missing error handlers** (section 2a). Audit for `.pipe(` without `pipeline`,
  sockets and child processes without 'error', and sync throws in listeners.
- **AMCP escaping:** `escape only "` and raw concatenation in about 8 places. Route everything through `param()`,
  and make `param()` quote on parentheses.
- **`count + 1` id generation** gives duplicate ids after a removal, in both clients (device-view-matrix,
  bands-render, mapping-node-service, output_ports_model, device-graph-suggest).
- **Debounce-after-reassign** in Godot sections (countdown, lower third): flush before switching the target.
- **RULES 2 maths in number fields.** `NumericField.install()` already gives every SpinBox select-all plus maths.
  Only plain LineEdits need `math_line()`, and these miss it:
  - countdown position px
  - gpu_output_controls X/Y
  - host_live_controls:144
  - stream_record_model:90
  - decklink buffer depth
  - timeline_math.parse_tc
  - timeline_flags.parse_hms

  Web `math-input.js` "100+" commits 100, and a smoke pins that. **Owner decision:** is "100+" an error or 100?
- **Hand-listed config merges** silently drop new keys: settings-post `newConfig`
  (`gpuPhysicalTopologyOperatorSaved`), getExportData, and the scene-take payload (contentZoom,
  timersVisibility).

**d. Files at the 500-line limit:** `main.gd` (499, about 320 lines of inline probes) and `media_panel.gd`
(498). The next change to either will need a split.

**e. Last batches (130–139): tools/smoke, tools/startup, tools/sweep, tools/tracking-detect, tools/wiki.**

- **BUG-HIGH [V]** `tools/startup/stick-boot-test/stick-test-lib.sh:45` and `tests/test-03-exfat-operator.sh:5` call
  `findmnt -L`, which is not an option (`invalid option -- 'L'`; the filter is `-S LABEL=`). With the stick
  mounted, test-03 exits under `set -e` and kills the stick QA run. `tools/eggs/live-usb/flash-stick-common.sh:300`
  has the same flag.
- **BUG** Stick tests: `grep -c … || echo 0` produces "0\n0", so test-05 reports FAIL on a healthy box. `test-12`
  does `exit 0` in a sourced file, so FAILs go uncounted. test-06 counts the run.sh child as a second supervisor.
- **BUG** `tools/sweep/sweep-util.js:36`: `request()` never settles when the peer drops mid-body, and the
  after-update sweep is spawned with no timeout, so it can hang forever.
- **BUG** `diagnose-screen-consumers.sh:82` reads the Vite dev port (4350) instead of the API port (4200).
- **BUG** `tools/wiki/md-to-html.js:27,30`: link labels with code render as `&lt;code&gt;` on 25 pages. The
  committed `docs/wiki-site` is stale (83 pages vs 91).
- **Smokes:** all 50–63 files per batch are curated and their pins match. The weak spots are smokes that touch live
  state, listed in 7b:
  - wo577 and wo379 write `data/shaders`;
  - wo670 opens real TCP connections to 10.0.0.6/7;
  - wo796 binds :6454;
  - ws-restart-reconnect spawns a second node with the live config.

  Several assertions are vacuous:
  - wo574, a stale pin where indexOf returns -1;
  - zip-slip, whose fixture build fails so the guard is never exercised;
  - wo737, which returns early on any box with `.git`.

## 8. Proposed work orders

| WO | Scope | Size |
|---|---|---|
| WO-829 | Timeline-in-look follow-up: 3a–3d + 3j layer STOP **done** | — |
| WO-830 | LAN hardening: section 2, except the auth switch itself | M |
| WO-831 | Dead code removal: section 6 | M |
| — | ISO build: 4a, 4b, 4c, before the next produce | S |
| — | CI gate fixes: 7a, plus the live-touching test guard (7b) | S |
| — | Engine one-liners: 3e–3h, 3k, 3l, 3m | S |
| — | Media resolve order: 3i | S |

Only WO-829 has been filed (and mostly done). The other rows are proposals waiting for your yes/no.
