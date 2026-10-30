# tools/smoke (part 2) — sweep 29.10.2026 (batch 123)

Files: 64 · lines: 7000 · findings: 0 BUG-HIGH, 0 BUG, 29 DEAD, 4 RISK, 18 QUALITY

Method: DEAD = basename not in tools/ci/offline-test-files*.js (curated CI gate, `test:ci`); `.test.js` files then run only under manual `test:ci:full` (collect-offline-tests.js); `.js` files without a package.json script never run. Grep proof for each DEAD line: `rg -n "<basename>" tools/ci package.json .github` → no match; repo-wide grep shows no requirer other than as noted. Every readFileSync pin and every required module/export in the batch was checked against current source.

## tools/smoke/smoke-config-generator-routing.js
- `OK`

## tools/smoke/smoke-config-lifecycle-wo161.test.js
- `DEAD` tools/smoke/smoke-config-lifecycle-wo161.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-config-lifecycle-wo161" tools/ci package.json .github` → no match.
- `QUALITY` tools/smoke/smoke-config-lifecycle-wo161.test.js:60 — the EACCES case makes the dir read-only with chmod 0o555 and expects the write to reject. Running as root, the write succeeds and assert.rejects fails. Fix: skip when `process.getuid?.() === 0`.

## tools/smoke/smoke-config-manager-path.test.js
- `QUALITY` tools/smoke/smoke-config-manager-path.test.js:20 — the accept case only asserts `typeof cm.configPath === 'string'`, so it does not check the stored path. Line 15 also hard-codes `/tmp`.

## tools/smoke/smoke-consumer-index-collisions.test.js
- `OK`

## tools/smoke/smoke-countdown-routes.test.js
- `QUALITY` tools/smoke/smoke-countdown-routes.test.js:190 — the `getAll` and `loadFullProject` stubs (set at :165-166, :212-213, :248-249) are restored only on the straight-line path (also :233-235 and :271-273). If `handleGet` throws, the stubs leak into later tests in the same process. Fix: try/finally.

## tools/smoke/smoke-cut-ignores-picker-duration.test.js
- `OK`

## tools/smoke/smoke-deck-idle-thumbnail.test.js
- `DEAD` tools/smoke/smoke-deck-idle-thumbnail.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-deck-idle-thumbnail" tools/ci package.json .github` → no match.

## tools/smoke/smoke-decklink-enum.js
- `DEAD` tools/smoke/smoke-decklink-enum.js:1 — never runs: not `.test.js` (skipped by collect-offline-tests.js), no curated entry, no package.json script. grep: `rg -n "smoke-decklink-enum" tools/ci package.json .github tools/smoke` → only the file itself.
- `QUALITY` tools/smoke/smoke-decklink-enum.js:36 and :44 — the only assertions sit inside `if (r.connectors.length > 0)` and `if (h.firmwareMismatch)`. On a box with no DeckLink, or with no firmware mismatch, the test passes without checking anything.

## tools/smoke/smoke-decklink-exfat-install.test.js
- `DEAD` tools/smoke/smoke-decklink-exfat-install.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-decklink-exfat-install" tools/ci package.json .github` → no match.
- `QUALITY` tools/smoke/smoke-decklink-exfat-install.test.js:69-70 — `assert.ok(lines.length >= 1)` is always true after line 68 reads `lines[0]`, and `!lines[1] || lines[1] === ''` accepts any empty value, so a wrong GUI-deb pick would pass.

## tools/smoke/smoke-decklink-input-look-thumb.test.js
- `OK`

## tools/smoke/smoke-decklink-input-retry.test.js
- `OK`

## tools/smoke/smoke-decklink-input-slots.test.js
- `DEAD` tools/smoke/smoke-decklink-input-slots.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-decklink-input-slots" tools/ci package.json .github` → no match.

## tools/smoke/smoke-decklink-io-direction.js
- `DEAD` tools/smoke/smoke-decklink-io-direction.js:1 — never runs: not `.test.js`, no curated entry, no package.json script. grep: `rg -n "smoke-decklink-io-direction" tools/ci package.json .github` → no match.

