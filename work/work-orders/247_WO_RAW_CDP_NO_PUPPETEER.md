# WO-247 — Replace puppeteer with a raw CDP client for CEF interactive input

**Status:** OPEN
**Priority:** HIGH (owner-picked option 1 for the CEF-GUI workflow; de-risks Option B of the transparent-previews plan)
**Owner check:** A247.1

## Owner intent
CEF input control WITHOUT puppeteer. Keep the DevTools wire (CEF `remote-debugging-port`, already emitted by `src/config/config-generator.js:92`), replace the puppeteer client with a thin raw CDP WebSocket client. Same behavior for every existing consumer (mario controls, live-webpage host flow, arm-input inspector, X11 bridge, `/api` forward routes).

## Ground truth
- The ONLY puppeteer consumer is `src/system/cef-interactive-cdp.js` (460 lines; `require('puppeteer-core')` at line 34 inside `connectCefBrowser`). `src/system/cef-interactive-forward.js` consumes its exports and must NOT need changes beyond, at most, the `page.evaluate` call at its lines 245-248 (see T247.2).
- Exports to preserve exactly (same names, same call signatures, same observable semantics): `readCefDebugPortFromCasparXml`, `connectCefBrowser`, `resolveStableCefPage`, `warmCefPage`, `clearStableCefPages`, `urlMatchesNeedle`, `listCefPageUrls`, `forwardMouseEvent`, `forwardKeyEvent`, plus everything else currently in `module.exports` (read the file end for the full list).
- Target discovery is ALREADY raw HTTP: `fetchCdpTargets(port)` (line 22) hits `http://127.0.0.1:<port>/json/list`. Keep it.
- Keysym machinery to KEEP as-is (pure logic, already correct): `htmlNeedleFromInfoXml`, `cefMatchTokens`, `urlMatchesNeedle`, `cefPageCacheKey`, `mapPointToCef`, `isModifierKeysym`, `keysymToModifierName`, `normalizeModifierList`, modifier state (`resetKeyboardModifierState`/`ensureModifiersDown`/`releaseModifier`), `keysymToKey`, `keysymToText`. Only the puppeteer dispatch calls inside forwardMouseEvent/forwardKeyEvent/ensureModifiersDown/releaseModifier change.
- WebSocket client: use the existing `ws` dependency (`package.json`, ^8.21.0) — do NOT add dependencies. (Node is v24, global WebSocket also exists, but `ws` matches the codebase.)
- Consumers that must keep working unchanged: `cef-interactive-forward.js`, `cef-interactive-bridge*.js`, `host-operator-fullscreen.js`, `routes-cef-arm-input.js` — grep for each import of cef-interactive-cdp exports and confirm signature compatibility; list them in your report.

## Design

**T247.1 — new module `src/system/cef-cdp-client.js`** (keeps cef-interactive-cdp.js under the 500-line limit)
A minimal CDP session client over `ws`:
- `connectCdp(wsUrl)` → session with `send(method, params)` (Promise, matching `id` correlation, 5s timeout per command), `on('close')`, `close()`, `get connected()`.
- JSON message framing per DevTools protocol; reject pending commands on socket close; no event subscription machinery beyond what's needed (we only send commands).
- Page-session wrapper `createCefPage({ targetInfo, wsUrl })` exposing the minimal page interface the rest of the code uses:
  - `page.url()` (from targetInfo, refreshed on navigation is NOT required — match current usage),
  - `page.evaluate(expression)` → `Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true })` returning `result.result.value` (throw on `exceptionDetails`) — NOTE signature change: takes a raw expression STRING (see T247.2),
  - `page.dispatchMouseEvent(params)` / `page.dispatchKeyEvent(params)` → `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`,
  - `page.close()` / `page.isClosed()` for cache invalidation.
- Each CEF target's `webSocketDebuggerUrl` comes from the existing `/json/list` fetch.

