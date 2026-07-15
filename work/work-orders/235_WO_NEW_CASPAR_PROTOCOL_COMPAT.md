# WO-235 — New Caspar (2.6-dev r253c16c) protocol compatibility: OSC timers erratic, playback matrix empty, interactive-display 400

**Status:** Planned | **Date:** 2026-07-15 | **Priority:** CRITICAL (new binary is running on the dev box now)
**Source:** owner post-swap: "first there is something wrong with osc/variables parsing as the timers in main ui and on mv are freaking out." + "HTTP 400: No interactive operator display configured (multiview or screen consumer)"

## Evidence so far
- New tree emits `state_["file/time"] = {time()/format_desc_.fps, file_duration()/format_desc_.fps}` (src-tree src/modules/ffmpeg/producer/av_producer.cpp:990) — dividing by CHANNEL fps; old binary (Jan-2026 lineage) may have emitted seconds directly or per-file fps → scale/jitter mismatch in our [src/osc/osc-state.js:384-392](../../src/osc/osc-state.js) which consumes vals[0]/vals[1] as seconds.
- Live: `playback.matrix` in /api/state is EMPTY (0 cells) while media plays — OSC either not arriving on the expected port/format, address scheme changed (`/channel/N/...` vs `/ch/N/...` — our normalizer handles /ch/), or arg TYPES changed (int vs float, our Number() should cope) — needs a raw OSC capture.
- `HTTP 400 No interactive operator display` from [src/api/host-operator-fullscreen.js:133](../../src/api/host-operator-fullscreen.js) — read what it detects (INFO XML? config channels?) — the new server's INFO XML schema likely differs (2.6 restructured INFO in upstream; our INFO consumers: cef-interactive-cdp.js line ~49 parses <foreground> blocks, scene reconcile, etc.).

## Root causes (confirmed via new server's src-tree + live read-only probes)

1. **Timers erratic + playback.matrix empty (T235.2/T235.3 — one root cause).** `core/producer/layer.cpp:132-141`
   (2.6-dev) never emits an explicit `.../type` OSC leaf. It only sets
   `state_["foreground"]["producer"]` / `state_["background"]["producer"]` to the producer's
   *name* (`"ffmpeg"`/`"empty"`/`"route"`/`"html"`/`"transition"`/…). Our `osc-state.js` only ever
   wrote `layer.type` from an explicit `.../type` leaf, so `layer.type` stayed `null` forever on
   the new binary. Every consumer that gates on `String(layer.type||'') === 'empty'`
   (`playback-tracker-osc.js` `buildMatrixFromOsc`/`getOccupiedLayerNumbersFromOsc`,
   `osc-variables.js` per-layer timer variables, `scene-play-seek.js`, `compose-preview-activity.js`)
   therefore treated **every** layer as empty: `/api/state` `playback.matrix` stayed `{}`, and
   `osc-variables.js` cleared the per-layer timer variables on every emit (blank/flickering
   timers in the main UI + multiview). The `file/time` *address* and *unit* did **not** change —
   both lineages send `[elapsed_sec, duration_sec]` in one message, computed by dividing the
   CHANNEL frame counter by the CHANNEL fps (`av_producer.cpp:990`) — the original evidence-bullet
   hypothesis (scale/unit drift) did not hold up under source review.
   - Live OSC capture wasn't possible without a restart (env-flag trace lands disabled — see
     T235.1); root cause was nailed via `src-tree` source read (`core/monitor/monitor.h` state-map
     path-join semantics, `protocol/osc/client.cpp` wire encoding) cross-checked against a live
     `/api/state` dump showing `oscLayers.*.type: null` for layers that clearly had `file.name`/
     `file.path` populated, and a rare extreme-magnitude float sample
     (`elapsed: 1.46e-32`, `duration: 1.96e+23`) for one layer — a defensive sanity clamp was added
     for that (see osc-state.js comments); it does not affect the primary root cause above.
