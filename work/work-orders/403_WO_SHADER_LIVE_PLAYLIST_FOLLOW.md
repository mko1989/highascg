# WO-403 — Shader Live editor vs shader playlists: lists only the first item, edits replay it on air

**Status: IN PROGRESS (implemented + suite green 01.08; NOT built/deployed — on show. Post-show: `npm run build:client` + kiosk F5, then owner QA)**

Owner report (`issues_01.08.26` item 1): "when i go into shader editor while a playlist with
shaders is playing, it only shows the first from the list. when another one is playing and i
will make adjustments it will transition to the first shader."

## Investigation

Two defects, one root cause: **`scene.live` is the scene AS AUTHORED, and playlist hops never
touch it.**

1. The engine advances a playlist by playing the next item directly on the channel-layer —
   `triggerPlaylistAdvance` (`src/engine/scene-take-lbg-playlist.js:377-441`) does
   `LOADBG`+warm+`PLAY` (MIX) or `CG ADD` (CUT), and records the hop ONLY in the server-side
   `self.playlistActiveIndices` (`:419`). The live scene layer's `source.value` stays the
   authored value (the first/original item) forever.
2. The editor's instance list is built from exactly that stale value:
   `liveShaderInstances` (`client/lib/shader-live-instances.js`) regex-matches
   `layer.source.value` → the dropdown shows the first shader only, whatever is on air.
3. The "transitions to the first shader" is the editor's own 403-fallback firing with stale
   ammo: a MIX-hop leaves a PLAIN html producer on the layer, so `CG UPDATE` 403s, and
   `pushLive` (`client/components/shader-live-editor.js:270-289`, comment at `:279`)
   compensates with `CG <ch>-<layer> ADD 0 "<cgName>" 1 "{}"` — where `cgName` came from the
   stale instance = **the first shader's template path**. The first edit therefore visibly
   replays shader #1 over whichever shader was actually playing. Mechanically exact match to
   the report.
4. The current index IS available: `GET /api/playlist/state` returns per live playlist layer
   `{ channel, layerNumber, activeIndex, items[] }` (`src/api/routes-playlist.js:20-70`); the
   Playlists footer panel already polls it while open (`client/components/playlist-control-panel.js`).
   There is no client-visible state tick on a hop, so polling is the only signal.

## What was done (client-only)

- `client/lib/shader-live-instances.js`:
  - `liveShaderInstances(stateStore, playlistNow)` — a layer with `sourceMode==='list'` resolves
    through `playlistNow` (`'<channel>-<layerNumber>'` → active item value) instead of the
    authored `source.value`; `cgName` follows too, so the 403→CG ADD re-host replays the shader
    that is actually on air (a hop mid-edit re-hosts the RIGHT one). A non-shader active item
    (video between shaders) correctly yields no instance.
  - `createPlaylistNowTracker(api, onChange)` — 1 s poll of `/api/playlist/state` (same source
    as the Playlists panel), builds the map, fires `onChange` only when it changed.
- `client/components/shader-live-editor.js`:
  - tracker started/stopped with the overlay (`setOpen`), change feeds `onLiveChanged()` (the
    same path state ticks use — dropdown re-render + `loadSelected`).
  - selection follow: when the selected key vanishes (hop replaced the instance on that
    channel-layer), select the instance on the SAME `@<channel>-<pLayer>` instead of snapping
    to `list[0]`. Editing across a hop reloads the now-playing shader's params.

Why not a server fix (updating live state on hops): `scene.live` deliberately holds the authored
scene (WO-341 server-truth sync; autosave/deck ingestion read it) — mutating layer sources at
playout time would ripple into project sync. The runtime index already has an API; the editor
just wasn't asking.

## What was VERIFIED to work

- New `tools/smoke/smoke-wo403-shader-live-playlist-follow.test.js` (registered in the curated
  CI list): resolution before/after a hop, cgName follow, non-shader item withdrawal, no
  cross-layer key leak, editor wiring source-asserts. 3/3 pass.
- Full offline suite: **1766 pass / 0 fail / 2 skip** (+ the new file ⇒ 1769/0/2 on re-run).
- 500-line limit: editor at 495, lib at 94 — `check-max-file-lines` clean.
- NOT yet verified live (no dist-web rebuild mid-show). Owner QA post-deploy: play a shader
  playlist, open Shader Live → dropdown shows the shader on air, updates ~1 s after each hop;
  tweak a param while item ≥2 plays → the CURRENT shader updates (one visible producer restart
  on the first tweak after a MIX hop is expected — the CG re-host, as before, just now with the
  right shader).
