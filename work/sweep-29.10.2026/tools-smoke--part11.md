# tools/smoke — sweep 29.10.2026 (batch 132)

Files: 50 · lines: 6988 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 3 RISK, 14 QUALITY

Checks run: every file is in `tools/ci/offline-test-files.js` by exact path (none DEAD). 90 `readFileSync` pins and
file paths were matched against current production text (all matched, none stale). Every destructured `require`
name exists in its module. Python self-tests (test_seg/pose/body/face.py) are venv-only and skipped in CI; they are
not counted. No test in the batch reaches :4200 or :5250, and no test writes to projects/ or config/: GDTF, MVR and
persistence are redirected under `NODE_TEST_CONTEXT` (`projects-root.js`, `utils/persistence.js`).

## tools/smoke/smoke-wo616-follow-artnet.test.js
- `OK`

## tools/smoke/smoke-wo616-hungarian.test.js
- `OK`

## tools/smoke/smoke-wo616-tracking-camera-model.test.js
- `OK`

## tools/smoke/smoke-wo616-tracking-detect.test.js
- `QUALITY` tools/smoke/smoke-wo616-tracking-detect.test.js:38-72 — `fakeSpawn` and `makeService` are copied into smoke-wo665-person-cutouts.test.js:64-74 and smoke-wo667-posed-dummies.test.js:71-79. Fix: move one shared fake-child harness into `tools/smoke/lib/`.
- `QUALITY` tools/smoke/smoke-wo616-tracking-detect.test.js:215 — real `setTimeout(1100)` waits out the 1 s restart backoff. Slow, and it depends on wall-clock timing. Fix: inject `now`/timers, or accept the cost and note it.

## tools/smoke/smoke-wo616-tracking-fusion.test.js
- `OK`

## tools/smoke/smoke-wo616-tracking-marker-hub.test.js
- `OK`

## tools/smoke/smoke-wo616-tracking-pin.test.js
- `QUALITY` tools/smoke/smoke-wo616-tracking-pin.test.js:105,115 — `new DetectPin()._state(1)` calls a private method. The test is coupled to internals and will break on a rename without any behaviour change. Fix: drive the same smoothing through the public `step()`, or export `advanceSmoothing` and test that directly.

## tools/smoke/smoke-wo616-tracking-zones.test.js
- `OK`

## tools/smoke/smoke-wo616-verify-walk.test.js
- `OK`

## tools/smoke/smoke-wo617-tests-never-touch-live-projects.test.js
- `OK`

## tools/smoke/smoke-wo618-caspar-tween.test.js
- `OK`

## tools/smoke/smoke-wo619-settings-editor-defaults-persist.test.js
- `OK`

## tools/smoke/smoke-wo623-host-cpu-usage.test.js
- `QUALITY` tools/smoke/smoke-wo623-host-cpu-usage.test.js:37 — `assert.ok(pct === null || (pct >= 0 && pct <= 100))` accepts `null`, so a sampler that always returns null passes. Failing case: `sampleMachineCpuPct()` → null on every call → test green. Fix: on linux, assert a number once two samples exist (the test calls it once, so the first sample is null by design: assert that explicitly instead).

## tools/smoke/smoke-wo623-host-live-layer.test.js
- `OK`

## tools/smoke/smoke-wo623-new-look.test.js
- `OK`

## tools/smoke/smoke-wo624-fixture-calibrate.test.js
- `OK`

## tools/smoke/smoke-wo624-operator-gui-source-cells.test.js
- `OK`

## tools/smoke/smoke-wo624-tracking-pick.test.js
- `OK`

## tools/smoke/smoke-wo625-numbered-media-names.test.js
- `OK`

## tools/smoke/smoke-wo627-unprobed-clip-resolution.test.js
- `QUALITY` tools/smoke/smoke-wo627-unprobed-clip-resolution.test.js:96-98 — the "one call probes all 150" assertion depends on the wall-clock budget `PROBE_BUDGET_MS = 3000` (src/api/media-catalog.js:18). On a slow box the ffprobe spawns can exceed the budget, so the assertion fails for a timing reason, not a logic one. Fix: pass `probeBudgetMs` explicitly (e.g. 60000) in the `fresh` call, as the other calls already do.

## tools/smoke/smoke-wo628-operator-dock.test.js
- `OK`

## tools/smoke/smoke-wo629-led-test-control.test.js
- `OK`

## tools/smoke/smoke-wo630-calibrate-click.test.js
- `OK`

## tools/smoke/smoke-wo631-psn-output.test.js
- `OK`

## tools/smoke/smoke-wo632-artnet-read-through.test.js
- `OK`

## tools/smoke/smoke-wo633-gdtf-replace.test.js
- `QUALITY` tools/smoke/smoke-wo633-gdtf-replace.test.js:23-28 — the `ch`/`mode`/stub XML builders are copied from smoke-wo637-gdtf-share.test.js:24-33. Fix: move them into `tools/smoke/lib/gdtf-fixtures.js`.

## tools/smoke/smoke-wo637-gdtf-share.test.js
- `QUALITY` tools/smoke/smoke-wo637-gdtf-share.test.js:24-33 — duplicate of the XML builders in smoke-wo633-gdtf-replace.test.js:23-28 (same fix).

