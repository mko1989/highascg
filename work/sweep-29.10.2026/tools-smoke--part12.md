# tools/smoke — sweep 29.10.2026 (batch 133)

Files: 41 · lines: 6969 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 2 RISK, 12 QUALITY

## tools/smoke/smoke-wo700-calibrate-heads-lighting.test.js
- `OK`
## tools/smoke/smoke-wo702-iso-live-boot-defects.test.js
- `OK`
## tools/smoke/smoke-wo704-decklink-dkms-cache.test.js
- `QUALITY` tools/smoke/smoke-wo704-decklink-dkms-cache.test.js:103 — `freshInstall` is `fs.rmSync(box.tree, …) || fs.rmSync(box.sys, …)`. It works only because `rmSync` returns undefined, so both removals run. Misleading. Fix: two statements.
## tools/smoke/smoke-wo705-dock-loads-when-server-up.test.js
- `OK`
## tools/smoke/smoke-wo706-mvr-wall-layers.test.js
- `OK`
## tools/smoke/smoke-wo707-follow-auto.test.js
- `OK`
## tools/smoke/smoke-wo708-auto-split.test.js
- `RISK` tools/smoke/smoke-wo708-auto-split.test.js:396-418 — "through the tracking module" calls `registry.bootOne('tracking', ctx)`. Its onBoot runs `createPresenters(ctx, {hub})`, which loads `roster.json` from `DIR = os.tmpdir()/highascg-presenters` (src/tracking/presenters.js:26). That path is not redirected under `node --test`, and the offline runner does not set `HIGHASCG_PRESENTERS_DIR` (only tools/e2e/sandbox-server.js does). The test therefore reads the box's live presenter roster. I found no write on boot (save runs only on change), but nothing guards it. Fix: set `HIGHASCG_PRESENTERS_DIR` to a test temp dir before the boot, as the other stores do.
## tools/smoke/smoke-wo709-auto-home.test.js
- `OK`
## tools/smoke/smoke-wo710-tracking-overlay.test.js
- `QUALITY` tools/smoke/smoke-wo710-tracking-overlay.test.js:54-64 — "files stay under the 500-line limit" re-implements tools/ci/check-max-file-lines.js for five files with `split('\n').length <= 501`. CI counts `split − (endsWith('\n') ? 1 : 0)` (check-max-file-lines.js:55), so a 501-line file without a trailing newline passes here but fails CI. Drop it (CI already checks every file) or use CI's count.
- `QUALITY` tools/smoke/smoke-wo710-tracking-overlay.test.js:50 — `(src.match(/Button\.new\(\)/g) || []).length === 1` counts source occurrences. A refactor that adds a `Button.new()` call breaks the test with no behaviour change. The focus-mode pin on line 51 already covers the behaviour.
## tools/smoke/smoke-wo711-ptz-visca.test.js
- `OK`
## tools/smoke/smoke-wo712-air-rules.test.js
- `OK`
## tools/smoke/smoke-wo712-cluster-call.test.js
- `OK`
## tools/smoke/smoke-wo712-exchange.test.js
- `QUALITY` tools/smoke/smoke-wo712-exchange.test.js:21-31 — `verify`, `keyPair` and the ed25519 setup are copied from tools/smoke/smoke-wo712-cluster-call.test.js:23-33. A shared helper under tools/smoke/lib would remove the duplication.
## tools/smoke/smoke-wo712-server-duties.test.js
- `QUALITY` tools/smoke/smoke-wo712-server-duties.test.js:349-352 — "auto is exported as a flag only" asserts on `mk({ auto: false }).d`, a stub built in this file. It never reads src/cluster/server-duties.js and passes regardless of production code. Test the real `createServerDuties` (has('auto') with a linked tracking peer) or delete it.
## tools/smoke/smoke-wo713-person-on-mark.test.js
- `OK`
## tools/smoke/smoke-wo713-ptz-calibrate.test.js
- `QUALITY` tools/smoke/smoke-wo713-ptz-calibrate.test.js:72 — `lastUnits(sent.slice(0, 2).slice(-1))` is an obscure way to take `sent[1]` (the pan-tilt datagram; `sent[0]` is the zoom). Use `sent[1]`.
## tools/smoke/smoke-wo715-osc-bundle-once.test.js
- `QUALITY` tools/smoke/smoke-wo715-osc-bundle-once.test.js:18-25 — `freePort()` binds port 0, closes, and returns the number before OscListener binds it. Another process can take the port in between (low-likelihood flake).
## tools/smoke/smoke-wo716-vsync-off-gpu-texture-every-screen.test.js
- `OK`
## tools/smoke/smoke-wo717-screen-consumer-policy-enforced.test.js
- `QUALITY` tools/smoke/smoke-wo717-screen-consumer-policy-enforced.test.js:48 — pins the exact 20/16-space indentation of the inserted `<gpu-texture>` line. A formatting-only change in src/config/screen-consumer-policy.js fails the test. Match with `\s*`.
## tools/smoke/smoke-wo718-new-project-operator-cable.test.js
- `OK`
## tools/smoke/smoke-wo719-sandbox-guards.test.js
- `OK`
## tools/smoke/smoke-wo720-device-view-announces-channel-map.test.js
- `OK`
## tools/smoke/smoke-wo720-operator-gui-debounce-settles.test.js
- `OK`
## tools/smoke/smoke-wo720-tests-never-touch-host-confine.test.js
- `OK`
## tools/smoke/smoke-wo721-install-to-disk.test.js
- `RISK` tools/smoke/smoke-wo721-install-to-disk.test.js:41-51 — `runFix()` executes tools/eggs/live-usb/fix-calamares-shellprocess.sh with only its root guard cut. The target comes from `HIGHASCG_CALAMARES_ROOT`. An empty value makes the script edit the real `/etc/calamares` (script lines 16-26 and 101-102). The test always sets the variable, but nothing asserts it is non-empty. Fix: refuse to run unless the root is under the test's tmp dir.
## tools/smoke/smoke-wo722-confine-resync.test.js
- `OK`
## tools/smoke/smoke-wo723-duties-from-config.test.js
- `QUALITY` tools/smoke/smoke-wo723-duties-from-config.test.js:225-231 and :242-246 — the test mutates the shared `duties.senders()` singleton (set to B at 225, set to 'ptz' at 242). The restores at 231 and 246 are not in `finally`, so an assertion failure leaves the singleton changed for later tests in the file.
## tools/smoke/smoke-wo724-build-restarts-caspar.test.js
- `OK`
## tools/smoke/smoke-wo724-media-send-paths.test.js
- `QUALITY` tools/smoke/smoke-wo724-media-send-paths.test.js:131 — the refused `touch /tmp/wo727` case writes a real /tmp file if the wrapper ever stops refusing. Point it at the test's `tmp` dir.
## tools/smoke/smoke-wo725-cluster-e2e.test.js
- `OK`
## tools/smoke/smoke-wo728-box-checks.test.js
- `OK`
## tools/smoke/smoke-wo730-sweep.test.js
- `OK`
## tools/smoke/smoke-wo731-audio-desk.test.js
- `OK`
## tools/smoke/smoke-wo731-desk-drivers.test.js
- `OK`
## tools/smoke/smoke-wo732-mutual-link.test.js
- `OK`
## tools/smoke/smoke-wo734-show-timers.test.js
- `QUALITY` tools/smoke/smoke-wo734-show-timers.test.js:55 — the comment "the live box today: two looped backgrounds on PGM" describes live state, not the behaviour under test. It goes stale as soon as the live layers change. Reword it as a fixture description.
## tools/smoke/smoke-wo736-ci-release.test.js
- `OK`
## tools/smoke/smoke-wo737-update-keeps-box-config.test.js
- `QUALITY` tools/smoke/smoke-wo737-update-keeps-box-config.test.js:59-63 — "a server running from a git checkout refuses a release update" returns early whenever `<REPO>/.git` exists. That is true on the dev box and in every CI checkout, so the `startApplyJob` refusal assertion never runs where it matters. Inject the repo root or use a temp tree.
## tools/smoke/smoke-wo739-link-invites.test.js
- `OK`
## tools/smoke/smoke-wo744-shm-sources.test.js
- `OK`
## tools/smoke/smoke-wo746-shared-show-e2e.test.js
- `OK`