## tools/smoke/smoke-decklink-output-resolve.js
- `DEAD` tools/smoke/smoke-decklink-output-resolve.js:1 — never runs: not `.test.js`, no curated entry, no package.json script. grep: `rg -n "smoke-decklink-output-resolve" tools/ci package.json .github` → no match.

## tools/smoke/smoke-device-graph-boot-sync.test.js
- `DEAD` tools/smoke/smoke-device-graph-boot-sync.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-device-graph-boot-sync" tools/ci package.json .github` → no match.

## tools/smoke/smoke-device-graph-host-destinations.test.js
- `DEAD` tools/smoke/smoke-device-graph-host-destinations.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-device-graph-host-destinations" tools/ci package.json .github` → no match.

## tools/smoke/smoke-device-graph-multiview-suggest.test.js
- `OK`

## tools/smoke/smoke-device-graph-output-mapping.js
- `DEAD` tools/smoke/smoke-device-graph-output-mapping.js:1 — never runs: not `.test.js`, no curated entry, no package.json script. grep: `rg -n "smoke-device-graph-output-mapping" tools/ci package.json .github` → no match.
- `RISK` tools/smoke/smoke-device-graph-output-mapping.js:10-11 — the fixtures are the box's live `config/device_graph.json` and `config/screen_destinations.json`. The result changes whenever the owner edits those files, and config/ is live runtime state. Use an inline fixture, as smoke-host-live-caspar-config.test.js:15 does.

## tools/smoke/smoke-device-graph.js
- `QUALITY` tools/smoke/smoke-device-graph.js:1 — outside the CI gate: only the manual npm script `test:device-graph` (package.json:52) runs it.

## tools/smoke/smoke-device-snapshot.js
- `QUALITY` tools/smoke/smoke-device-snapshot.js:1 — outside the CI gate: only the manual npm script `test:device-snapshot` (package.json:53) runs it.

## tools/smoke/smoke-device-view-refresh.test.js
- `DEAD` tools/smoke/smoke-device-view-refresh.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-device-view-refresh" tools/ci package.json .github` → no match.

## tools/smoke/smoke-device-view-reload-forces-refresh.test.js
- `OK`

## tools/smoke/smoke-dom-escape.test.js
- `QUALITY` tools/smoke/smoke-dom-escape.test.js:14-20 — the "playlist markup" test builds its own template string and checks only the helper output. It never calls the production playlist renderer, so it would pass if that renderer dropped escaping.

## tools/smoke/smoke-duration-hms-input.test.js
- `DEAD` tools/smoke/smoke-duration-hms-input.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-duration-hms-input" tools/ci package.json .github` → no match.

## tools/smoke/smoke-edid-parse.test.js
- `OK`

## tools/smoke/smoke-edid-preferred-mode.test.js
- `OK`

## tools/smoke/smoke-editor-defaults.test.js
- `DEAD` tools/smoke/smoke-editor-defaults.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-editor-defaults" tools/ci package.json .github` → no match. It has no `test()` wrapper: a failing assert throws at module load and reports as one file failure with no case name.

## tools/smoke/smoke-eggs-exclude-lists.test.js
- `OK`

## tools/smoke/smoke-eggs-produce-build-stamp.test.js
- `OK`

## tools/smoke/smoke-exfat-boot-wait-and-decklink-gate.test.js
- `OK`

## tools/smoke/smoke-exfat-sync.js
- `QUALITY` tools/smoke/smoke-exfat-sync.js:1 — outside the CI gate: only the manual npm script `smoke:exfat-sync` (package.json:46) runs it.
- `RISK` tools/smoke/smoke-exfat-sync.js:9 and :56-64 — reads the live `config/exfat-sync.json` and asserts specific pair ids and directions, so owner edits to the sync map fail it. :82-86 reads the box's map through loadExfatSyncMapFromDisk.

