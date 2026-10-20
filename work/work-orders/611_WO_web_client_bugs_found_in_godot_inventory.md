**Status: ✅ Defects #1–#9 fixed (#4/#5 18.10, #1–#3 + #6–#9 20.10). "Also noted" dead code / double `'*'` listener left as cleanup. Found while inventorying the web client for [WO-593](./593_WO_godot_client_port_epic.md). The web client stays for remote browsers (WO-608).**

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

### 4. Compose-frame move snapping only fired when BOTH edges snapped (fixed 2026-10-18, `adfe2540`)
`client/components/scenes-compose-handlers.js` startDrag compared the left-edge snap with the right edge's no-op result (distance
0 always wins), so dragging a layer near a border/neighbour never snapped unless the other edge happened to snap too. Found when the
golden-faithful Godot port failed its own snap tests. Fix: exported pure `snapMoveAxis` (nearest edge that actually snaps, tie →
start edge; per-edge comparison to avoid the `(v+size)-size` float trap). Smoke `smoke-wo611-compose-move-snap` 2/2 (fails on the
old code); dist-web rebuilt. Godot `compose_math.gd` uses the same rule.

### 5. Compose-frame drop skipped the file's trim/mute defaults (fixed 2026-10-18)
WO-592 decided (04.10) that a file's trim/mute defaults are copied into a look on drop, and its notes say the patchLayer hook
"covers every drop path (compose, …)". `scenes-compose.js` addLayerFromMedia sets the source with `setLayerSource`, which never
reaches that hook → a clip dropped on the compose frame came in without its defaults. Fix: `fileDefaultsPatchForNewSource`
(media-file-defaults.js) applied after setLayerSource; the same helper serves POST /api/scene/new-layer. Smoke
`smoke-wo611-compose-drop-file-defaults` 2/2; dist-web rebuilt.

### 6. Settings GET redacted the `nuclearRequirePassword` flag (found 2026-10-20 building the Godot Nuclear pane)

- `src/support/redact-settings.js:24` `redactValue` replaced EVERY value whose key matches `SENSITIVE_KEY_RE`
  (`/password/i`) with `'[REDACTED]'` — the boolean `ui.nuclearRequirePassword` included. Probed: with the
  requirement on, `GET /api/settings` returned `"nuclearRequirePassword": "[REDACTED]"`.
- Web `settings-modal-logic.js` reads it as `=== true` → checkbox unticked, and any Settings save posts
  `false` back → the nuclear password requirement is silently dropped (hash kept, gate off). Godot read it off too.
- Fix: booleans pass through `redactValue` (a flag leaks nothing); strings under sensitive keys stay redacted.

### 7. Settings → System printed every disk size as "NaN GB" (found 2026-10-20 porting the System pane)

- `GET /api/system/hardware` → `disks[].size` is lsblk text (`"8G"`, `"953.9G"`, `"1.9T"` — probed live).
- `client/components/settings-modal-mount-hardware-summary.js:12` `formatBytes` compared it with numbers (all
  false) and fell through to `(NaN).toFixed(1) + ' GB'`.
- Fix: strings pass through unchanged (Godot `system_model.gd` `fmt_bytes` does the same).

### 8. Settings → Live audio always warned "not in channelMap yet" (found 2026-10-20 porting the pane)

- `client/components/settings-live-audio-panel.js:126` `renderStatus` read `liveState?.channelMap`, but
  `GET /api/audio/live-inputs` (`src/api/routes-audio.js:114-127`) returns `inputsCh`, `liveAudioInputChannels`,
  `liveAudioCount`, `configured`, `status` — no `channelMap`. `listInputChannels({})` is empty, so with any slot
  configured the pane showed the "Apply Caspar config and restart" warning even when the channels existed.
- Fix: fall back to `{ liveAudioCount, liveAudioInputChannels }` from the same payload — `listInputChannels`
  already synthesises live-audio entries from those (`client/lib/input-channels.js:148-152`).

### 9. ALSA mixer rescaled the server's percent (found 2026-10-20)

- `client/lib/alsa-mixer-api.js` `alsaControlPercent` takes `percent ?? value`, then rescales by `min..max`
  whenever the number falls inside that range. The server always sends `percent` (0..100, probed: Master
  `max 87, value 87, percent 100`), so any percent ≤ max was rescaled again: 50 % on a 0..87 control showed 57 %.
- Fix: rescale only when no `percent` was sent.

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

## What was done (2026-10-20, #1–#3)

1. `inspector-global-border-events.js` dispatches `highascg-global-border-config-save` on `document`.
2. `deferred-catalog-ws.js` passes the request objects to `WsClient.send` (one JSON encoding).
3. The 21 `window.showToast?.(…)` calls in 6 files import and call `showAppToast` (`client/lib/app-toast.js`).

Smoke `tools/smoke/smoke-wo611-web-client-defects.test.js` (curated): the catalog loader against a fake
WsClient (fails on the old code: the request arrives as a string), the dispatch/listen pair, no
`window.showToast` left. `dist-web` rebuilt.

### #6 (2026-10-20)

- `src/support/redact-settings.js`: `if (typeof value === 'boolean') return value` before the key test.
  Empty-string secrets stay `'[REDACTED]'` on purpose — `mergeUiNuclearPasswordSettings` keeps the hash only
  for the placeholder when the requirement is off, so unredacting `''` would change what a web save does.
- `tools/smoke/smoke-wo611-redact-keeps-flags.test.js` (curated): flags pass, password + hash stay redacted.

### #7 (2026-10-20)

- `settings-modal-mount-hardware-summary.js` `formatBytes`: `if (typeof bytes === 'string') return bytes || '—'`.

### #8 / #9 (2026-10-20)

- `settings-live-audio-panel.js` `renderStatus`: `cm = liveState?.channelMap || { liveAudioCount, liveAudioInputChannels }`.
- `alsa-mixer-api.js` `alsaControlPercent`: `if (ctrl.percent == null && max > min && …)`.

## What was VERIFIED

- #2 against the live server (`ws://127.0.0.1:4200/api/ws`): a double-encoded `catalog_request` gets no reply;
  the single-encoded one gets its `catalog_chunk` (5 templates).
- Smoke 3/3; #1 and #3 by the source assertions only (no browser session on the box for a click test).
- Owner-visible effect of #1 (border-only edit, reload within 3 s) not run.
- #6 live: after the server restart `GET /api/settings` → `ui.nuclearRequirePassword: false` (a boolean), with
  `nuclearPassword` / `nuclearPasswordHash` still `'[REDACTED]'`. Smoke 2/2. Web checkbox click-through not run.
- #7: `tools/smoke/smoke-wo611-disk-size-text.test.js` (curated) evaluates the real `formatBytes` body: "953.9G"
  passes through, numbers still format. Web Settings → System not opened in a browser after the fix.
- #8 / #9: `tools/smoke/smoke-wo611-live-audio-settings.test.js` (curated, 2 tests) pins the fallback and imports the
  real `listInputChannels` ({count 2, channels [5, 6]} → slots 1→5, 2→6) and `alsaControlPercent` (49 stays 49).
  Not reproduced in a browser — the box has 0 live-audio slots; the Godot pane shares both rules.