## tools/smoke/smoke-wo638-boot-screen-assignment.test.js
- `OK`

## tools/smoke/smoke-wo645-startup-mode.test.js
- `OK`

## tools/smoke/smoke-wo661-template-categories.test.js
- `OK`

## tools/smoke/smoke-wo662-beat-detect.test.js
- `OK`

## tools/smoke/smoke-wo663-studio-lower-thirds.test.js
- `OK`

## tools/smoke/smoke-wo665-person-cutouts.test.js
- `QUALITY` tools/smoke/smoke-wo665-person-cutouts.test.js:64-74 — inline detect-service harness (`spawn`, `proc`, `stdin`/`stdout` fakes) duplicates smoke-wo616-tracking-detect.test.js:38-72 and smoke-wo667-posed-dummies.test.js:71-79. Fix: shared fake from `tools/smoke/lib/`.

## tools/smoke/smoke-wo667-posed-dummies.test.js
- `QUALITY` tools/smoke/smoke-wo667-posed-dummies.test.js:71-79 — the fake `spawn` is a third copy of the detect-service harness (see smoke-wo616-tracking-detect.test.js:38-72).

## tools/smoke/smoke-wo670-cluster-catchup.test.js
- `OK`

## tools/smoke/smoke-wo670-cluster-fanout.test.js
- `OK`

## tools/smoke/smoke-wo670-cluster-master.test.js
- `OK`

## tools/smoke/smoke-wo670-cluster.test.js
- `RISK` tools/smoke/smoke-wo670-cluster.test.js:182-188 — `createCluster` is given `selfKey` but not `localAddress` or `request`. `add()` then calls the real `localAddressTo` (src/cluster/cluster-peers.js:93-101, 349), which does `net.connect` to `10.0.0.6:4200` and `10.0.0.7:4200` on the owner's LAN. If a route exists, `linkBack` also makes a real `requestJson` POST to `/api/cluster/peers` on that host (cluster-peers.js:152). So the test can write a peer entry into another live HighAsCG server. Fix: inject `localAddress: async () => ''` (as line 66 does) and `request` in this test.

## tools/smoke/smoke-wo670-video-feed.test.js
- `OK`

## tools/smoke/smoke-wo675-bodies.test.js
- `QUALITY` tools/smoke/smoke-wo675-bodies.test.js:30-41 — `vec`/`unitOf` helpers duplicate smoke-wo675-presenters.test.js:30-35 (and the roster helper in both files). Fix: shared feature-vector helper.

## tools/smoke/smoke-wo675-presenters.test.js
- `QUALITY` tools/smoke/smoke-wo675-presenters.test.js:30-35 — `vec` duplicates smoke-wo675-bodies.test.js:30. Same fix.

## tools/smoke/smoke-wo683-single-portaudio.test.js
- `OK`

## tools/smoke/smoke-wo690-previs-tracking-default-on.test.js
- `OK`

## tools/smoke/smoke-wo692-network-apply-helper.test.js
- `RISK` tools/smoke/smoke-wo692-network-apply-helper.test.js:54 — the child PATH is `<fake bin>:/usr/bin:/bin`, so any command without a fake runs for real. Latent case: tools/runtime/highascg-network-apply.sh:110 and :138 call `systemctl reload systemd-networkd`, and `networkctl` is faked to exit 1, so the real `systemctl` runs if the networkd branch is ever reached. It is not reached in the current cases (the fake `nmcli` is present, so `apply_networkd_*` is skipped). Fix: set PATH to the fake bin only (plus `bash` location), or fake `systemctl` too.

## tools/smoke/smoke-wo692-network-interfaces.test.js
- `OK`

## tools/smoke/smoke-wo693-dmx-monitor.test.js
- `RISK` tools/smoke/smoke-wo693-dmx-monitor.test.js:196 — the real-socket test uses the default `dgram`, so `DmxMonitor` binds `0.0.0.0:46454` (src/artnet/dmx-monitor.js:107) and `:45568` (dmx-monitor.js:137) on every interface. Test ports only (not 6454/5568), but the sockets are reachable from the LAN while the test runs. Fix: pass a loopback bind address through the monitor options.
- `QUALITY` tools/smoke/smoke-wo693-dmx-monitor.test.js:198,204 — fixed `setTimeout` waits of 100 ms and 150 ms before asserting on UDP delivery. Flaky under load. Fix: wait for the monitor's own frame/source event with a timeout.

## tools/smoke/smoke-wo695-fixture-repatch.test.js
- `QUALITY` tools/smoke/smoke-wo695-fixture-repatch.test.js:68 — reads the private `e._uni` map. Fix: expose the universe state through `status()` and assert on that.

## tools/smoke/smoke-wo696-ssh-host-keys-dropin.test.js
- `OK`

## tools/smoke/smoke-wo697-boot-stick.test.js
- `QUALITY` tools/smoke/smoke-wo697-boot-stick.test.js:99,150 — the temp dir is created at describe time and removed only as the last statement of the last test. A failing assertion earlier leaks `/tmp/wo697-*`. Fix: create it in `before()`, remove it in `after()`.

## tools/smoke/smoke-wo698-dmx-output-nic.test.js
- `OK`