**T247.2 — rewrite the puppeteer paths in `src/system/cef-interactive-cdp.js`**
- `connectCefBrowser(port)` → returns a lightweight browser handle `{ port, connected, disconnect() }` over the target list (no persistent browser-level socket needed — page sessions each own their WS; `connected` true while handle not disconnected).
- `pageFromBrowserTargets` / `connectCefPageByNeedle` / `findCefPage` / `resolveStableCefPage` / `warmCefPage`: same matching/caching/retry logic, but produce `createCefPage` sessions from `/json/list` entries instead of puppeteer pages. Preserve the stable-page cache semantics (`cefPageCacheKey`, `clearStableCefPages`) including invalidation of closed/broken sessions (a dead WS must evict the cache entry and re-resolve, not throw forever).
- `forwardMouseEvent(page, type, x, y, button)` → `Input.dispatchMouseEvent`: type `mousePressed`/`mouseReleased`/`mouseMoved`, `button` left/middle/right from the numeric button (1/2/3 today — preserve current mapping), `clickCount: 1` on press/release, buttons bitmask on move-with-button if current code does drags (check how mario drag works today — replicate).
- `forwardKeyEvent(page, type, keysym, text, opts)` → `Input.dispatchKeyEvent`:
  - keydown → `rawKeyDown` (+ a separate `char` event when there is printable `text`), keyup → `keyUp`.
  - Fields: `key` (from existing `keysymToKey`), `text`/`unmodifiedText` (from `keysymToText`), `windowsVirtualKeyCode` + `nativeVirtualKeyCode` (NEW small table, T247.3), `modifiers` bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8) from the existing modifier state machine.
  - `ensureModifiersDown`/`releaseModifier` switch from puppeteer `keyboard.down/up` to the same `Input.dispatchKeyEvent` calls with the modifier's VK code.
- `cef-interactive-forward.js` lines 241-249 ('eval' type): replace the `page.evaluate((expr) => eval(expr), expression)` puppeteer pattern with `page.evaluate(expression)` (Runtime.evaluate takes the expression directly — the eval-wrapper is unnecessary and stays out of the new client). This is the ONLY permitted change in that file.

**T247.3 — VK code table** (inside cef-cdp-client.js or a tiny sibling): keysym/key-name → Windows virtual key code for the keys the bridge actually forwards: A-Z (65-90), 0-9 (48-57), F1-F12 (112-123), Enter 13, Escape 27, Backspace 8, Tab 9, Space 32, Arrows 37-40, Home 36, End 35, PageUp 33, PageDown 34, Delete 46, Insert 45, Shift 16, Control 17, Alt 18, Meta 91, punctuation used by mario/text (comma 188, period 190, minus 189, equals 187, semicolon 186, quote 222, slash 191, backslash 220, brackets 219/221, backquote 192). Unknown keys: send 0 (CEF tolerates it for char events).

**T247.4 — dependency removal (package.json ONLY)**
Remove the `puppeteer` entry from package.json dependencies. Do NOT run npm install/uninstall (node_modules stays as-is for instant rollback; prune happens later). Grep the whole repo for any other `require('puppeteer` — report findings; `puppeteer-core` type-only JSDoc comments should be updated to the new types.

**T247.5 — offline tests** `tools/smoke/smoke-wo247-raw-cdp.test.js` + curated gate FILES entry:
1. In-test mock CDP server: `ws` server on an ephemeral 127.0.0.1 port + a tiny HTTP `/json/list` responder; assert the client connects, correlates command ids, resolves `Runtime.evaluate` results, times out a never-answered command, rejects pending commands on close.
2. `Input.dispatchKeyEvent` payload assertions: keydown of keysym for 'a' with Shift held produces rawKeyDown with modifiers=8, windowsVirtualKeyCode=65, then char with text 'A' (match whatever keysymToText produces — verify against the real function, don't assume).
3. Mouse press/release payload shape for button 1 → left, clickCount 1.
4. Stable-page cache eviction: close the mock target's socket, next resolve re-fetches targets.
All sockets bound to 127.0.0.1 ephemeral ports inside the test, closed in teardown. NO connection to the real Caspar debug port, NO AMCP, NO live server.

## Constraints (standard)
- No git, no service ops, no AMCP, no HTTP to :4200/:5250 or the real CEF debug port, no `npx vite build`, curated gate ONLY (`node tools/ci/run-offline-tests.js`), NEVER the full suite.
- `node --check` + repo-local `./node_modules/.bin/eslint --quiet` on all touched files; gate with exact counts.
- Match file style (tabs, JSDoc on exports). Keep both cef modules under 500 lines each.
- Check WO checkboxes only for shipped work; note deviations honestly. The live end-to-end (mario controls via the new client) is the orchestrator/owner's A247.1 — do not attempt it.

- [x] T247.1 cef-cdp-client.js session + page wrapper
- [x] T247.2 cef-interactive-cdp.js puppeteer paths rewritten (+ the single eval-call change in cef-interactive-forward.js)
- [x] T247.3 VK table
- [x] T247.4 puppeteer removed from package.json (node_modules untouched); repo-wide require grep reported
- [x] T247.5 mock-CDP smoke in curated gate
- [ ] A247.1 (owner/orchestrator) live: arm mario input, verify keys+mouse; live-webpage host flow; eval route
