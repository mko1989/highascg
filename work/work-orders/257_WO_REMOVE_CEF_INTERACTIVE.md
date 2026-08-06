# WO-257 — Remove the CEF interactive subsystem entirely

**Status:** DONE (06.08.26 — removal complete, no dangling requires, gate green; the server has booted cleanly through dozens of restarts since with no bridge logs. Remaining owner tick (mario still plays, uncontrolled) on `work/checklist06.08.26_close_all_wos.md`.)
**Priority:** HIGH (owner: "cef interactive needs to go" — after warmInFlight crash-loop, zoneTargets connect-rejection, needle poisoning)
**Owner check:** A257.1

## Scope — what goes, what stays

**GOES (the input/interaction machinery):**
- `src/system/cef-interactive-bridge.js`, `cef-interactive-bridge-lifecycle.js`, `cef-interactive-bridge-events.js`, `cef-interactive-bridge-shared.js`, `cef-interactive-bridge-zones.js`, `cef-interactive-trace.js`, `cef-focus-registry.js`, `cef-interactive-forward.js`, `cef-interactive-cdp.js` (needle/page/warm/forward — its only purpose was input+eval targeting).
- `tools/runtime/cef-interactive-x11.py`.
- Routes + registrations in `src/api/router.js`: `/api/cef/arm-input`, `/api/cef/release-input`, all `/api/cef-interactive/*` (targets/focus/mouse/keyboard/eval) — delete `src/api/routes-cef-arm-input.js`, `src/api/routes-cef-interactive.js`.
- Client: `client/components/inspector-interactive-input.js` (arm toggle) + its mount site(s); any `cefFocusTarget` WS-change consumers (grep client/).
- `notifyCefInteractiveAmcpLines` call in `src/api/routes-amcp.js`; the `syncCefInteractiveBridge` calls in `index.js` (3 sites) and `src/api/settings-post.js`; `stopCefInteractiveBridge` in `src/bootstrap/shutdown.js`; interactive-zone reservation of layer 999 if bridge-only.
- Gate/live smokes: `smoke-wo232-arm-input.test.js` (remove from FILES + delete), `smoke-cef-cdp-input.live.test.js`, `smoke-wo247-raw-cdp.test.js` — SPLIT decision: keep the tests of `cef-cdp-client.js` (stays!), delete only the parts testing cef-interactive-cdp.js exports (forwardKeyEvent/forwardMouseEvent/needle matching). Report exactly what you kept.

**STAYS:**
- `src/system/cef-cdp-client.js` — the generic raw CDP client (WO-248 migrates the headless-Chrome thumbnail renderers onto it). If it imports nothing from the removed files (verify), it stands alone.
- Webpage-host CONTENT features (playing a URL on a host channel, routing it): `src/api/host-live-webpage.js` / `host-operator-fullscreen.js` — strip their interactive/focus/needle imports and code paths (grep for imports from removed modules; the routing/AMCP parts stay). If host-operator-fullscreen turns out to be interaction-only (its purpose was routing a webpage to the operator display WITH input), report and gut accordingly — routing without input may still be wanted; keep the route working, minus focus/input.
- `remote-debugging-port` emission in config-generator (harmless; future thumbnail/diagnostics use).
- The WO-255 shape/launcher/operator-GUI stack (independent).

**Consequence (owner-accepted):** mario (and any interactive template) loses keyboard/mouse control — it still plays as a template. Note it in `docs/` where mario is documented and in the WO-232 work order as a status addendum.

## Also update
- `work/work-orders/248_WO_PUPPETEER_FULL_REMOVAL.md`: its blocker (A247.1 mario-over-CDP proof) is MOOT — the input path no longer exists. Reword status: unblocked, pending scheduling; scope unchanged (thumbnails → cef-cdp-client over cached Chrome; npm uninstall).
- `work/OPEN_ISSUES.md` is updated by the orchestrator, not you.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm, no vite build, curated gate ONLY. After removal: `node --check` on every file that imported removed modules (grep first, list them), `./node_modules/.bin/eslint --quiet` on touched files, full curated gate exact counts, `node -e "require('./index.js')"` is NOT allowed (would start the server) — instead `node --check index.js` + grep-verify no dangling requires of deleted paths anywhere in src/, client/, tools/ (a missed one is a boot crash: this exact class caused a production crash-loop yesterday — treat the dangling-require sweep as the most important verification step).

- [x] T257.1 modules + python + routes deleted; router registrations removed
- [x] T257.2 all callers stripped (index.js, settings-post, shutdown, routes-amcp, host-live-webpage, host-operator-fullscreen, client)
- [x] T257.3 smokes split/removed; gate green (448 passed / 0 failed / 2 pre-existing skips)
- [x] T257.4 dangling-require sweep (report the grep proof)
- [x] T257.5 WO-248 unblock note + mario docs addendum
- [ ] A257.1 (owner) restart: boot clean, no bridge logs, mario plays (no controls), operator GUI unaffected — NOT done by this pass (no service restarts permitted on the live box per constraints; needs an owner-driven restart to verify)
