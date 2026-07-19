# WO-264 — Operator GUI auto-start at boot + fresh-system default (one screen with the GUI)

**Status:** Implemented (owner acceptance A264.1 pending — live boot/positioning cannot be exercised offline)
**Priority:** HIGH (owner request 2026-07-17, todos17.07.26)
**Depends on:** WO-255 (Firefox launcher + shape overlay), WO-246 (operator monitor auto-select), WO-262/263 (hole-in-Firefox inversion)

## Owner intent
1. When an operator GUI is defined in the device-view config AND its monitor is connected, the operator UI browser must auto-start when highascg starts — no manual "Launch" click.
2. On a completely fresh system the GUI must appear: the factory default config should be **one screen with the operator GUI** (not the current PGM-only screen with no GUI anywhere).

## Ground truth (verified 2026-07-17)
- Launcher exists and is idempotent: `launchOperatorGuiBrowser(ctx)` at `src/system/operator-gui-launcher.js:149` raises instead of double-spawning (`isRunning()` guard `:42`). Spawns `firefox --kiosk --new-instance --profile <REPO>/.operator-firefox-profile <guiUrl>` on `DISPLAY=:0` via `displaySessionEnv()`, then positions by WM_CLASS with xdotool to `resolveOperatorGuiMonitorRect(ctx.config)`. NOTE launcher header `:12-18` flags the post-spawn resize/reposition as not yet live-verified.
- Today NOTHING auto-launches: `index.js` and `run.sh` have zero references to the launcher. The only boot-time operator-GUI hook is `routing-setup.js:326-337` — when `map.operatorGuiEnabled` it calls `ensureOperatorGuiChannel(self)` (`operator-gui-channel.js:417`), which is a shape-feed/WS-nudge no-op that does NOT launch Firefox. Launch happens only via `POST /api/operator-gui/launch` (`routes-operator-gui.js:37`, inspector button in `device-view-destinations-inspector-operator-gui-fields.js:67-82`).
- "Defined": an `operator_gui`-mode screen destination (`screen-destinations.js:81-82,134-142`; fields `guiUrl` default `http://127.0.0.1:4200/?operatorGui=1`, optional `physicalPort` 1-4). `routing-map.js:249-254,388-391` derives `operatorGuiEnabled`/`operatorGuiCh`.
- "Connected": `resolveOperatorMonitorPort(config)` (`src/utils/operator-monitor-resolve.js:40`) returns `{port, mode}` with mode `auto-single|flag|none|fallback-flag`, built from xrandr/EDID runtime state; surfaced in the snapshot at `device-view-snapshot.js:360`.
- Fresh defaults: `buildFactoryModularConfig` (`src/config/factory-starter.js:19-33`) ships exactly one destination `PGM 1` (`pgm_only`, 1080p50), `screen_count = 1`, no operator_gui destination, no `screen_N_operator_monitor` flags. The ISO writer consumes it via `tools/eggs/live-usb/write-iso-default-config.js:174-183`. Base `defaults-core.js:239-251` has empty screenDestinations/deviceGraph.
- Client mode gate is the URL param `?operatorGui` (`client/lib/operator-gui-mode.js:41-49`); it retitles the window to `HIGHASCG-OPERATOR-GUI` so the shape helper holes the right Firefox.

## Design

**T264.1 — auto-launch decision helper** (in `src/system/operator-gui-launcher.js`, keep <500 lines; spill to a sibling if needed)
`shouldAutoLaunchOperatorGui(config)` → `{ launch: boolean, reason: string }`, pure/offline-testable:
- `false` when no operator_gui destination (`operatorGuiEnabled` falsy in the routing map, or no destination with `mode:'operator_gui'`).
- `false` when the destination sets `autoLaunch: false` (NEW optional field, default **true**; normalize in `screen-destinations.js:134-142`).
- `false` when `resolveOperatorMonitorPort(config).mode === 'none'` (multiple displays, no flag) — log the reason; do not guess a monitor.
- `true` otherwise (`auto-single`, `flag`, `fallback-flag` all count as "defined and connected enough"; `fallback-flag` means detection unavailable — trust the explicit flag).

**T264.2 — boot/reconnect hook** (`src/config/routing-setup.js:326-337`, inside the existing `map.operatorGuiEnabled` branch)
After `ensureOperatorGuiChannel(self)`, call a new `maybeAutoLaunchOperatorGui(self)`:
- No-op when `shouldAutoLaunchOperatorGui` says no, when already running (`isRunning()`), or in test context (`NODE_TEST_CONTEXT` — same guard the shape overlay uses at `operator-shape-overlay.js:46-48`).
- X readiness: the `:0` session may lag highascg at boot. Retry up to 5 times with 10s backoff when the spawn/positioning fails because the display or xdotool target isn't there yet; log each attempt at info, give up with a single warn (the inspector Launch button remains the manual fallback). No crash-loop: a hard failure must never take down startup (wrap everything; never throw into routing-setup).
- Reconnect-safe: the branch re-runs on every Caspar reconnect — the `isRunning()` guard makes that a raise-at-most, matching current manual semantics.

