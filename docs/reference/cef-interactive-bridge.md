# CEF interactive bridge (removed, WO-257)

**Status:** Removed. This page is kept as a pointer for anyone following old links or work
orders — the feature it describes no longer exists.

The CEF interactive bridge forwarded operator mouse/keyboard on the multiview (or an interactive
screen consumer) to embedded CEF HTML via the Chrome DevTools Protocol
([WO-89](../../work/work-orders/89_WO_CEF_OPERATOR_CONTROL.md), arm/release toggle added in
[WO-232](../../work/work-orders/232_WO_MARIO_HTML_PRODUCER.md)). It was removed outright in
[WO-257](../../work/work-orders/257_WO_REMOVE_CEF_INTERACTIVE.md) after repeated production
incidents (a `warmInFlight` crash-loop, `zoneTargets` connect-rejection, needle-matching
poisoning) made the shared-process synthetic-input approach too fragile to keep — see
INCIDENT-2026-07-16. WO-255 had already replaced the operator GUI's own CEF layer with a
fullscreen Firefox process using native X11 input, which made the interactive bridge's remaining
justification just embedded-webpage/template input (e.g. `template/mario` — see WO-232).

## What's gone

- `src/system/cef-interactive-bridge*.js`, `cef-interactive-cdp.js`, `cef-interactive-forward.js`,
  `cef-focus-registry.js`, `cef-interactive-trace.js`
- `tools/runtime/cef-interactive-x11.py`
- `POST /api/cef/arm-input`, `POST /api/cef/release-input`, all `/api/cef-interactive/*` routes
- The "Interactive input" arm/release toggle in the scene layer inspector

## What's still here

- `src/system/cef-cdp-client.js` — the generic raw CDP client WO-247 introduced to replace
  puppeteer-core. It doesn't depend on anything removed above. WO-248 completed the puppeteer
  removal: the headless-Chrome thumbnail renderers (`src/media/cg-look-thumb-render.js`,
  `tools/runtime/generate-lt-thumbnails.js`) now run on this client via
  `src/media/headless-chrome-cdp.js`, and the `puppeteer` npm dependency is fully purged from
  `package.json`/`node_modules`.
- Webpage-host content routing (`POST /api/host-live/webpage`, `/api/host-live/operator-fullscreen`
  — see [system-settings-hardware API](../wiki/api/system-settings-hardware.md#host-live-sources--operator-fullscreen)):
  playing a URL on a host channel and (optionally) routing it fullscreen to the operator display
  still works. It just no longer arms keyboard/mouse forwarding into the page.
- `template/mario` and any other "interactive" template still play as templates — they just don't
  receive clicks or key presses anymore.