## tools/smoke/smoke-extra-live-source-decklink.test.js
- `DEAD` tools/smoke/smoke-extra-live-source-decklink.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-extra-live-source-decklink" tools/ci package.json .github` → no match.

## tools/smoke/smoke-factory-reset-device-view.test.js
- `DEAD` tools/smoke/smoke-factory-reset-device-view.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-factory-reset-device-view" tools/ci package.json .github` → no match.

## tools/smoke/smoke-factory-reset-purge.test.js
- `DEAD` tools/smoke/smoke-factory-reset-purge.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-factory-reset-purge" tools/ci package.json .github` → no match. Safety checked: HIGHASCG_ROOT is forced to a fixture at :61 and honoured by tools/eggs/live-usb/write-iso-default-config.js:21.

## tools/smoke/smoke-fresh-box-clean-device-view.test.js
- `QUALITY` tools/smoke/smoke-fresh-box-clean-device-view.test.js:68-69 — the comment says the committed slices are "Judged at HEAD", but tools/smoke/lib/committed-config-slice.js:20 reads the git INDEX (`git show :path`), as that helper's own header says. Fix the comment.

## tools/smoke/smoke-ftb-routes.test.js
- `DEAD` tools/smoke/smoke-ftb-routes.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-ftb-routes" tools/ci package.json .github` → no match.

## tools/smoke/smoke-full-config-apply.js
- `DEAD` tools/smoke/smoke-full-config-apply.js:1 — never runs: not `.test.js`, explicitly excluded by EXCLUDE_NAME in tools/ci/collect-offline-tests.js, no package.json script.
- `RISK` tools/smoke/smoke-full-config-apply.js:99-101 and :106 — the Module._load mock matches by path suffix, and any unmatched require falls through to the real module (`origLoad.apply`). :106 then runs the real applyFullServerConfig, which calls the real writeCasparGlSyncEnvFile (src/utils/full-config-apply.js:240-244 → src/utils/caspar-gl-sync-env.js:103-112). On the box that rewrites `$HOME/.config/highascg/caspar-env`, which run.sh sources at every Caspar launch, using the fake `{ screen_count: 2 }` config.

## tools/smoke/smoke-gpu-edid-pipeline.test.js
- `OK`

## tools/smoke/smoke-gpu-modetest.test.js
- `QUALITY` tools/smoke/smoke-gpu-modetest.test.js:1 — outside the CI gate: only the manual npm script `test:gpu-modetest` (package.json:63) runs it.

## tools/smoke/smoke-gpu-physical-map.test.js
- `DEAD` tools/smoke/smoke-gpu-physical-map.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-gpu-physical-map" tools/ci package.json .github` → no match.

## tools/smoke/smoke-gpu-topology-boot.test.js
- `OK`

## tools/smoke/smoke-gpu-topology-ssot.test.js
- `QUALITY` tools/smoke/smoke-gpu-topology-ssot.test.js:104-108 — the persist assertions sit inside `if (body.topology?.length)`. With an empty topology they are skipped, so `persisted` is never checked in that case.

## tools/smoke/smoke-gpu-topology.test.js
- `QUALITY` tools/smoke/smoke-gpu-topology.test.js:1 — outside the CI gate: only the manual npm script `test:gpu-topology` (package.json:64) runs it.

## tools/smoke/smoke-gpu-video-mode-resolve.test.js
- `DEAD` tools/smoke/smoke-gpu-video-mode-resolve.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-gpu-video-mode-resolve" tools/ci package.json .github` → no match.

## tools/smoke/smoke-hap-encode-args.test.js
- `QUALITY` tools/smoke/smoke-hap-encode-args.test.js:90 — `assert.ok(!none.includes('-map') || !none.includes('0:a'))` holds whenever `-map` is absent, so it does not check that audio is dropped.

## tools/smoke/smoke-hap-encode-client.test.js
- `OK`