**T264.3 — fresh-system default: one screen with the GUI** (`src/config/factory-starter.js:19-33` + `tools/eggs/live-usb/write-iso-default-config.js`)
Replace the factory `destinations` array's single `PGM 1` entry with an `operator_gui` destination (`id: 'dest-operator-gui'`, `mode: 'operator_gui'`, default `guiUrl`, no `physicalPort` — WO-246 auto-single picks the lone connected display). Keep `screen_count = 1`. Result: a fresh box (or factory reset) boots, the routing map gets `operatorGuiEnabled`, T264.2 fires, and the single attached display shows the operator GUI ready for configuration. Owner decision recorded here: the fresh default is GUI-only — PGM outputs get added in device view during setup (a black PGM on the only screen helps nobody). Verify factory reset path (`write-iso-default-config.js`) emits the same shape; update any factory-config smoke fixtures.

**T264.4 — inspector affordance** (`client/components/device-view-destinations-inspector-operator-gui-fields.js`)
Add an "Auto-start at boot" checkbox bound to the destination's `autoLaunch` field (default checked). Keep the existing Launch/Bring-to-front button unchanged.

**T264.5 — offline smokes** (`tools/smoke/smoke-wo264-operator-gui-autostart.test.js`, curated gate)
- `shouldAutoLaunchOperatorGui` matrix: no destination → false; destination + autoLaunch false → false; destination + mode none → false; destination + auto-single/flag/fallback-flag → true. Stub the monitor resolver, no X calls.
- Factory default shape: `buildFactoryModularConfig()` has exactly one destination, `mode === 'operator_gui'`, `screen_count === 1`; routing map derives `operatorGuiEnabled` from it.
- Hook safety: `maybeAutoLaunchOperatorGui` under `NODE_TEST_CONTEXT` never spawns (assert no child_process call via injected spawner or the env guard).

## Constraints (standard)
No git, no service ops, no AMCP, no HTTP to :4200/:5250, no vite build, curated gate ONLY (`node tools/ci/run-offline-tests.js`), NEVER the full suite. `node --check` + repo-local `./node_modules/.bin/eslint --quiet` on touched files; exact gate counts. Match file style (tabs, JSDoc). <500 lines/file. Honest checkboxes. Live launch verification (Firefox actually appearing at boot, kiosk positioning — including the launcher's flagged unverified resize path) is the owner's A264.1, not attemptable offline.

- [x] T264.1 shouldAutoLaunchOperatorGui helper (+ autoLaunch field normalization)
- [x] T264.2 boot/reconnect hook in routing-setup with retry + never-throw
- [x] T264.3 factory default = one operator_gui screen (factory-starter + ISO writer + fixtures)
- [x] T264.4 inspector "Auto-start at boot" checkbox
- [x] T264.5 smokes in curated gate
- [ ] A264.1 (owner) live: reboot with GUI defined+connected → Firefox kiosk appears on the right monitor without clicking Launch; fresh-image boot shows the GUI on the single display; multi-display-no-flag correctly does NOT launch

## Work log

**2026-07-17 — implemented (all offline tasks).**
- T264.1 `shouldAutoLaunchOperatorGui(config, {resolveMonitorPort})` + `findOperatorGuiDestination` in `src/system/operator-gui-launcher.js` (resolver injectable for offline tests; explicit `physicalPort` short-circuits as launch-worthy, matching the generator's precedence). `autoLaunch` normalized (default true) in the operator_gui branch of `screen-destinations.js`.
- T264.2 `maybeAutoLaunchOperatorGui(ctx)`: fire-and-forget, `NODE_TEST_CONTEXT` guard (same convention as operator-shape-overlay.js), single in-flight chain, 5×10s retries with a 3s post-spawn liveness verify (firefox spawned before X is ready exits immediately — that counts as a failed attempt, not success). Wired in `routing-setup.js` operatorGuiEnabled branch after `ensureOperatorGuiChannel`; un-awaited so boot is never delayed; outer try/catch so it can never throw into routing setup.
- T264.3 `factory-starter.js` destinations now `[dst_operator_gui]` (mode operator_gui, no physicalPort — WO-246 auto-single picks the lone display; guiUrl/autoLaunch from normalization). `screen_count` stays 1. NOTE this also changes the in-app "New project" routing reset (new-project.js deliberately returns to factory shape) — `smoke-new-project.test.js` fixture updated accordingly. ISO writer / clean-slate-reset / exfat starter bundle all consume `buildFactoryModularConfig` and inherit the change with no edits.
- T264.4 "Auto-start at boot" checkbox in `device-view-destinations-inspector-operator-gui-fields.js`.
- T264.5 `tools/smoke/smoke-wo264-operator-gui-autostart.test.js` (8 tests: decision matrix incl. explicit-port resolver-not-called, env-guard no-spawn, factory shape + routing-map operatorGuiEnabled derivation, autoLaunch normalization round-trip), registered in the curated gate.
- Gate: 551 tests / 75 suites, 549 pass, 0 fail, 2 skipped. `node --check` + eslint clean on all touched files.
- Carried-forward risk (from WO-255): the launcher's xdotool windowmove/windowsize sequence is still not live-verified; A264.1 covers it. Also note: the NEXT highascg restart on a box whose config already defines an operator_gui destination will auto-launch Firefox — expected per owner intent, but be aware during the next maintenance window.
