# tools/smoke — sweep 29.10.2026 (batch 134)

Files: 48 · lines: 6817 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 1 RISK, 8 QUALITY

## tools/smoke/smoke-wo746-shared-show-gates.test.js
- `OK`
## tools/smoke/smoke-wo746-show-merge.test.js
- `OK`
## tools/smoke/smoke-wo747-boot-seeded-recycle-sig.test.js
- `OK`
## tools/smoke/smoke-wo749-release-ships-sweep.test.js
- `OK`
## tools/smoke/smoke-wo752-sandbox-start-failure-no-leak.test.js
- `OK`
## tools/smoke/smoke-wo753-client-test-modes-isolated.test.js
- `OK`
## tools/smoke/smoke-wo753-project-matrix.test.js
- `OK`
## tools/smoke/smoke-wo766-playlist-fade-preview.test.js
- `OK`
## tools/smoke/smoke-wo767-glb-mm-units.test.js
- `OK`
## tools/smoke/smoke-wo768-playlist-empty-item.test.js
- `OK`
## tools/smoke/smoke-wo769-mv-prv-cell-look.test.js
- `OK`
## tools/smoke/smoke-wo770-vr-session.test.js
- `OK`
## tools/smoke/smoke-wo772-media-sent-resync.test.js
- `OK`
## tools/smoke/smoke-wo779-hdmi-sinks.test.js
- `OK`
## tools/smoke/smoke-wo779-iec958-selected-output.test.js
- `OK`
## tools/smoke/smoke-wo781-look-preset-destinations.test.js
- `OK`
## tools/smoke/smoke-wo782-preset-recall-one-play-batch.test.js
- `OK`
## tools/smoke/smoke-wo784-virtual-channels-not-on-wire.test.js
- `OK`
## tools/smoke/smoke-wo785-gdtf-share-recognition.test.js
- `OK`
## tools/smoke/smoke-wo787-timeline-preview-and-scrub.test.js
- `OK`
## tools/smoke/smoke-wo789-timeline-live-preview.test.js
- `OK`
## tools/smoke/smoke-wo790-timeline-scrub-pacing.test.js
- `OK`
## tools/smoke/smoke-wo792-vr-desk-panel.test.js
- `QUALITY` tools/smoke/smoke-wo792-vr-desk-panel.test.js:163 — `indexOf('showHide') > lastIndexOf('inputState') - 2` passes when showHide comes one slot before the last worn-check inputState, so "summoned after it was worn" is not really pinned. Fix: `>` against `lastIndexOf('inputState')`.
## tools/smoke/smoke-wo796-magicq-show.test.js
- `RISK` tools/smoke/smoke-wo796-magicq-show.test.js:111-116 — binds 0.0.0.0:6454 (reuseAddr) and sends ArtDMX universe 4 to 127.0.0.2:6454; ConsoleFrames.start() (lines 109-110) binds 127.0.0.2:6454 too. On the box :6454 is the live Art-Net input, so run on the box this shares the live port and injects DMX into the lighting input. Fix: use port 6455 (as the WO-807 loopback smoke does), or an injected port.
## tools/smoke/smoke-wo797-fixtures-watch.test.js
- `OK`
## tools/smoke/smoke-wo798-times-overlay-redraw.test.js
- `OK`
## tools/smoke/smoke-wo800-per-layer-audio.test.js
- `OK`
## tools/smoke/smoke-wo800-web-layer-levels.test.js
- `OK`
## tools/smoke/smoke-wo801-monitor-pair.test.js
- `OK`
## tools/smoke/smoke-wo802-node-only-links.test.js
- `OK`
## tools/smoke/smoke-wo803-pgm-layer-readback.test.js
- `OK`
## tools/smoke/smoke-wo804-rig-calibrate.test.js
- `OK`
## tools/smoke/smoke-wo805-amcp-ready-wake.test.js
- `QUALITY` tools/smoke/smoke-wo805-amcp-ready-wake.test.js:44,52,66,83 — wall-clock bounds (`took < 300 + 150 + 100`, `< 100`, `< 900`, `< 120`) are tight enough to flake on a loaded box. Fix: widen the bounds or assert on the poll count, not elapsed time.
## tools/smoke/smoke-wo805-apply-nvidia-deferred.test.js
- `OK`
## tools/smoke/smoke-wo805-custom-mode-once.test.js
- `OK`
## tools/smoke/smoke-wo805-fast-kill-spares-relaunch.test.js
- `OK`
## tools/smoke/smoke-wo805-inventory-once.test.js
- `QUALITY` tools/smoke/smoke-wo805-inventory-once.test.js:153-178 — `golden()` rebuilds the whole inventory payload shape in the test instead of importing it. Intentional as a byte-for-byte golden, but any payload change must now be made in two places. Fix: keep it as a golden, but pin the top-level keys from the module's own output once.
## tools/smoke/smoke-wo805-nvidia-sync-display-id.test.js
- `OK`
## tools/smoke/smoke-wo805-supervisor-exit-wait.test.js
- `OK`
## tools/smoke/smoke-wo807-pixel-map-loopback.test.js
- `QUALITY` tools/smoke/smoke-wo807-pixel-map-loopback.test.js:88 — `fs.mkdtempSync` runs at describe time and nothing removes it (no `after` hook), so every run leaves a `wo807-loop-*` directory in tmpdir.
## tools/smoke/smoke-wo807-pixel-map-propose.test.js
- `QUALITY` tools/smoke/smoke-wo807-pixel-map-propose.test.js:341 — `svc.indexOf('onProjectChanged(apply)') < svc.indexOf('createPixelMapProposalService(...)')` passes vacuously when the first string is absent (-1 < n). Fix: assert both indexes are >= 0 first.
## tools/smoke/smoke-wo807-pixel-map.test.js
- `QUALITY` tools/smoke/smoke-wo807-pixel-map.test.js:137 — `fs.mkdtempSync` at describe time with no cleanup hook, leaking `wo807-frame-*` per run.
## tools/smoke/smoke-wo811-auth-clients.test.js
- `OK`
## tools/smoke/smoke-wo811-auth-server-paths.test.js
- `OK`
## tools/smoke/smoke-wo811-os-password.test.js
- `QUALITY` tools/smoke/smoke-wo811-os-password.test.js:134 — `args.includes('highascg-passwd') || args.includes('--class=highascg-passwd') || args[0] === '-e'` accepts almost any terminal argv, so the terminal-class pin is loose. Fix: pin the one terminal the test host resolves.
## tools/smoke/smoke-wo811-template-credentials.test.js
- `QUALITY` tools/smoke/smoke-wo811-template-credentials.test.js:292-294 — the shader player's URL line is cut out of player.js with a tab-exact regex; any reindent of player.js silently changes what is tested. Fix: export the URL builder, or mark the extraction as a deliberate source pin.
## tools/smoke/smoke-wo813-look-custom-clip-start.test.js
- `OK`
## tools/smoke/smoke-wo813-trim-out-osc-window.test.js
- `OK`
