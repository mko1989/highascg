**Status: OPEN (2026-10-17) — three defects confirmed by code reading; not fixed, nothing run on the box. Found while inventorying the web client for [WO-593](./593_WO_godot_client_port_epic.md). Independent of the port: fix in the web client (it stays for remote browsers, WO-608).**

# WO-611 — Web client defects found during the Godot port inventory

## Investigation (each confirmed by reading both ends, 2026-10-17, tree = `origin/main` d5521d50)

### 1. Global-border autosave event never reaches its listener

- Dispatch: `client/components/inspector-global-border-events.js:6`
  `window.dispatchEvent(new CustomEvent('highascg-global-border-config-save'))`
- Listener: `client/app.js:285`
  `document.addEventListener('highascg-global-border-config-save', () => void flushAutosave())`
- Events dispatched on `window` do not propagate down to `document`, so `flushAutosave()` is never
  called from this path. Other autosave triggers (scene `change`, debounced) may mask it — owner-
  visible effect to be checked on the box (edit only a global border, reload within 3 s).
- Fix: dispatch on `document` (match every other `highascg-*` autosave trigger in `app.js:254-307`).

### 2. WS catalog requests are double-encoded → always fall back to HTTP after 120 s

- `client/lib/deferred-catalog-ws.js:58,100`: `ws.send(JSON.stringify({ type: 'catalog_request', … }))`.
- The `ws` passed in is the `WsClient` (`client/lib/app-ws-handlers.js:130`), whose `send(obj)` →
  `_send` → `this.ws.send(JSON.stringify(obj))` (`client/lib/ws-client.js:58-65`) stringifies again.
- Server: `src/server/ws-server.js:316-317` drops any frame whose first char is not `{`/`[` — a
  double-encoded frame starts with `"`. So `catalog_request`/`catalog_subscribe` never reach
  `src/server/ws-catalog-handlers.js`, and the client waits `120_000` ms (`deferred-catalog-ws.js:34-37`)
  before the HTTP fallback. To confirm on the box: is the media list late after a kiosk reload when
  `catalogDeferred` is set, or does a server-side `catalog_chunk` broadcast mask it?
- Fix: pass the object (`ws.send({ type, … })`), add a smoke that pins it.

### 3. `window.showToast` is called but never defined

- 21 references in `client/` (e.g. `components/header-bar.js:221,224`), zero assignments
  (`git grep "window.showToast\s*="` → none). The real helper is `showAppToast` (`client/lib/app-toast.js:11`).
- Effect: those error toasts are silent.
- Fix: replace with an `showAppToast` import (or assign `window.showToast = showAppToast` once).

### Also noted (not defects, for cleanup)

- Dead: `client/components/inspector-panel-routing.js` (173 LOC), `components/sync-modal.js`,
  `components/publish-modal.js` (0 importers); `scenes-compose-handlers.js` `startRotate/startScale`
  unwired (`:242`); `client/assets/modules/cg-studio/entry.js` unreferenced.
- `StateStore.setState` fires `'*'` listeners twice (`client/lib/state-store.js:86-91`).
- 15 **untracked** stale files under `client/` left over from the pre-2026-10-16 working tree
  (e.g. `client/components/device-view-gpu-source-inherit.js`, `client/assets/modules/cg-studio/*`);
  preserved on branch `backup/local-wip-2026-10-16`. **Owner 17.10: "15 stale, delete them" → DELETED
  17.10** after checking each was byte-identical on the backup branch and unreferenced by tracked code
  (the two name hits — `entry.js`, `device-view-gpu-source-inherit.js` — point at different, tracked files).

## What was done

Nothing yet.

## What was VERIFIED

Code reading only (both ends of each defect). No runtime confirmation.
