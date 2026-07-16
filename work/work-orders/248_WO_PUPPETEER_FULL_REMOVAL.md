# WO-248 — Remove the whole puppeteer branch (thumbnails + DOM smokes to raw CDP, dependency purged)

**Status:** UNBLOCKED, pending scheduling (2026-07-16, WO-257). The original blocker — A247.1
"mario-over-CDP" proof that `cef-cdp-client.js` could carry CEF interactive input — is now MOOT:
WO-257 removed the CEF interactive bridge outright (repeated production crash-loops), so there is
no input path left to prove. `cef-cdp-client.js` itself is unaffected and stays (WO-257 kept it
explicitly as the generic raw-CDP client this WO migrates thumbnails onto). Scope below is
unchanged: thumbnails → `cef-cdp-client.js` over cached headless Chrome; `npm uninstall puppeteer`.
**Priority:** MEDIUM
**Depends on:** WO-247 (raw CDP client `src/system/cef-cdp-client.js` proven live against Caspar CEF)

## Scope — the two puppeteer legs
Leg 1 (CEF input) is WO-247. This WO removes leg 2 (**puppeteer-launched headless Chrome**) and then purges the dependency:

- `src/media/cg-look-thumb-render.js` — `puppeteer.launch` (line ~111), element/page screenshots with `omitBackground` + `clip` (lines ~236-257). Renders look/LT thumbnails.
- `tools/runtime/generate-lt-thumbnails.js` — same family, batch LT thumbnails.
- `tools/smoke/smoke-logs-modal-toggles.mjs`, `tools/smoke/smoke-settings-nuclear-password-dom.mjs` — DOM smokes driving headless Chrome (NOT in curated gate; verify and keep them runnable).
- `package.json` `puppeteer` ^25.3.0 (WO-247 removes the entry; this WO does the actual `npm uninstall puppeteer` → package-lock + node_modules prune).
- `~/.cache/puppeteer` — 1.3 GB, TWO Chrome-for-Testing versions (linux-149.0.7827.22, linux-150.0.7871.24). The newer binary is KEPT (it's a plain executable; nothing about it needs puppeteer). Owner may later replace with `apt install chromium` — document both.

## Design

**T248.1 — headless-Chrome session helper** (new `src/media/headless-chrome-cdp.js` or extend `src/system/cef-cdp-client.js` — pick based on line budget; cite your choice)
- `resolveChromeBinary()`: env `HIGHASCG_CHROME_BIN` → else newest `~/.cache/puppeteer/chrome/linux-*/chrome-linux64/chrome` → else `chromium`/`chromium-browser`/`google-chrome` on PATH → clear error listing the options.
- `launchHeadlessChrome(opts)`: `child_process.spawn` with `--headless=new --remote-debugging-port=0 --no-first-run --no-default-browser-check --disable-gpu --hide-scrollbars` + user-data-dir in a scratch tmpdir; parse `DevTools listening on ws://...` from stderr (timeout + kill on failure); return `{ browserWs, kill() }`. Reuse the WO-247 CDP session client for commands; add the missing domain helpers needed here: `Target.createTarget`/`attachToTarget` (or connect to the page target from `/json/list`), `Page.enable`, `Page.navigate` + load-event wait, `Emulation.setDeviceMetricsOverride`, `Emulation.setDefaultBackgroundColorOverride` (rgba 0,0,0,0 = the `omitBackground` equivalent), `Page.captureScreenshot({ format:'png', clip })`.
- Element screenshot = `Runtime.evaluate` on `getBoundingClientRect()` of the selector → clip rect (devicePixelRatio-aware, matching current output dimensions).

**T248.2 — migrate `src/media/cg-look-thumb-render.js`**
Read the whole file first; preserve its public API and output bytes' semantics (PNG with transparency, same dimensions/clip behavior, same lifecycle: shared browser instance, `browserPromise` reuse, teardown path). Byte-identical PNGs are NOT required (encoder may differ) but dimensions + alpha channel are.

**T248.3 — migrate `tools/runtime/generate-lt-thumbnails.js`** the same way.

**T248.4 — migrate the two DOM smokes** (`.mjs`) to the helper; run each standalone and paste results.

**T248.5 — purge dependency**
- `npm uninstall puppeteer` (this is the ONE allowed npm operation; run it and report the package-lock diff summary and node_modules delta).
- Repo-wide grep `puppeteer` afterward: only historical docs/work-orders may remain; fix any missed JSDoc types.
- Do NOT delete `~/.cache/puppeteer` (owner decision — deleting the older linux-149 dir frees ~650 MB; recommend in report, don't do it).

**T248.6 — smoke** `tools/smoke/smoke-wo248-chrome-binary-resolve.test.js` in the curated gate: `resolveChromeBinary` precedence with fixture dirs in tmpdir (env override wins; newest version dir picked; helpful error when nothing found). Launching real Chrome stays OUT of the gate (slow, binary-dependent) — the live render check is A248.1.

## Constraints (standard)
- No git, no service ops, no AMCP, no HTTP to :4200/:5250 or Caspar's CEF debug port. Launching the cached Chrome headless FOR YOUR OWN standalone testing of T248.2/3 is permitted (it's an isolated process) — kill everything you spawn; no orphans (`pgrep -f headless` clean afterward).
- Curated gate ONLY; `node --check` + `./node_modules/.bin/eslint --quiet` on touched files.
- Keep files under 500 lines; match style; honest checkboxes.

- [x] T248.1 headless CDP helper + binary resolver
- [x] T248.2 cg-look-thumb-render.js migrated
- [x] T248.3 generate-lt-thumbnails.js migrated
- [x] T248.4 DOM smokes migrated (standalone runs pasted)
- [x] T248.5 npm uninstall puppeteer + repo grep clean
- [x] T248.6 binary-resolve smoke in gate
- [ ] A248.1 (owner/orchestrator) live: LT thumbnails regenerate correctly; look thumbs render with transparency