## tools/smoke/smoke-hap-encode-queue.test.js
- `QUALITY` tools/smoke/smoke-hap-encode-queue.test.js:274 — `'MEDIA/../a.mov'.replace('MEDIA/../', '')` is a no-op that yields `'a.mov'`. The path-traversal case the expression suggests is never tested.
- `QUALITY` tools/smoke/smoke-hap-encode-queue.test.js:447 — `assert.strictEqual(v.nb_frames, vin.nb_frames || v.nb_frames)` is always true when the source reports no nb_frames.

## tools/smoke/smoke-hap-encode-routes.test.js
- `OK`

## tools/smoke/smoke-hardware-identity.test.js
- `OK`

## tools/smoke/smoke-hardware-info-xrandr-timeout.test.js
- `QUALITY` tools/smoke/smoke-hardware-info-xrandr-timeout.test.js:107-110 — the cache-hit check is a wall-clock assertion (`elapsed < 30` ms) and can flake on a loaded box.

## tools/smoke/smoke-host-live-caspar-config.test.js
- `OK`

## tools/smoke/smoke-host-live-decklink.test.js
- `DEAD` tools/smoke/smoke-host-live-decklink.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-host-live-decklink" tools/ci package.json .github` → no match.

## tools/smoke/smoke-host-live-ndi.test.js
- `DEAD` tools/smoke/smoke-host-live-ndi.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-host-live-ndi" tools/ci package.json .github` → no match.

## tools/smoke/smoke-host-live-sources-migrate.test.js
- `DEAD` tools/smoke/smoke-host-live-sources-migrate.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-host-live-sources-migrate" tools/ci package.json .github` → no match.

## tools/smoke/smoke-host-live-sources.test.js
- `DEAD` tools/smoke/smoke-host-live-sources.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-host-live-sources" tools/ci package.json .github` → no match.

## tools/smoke/smoke-host-live-webpage.test.js
- `DEAD` tools/smoke/smoke-host-live-webpage.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-host-live-webpage" tools/ci package.json .github` → no match.

## tools/smoke/smoke-host-operator-fullscreen.test.js
- `DEAD` tools/smoke/smoke-host-operator-fullscreen.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-host-operator-fullscreen" tools/ci package.json .github` → no match.
- `RISK` tools/smoke/smoke-host-operator-fullscreen.test.js:16-19 — `loadProjectConfig` calls `ConfigManager.load()` on the LIVE config dir (`HIGHASCG_CONFIG_PATH` or `REPO_ROOT/config`). A missing or pre-v1 config makes load() persist a bootstrap or migration save (src/config/config-manager.js:146-155). :48-57 and :87-91 also depend on the box's own zones (t.skip when absent). smoke-host-live-caspar-config.test.js:15 was moved to a fixture for this reason.

## tools/smoke/smoke-host-stats-gpu-negative-cache.test.js
- `OK`

## tools/smoke/smoke-hostname-sudoers.test.js
- `OK`

## tools/smoke/smoke-http-body-limit.test.js
- `OK`

## tools/smoke/smoke-interactive-operator-display.test.js
- `DEAD` tools/smoke/smoke-interactive-operator-display.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-interactive-operator-display" tools/ci package.json .github` → no match.

## tools/smoke/smoke-layer-crop.test.js
- `DEAD` tools/smoke/smoke-layer-crop.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-layer-crop" tools/ci package.json .github` → no match. Its only other mention is a comment at tools/smoke/smoke-wo388-crop-aware-align.test.js:17.

## tools/smoke/smoke-layer-exchange-preserve-transform.test.js
- `OK`

## tools/smoke/smoke-licenses-manifest.test.js
- `DEAD` tools/smoke/smoke-licenses-manifest.test.js:1 — not in the curated lists; only manual `test:ci:full` runs it. grep: `rg -n "smoke-licenses-manifest" tools/ci package.json .github` → no match.
- `QUALITY` tools/smoke/smoke-licenses-manifest.test.js:36-39 — `if (!bmd) return` passes silently when the Blackmagic component is missing from the manifest.