2. **Operator-fullscreen 400 (T235.4).** `src/api/host-operator-fullscreen.js`'s
   `resolveOperatorRouteTarget` → `listInteractiveZones` (`src/utils/x-display-session-layout.js`)
   has **zero** dependency on Caspar's OSC or INFO wire protocol — confirmed by full call-graph
   read; it is pure highascg config + OS/xrandr layout. It is therefore **not** an INFO-schema
   drift bug. The actual defect: `multiviewScreenConsumerEnabled()` only trusted the legacy static
   `casparServer.multiview_enabled` / `multiview_screen_consumer` flags, which are only re-synced
   when the Caspar XML config is regenerated (`build-caspar-generator-layout-sync.js`,
   `device-graph-destination-wiring.js:179`) and go stale once a multiview output is added via
   screenDestinations (Device Graph) without a regenerate — even though the multiview channel and
   its screen consumer are genuinely running (`INFO <multiview channel>` on this rig shows a real
   `<consumer>screen</consumer>` entry; `/api/state` `configComparison.aligned: true`). Fixed by
   falling back to the screenDestinations-derived channel map (`routing-map.js` already treats
   that, not the legacy flags, as authoritative) when the legacy flags say no.
   - Separately, `live-scene-reconcile.js`'s `parseLayerFgClipsFromChannelXml` (a genuine INFO XML
     consumer) had a real new-schema regression: it read `<file><clip>` as the clip **name** (old
     lineage: `<clip>ClipName</clip>`, a single string tag), but the new tree repurposes `<clip>`
     as a numeric `[start_sec, duration_sec]` pair (`av_producer.cpp:989`) and moved the canonical
     clip id to a sibling `<name>` tag (`av_producer.cpp:764`). Confirmed live: parsing a captured
     `INFO 1` against the pre-fix code returned `"5.04"`/`"16"` (durations) as the "clip name" for
     occupied layers — this would have caused scene-reconcile to wrongly diff/clear persisted live
     looks on the new binary. Fixed to prefer `<name>`/`$.name`, falling back to `<clip>` only when
     it doesn't look like the new numeric pair.
   - `cef-interactive-cdp.js`'s `htmlNeedleFromInfoXml` (`<foreground><producer>html</producer>`
     + `<path>`) and `channel-info-xml.js`'s `listOccupiedStageLayersInRange` (`layer_N` key walk)
     were checked against a live `INFO 1`/`INFO 4` capture and require **no change** — both already
     tolerate the new schema.

## Tasks
- [x] T235.1 RAW OSC capture: could not capture live packets without a service restart (the env
      trace flag only takes effect at process start, and a restart was out of scope/forbidden for
      this WO). Added a permanent, default-off trace (`HIGHASCG_OSC_TRACE=1`, logs first 200
      packets' address + args) in `src/osc/osc-state.js` `handleOscMessage` for future incident
      capture. Root cause was instead nailed via full `src-tree` source read (cited above) +
      live `/api/state` / `INFO N` snapshots, which was sufficient to pin the exact schema diff.
- [x] T235.2 Fixed in `src/osc/osc-state.js`: `layer.type`/`backgroundType` now also derive from
      the `.../foreground/producer` / `.../background/producer` leaf (new lineage), in addition to
      the old explicit `.../type` leaf (still honored) — both binaries work with no config switch.
      Added a sanity clamp on `.../file/time` against rare extreme-magnitude float garbage.
- [x] T235.3 Root cause was the same `layer.type` gap (see above) — `playback-tracker-osc.js`
      needed no changes once `layer.type` populates correctly; verified live-shaped OSC fixtures
      now populate `playback.matrix` (smoke tests below).
- [x] T235.4 Fixed `multiviewScreenConsumerEnabled()` fallback (`x-display-session-layout.js`) and
      `live-scene-reconcile.js`'s clip-name parsing (see root-cause notes above). Verified
      `cef-interactive-cdp.js` + `channel-info-xml.js` need no change against live `INFO N` XML.
- [x] T235.5 Added `tools/smoke/smoke-wo235-osc-compat.test.js` (13 tests: old+new OSC format
      parity, matrix population regression, INFO fixture tests old+new schema for both INFO
      consumers, operator-fullscreen fallback + no-regression cases). Wired into
      `tools/ci/run-offline-tests.js` FILES. `node --check` + `eslint --quiet` clean on all
      touched files. **Curated offline gate** (`node tools/ci/run-offline-tests.js` — the one
      this task targets; never opens a socket to Caspar): 286 tests, 284 pass / 0 fail /
      2 skipped (pre-existing, CI-gated long-running WS-integration tests, unrelated to this
      change), including the 13 new tests above. No client/vite changes (server-only fix).
      **Do NOT run `tools/ci/run-offline-tests-full.js` on this box** — see T235.6 incident below;
      4 of the files its auto-glob used to pick up sent live AMCP traffic to whatever is on
      :5250 by default, which on this box is the real production Caspar.
- [x] T235.6 (added mid-WO, owner-reported "AMCP connections leaking, 7→14, REQ…VERSION bursts").
      **Root cause was NOT a connection-manager.js / new-binary protocol bug.** Read
      `src/caspar/connection-manager.js`, the vendored `casparcg-connection` library's
      `Connection._setupSocket()`/`_triggerReconnect()` (node_modules/casparcg-connection/dist/connection.js) —
      old-socket teardown (`removeAllListeners()` + `destroy()`) and reconnect-timer dedup
      (`if (!this._reconnectTimeout)`) are both correct; no leak found there. **What actually
      happened:** while gathering T235.5's full-gate counts I ran
      `node tools/ci/run-offline-tests-full.js` in the background. Its test collector
      (`tools/ci/collect-offline-tests.js`) auto-globs `tools/smoke/*.test.js` with no live-AMCP
      awareness, and 4 files — `smoke-amcp-batch-library.test.js`,
      `smoke-amcp-legacy-transport.test.js`, `smoke-amcp-migration-air-paths.test.js`,
      `smoke-amcp-send-after.test.js` — construct a real `ConnectionManager` against
      `HIGHASCG_CASPAR_HOST`/`PORT` defaulting to `127.0.0.1:5250` with **no self-hosted mock
      server and no `.live.` naming safeguard** (unlike `smoke-cef-*.live.test.js`,
      `highascg-live-amcp.test.js`, which ARE excluded). Node's test runner spawned them as
      separate processes near-simultaneously (`--test-isolation=process`), each doing its own
      `ConnectionManager.start()` → AMCP `VERSION` health probe against the box's real,
      already-running production Caspar (2935622) — that is the exact "REQ VERSION burst,
      7→14 connections" signature reported. **This caused real live damage**: Caspar's own log
      (`log/caspar_2026-07-15.log`, 12:20:46) shows the test suite issuing
      `BEGIN / CLEAR 1-10 / CLEAR 1-11 / CLEAR 1-12 / CLEAR 1-13 / CLEAR 1-14 / CLEAR 1-15 / COMMIT`
      against the live production channel 1, wiping the on-air clips that were on layers 10/11
      (`BRIDGE/355317`, `BRIDGE/252166` — present in the pre-incident `/api/state` capture used
      for T235.2/T235.3 evidence above, confirmed gone from `INFO 1` immediately after). The
      follow-up `PLAY 1-10 AMB` / `PLAY 1-11 AMB` both 404'd (no such clip), so nothing new loaded
      — the layers were left empty. **I stopped the run immediately** (`TaskStop` on the
      background task) once this was discovered; connections dropped back to the single
      legitimate highascg↔Caspar socket within seconds and no test processes were left running.
      I did **not** attempt to restore the cleared layers myself — that would itself be
      state-changing AMCP, forbidden for this task. **Fix applied:** added those 4 files to
      `tools/ci/collect-offline-tests.js`'s `EXCLUDE_NAME` so `run-offline-tests-full.js` can
      never auto-pick them up again; no `connection-manager.js`/protocol code changed for T235.6
      because no defect was found there. **Smoke:** not added — there is no code defect to
      regression-test; the fix is a test-collector exclusion list entry, and a fixture-based
      "old vs new VERSION reply" test would not have caught or represented this incident (the
      library's VERSION parsing was never implicated).
      **OWNER ACTION NEEDED — re-cue channel 1 layers 10-15** (whatever was live on-air there
      before ~12:20:46 today); they are currently empty. I could not do this myself (read-only
      constraint).
- [ ] A235.1 owner: **NOT verified — needs owner/live check.** Could not exercise this live within
      the read-only probe constraints (GET /api/state + read-only /api/raw AMCP only; no
      state-changing AMCP, no restart, no config edits). Everything above was validated with
      synthetic fixtures reverse-engineered/derived from the new server's actual source tree and
      from real `/api/state` + `INFO N` snapshots captured on this box, not by watching the fix
      land live. Please confirm after this change is picked up by the running process:
      - Per-layer timers in the main UI and multiview read correctly and stop flickering/blanking.
      - `/api/state` `playback.matrix` populates while media plays.
      - `POST` operator-fullscreen / Arm Input (Mario) no longer 400s.
      **Note:** the `osc-state.js` and `x-display-session-layout.js` / `live-scene-reconcile.js`
      fixes are pure in-process JS — they take effect on the **next highascg process restart**
      (not a Caspar restart; Caspar itself doesn't need touching). No config files were modified.
