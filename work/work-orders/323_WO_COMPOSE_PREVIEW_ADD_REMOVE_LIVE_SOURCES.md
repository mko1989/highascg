# WO-323 — Compose preview: add/remove live sources (Decklink, NDI, …) as tiles

> **IMPLEMENTED 2026-07-25 (commit f8cc0ce) — client-only per the de-risked plan below;
> dist-web rebuilt, NEEDS KIOSK RELOAD to appear.** Drop from the Live tab → movable mvcell tile
> (separate localStorage store, WO-271 channel heal, footer ✕ remove, WO-156 + compose-channel
> self-route guards). smoke-wo323 (16 tests) in the curated gate. Still owed: the on-box drop
> verification (drop a decklink/NDI → tile shows it; remove; persists across reload).

> **VERIFICATION 2026-07-24 — NOT IMPLEMENTED. The todos22 "V2 IMPLEMENTED … APPLIED LIVE"
> note is FALSE.** Independent source audit: `operator-compose-tiles.js` has NO drag/drop
> code at all (no `parseSourceDropPayload`, no dataTransfer handlers, no `✕` remove, no
> `*_operator_source_tiles` localStorage key anywhere in the repo); server
> `operator-gui-channel.js` `resolveCellSourceChannel`/`computeOperatorGuiCellPlan` still
> synthesize whole-channel `route://<ch>` only — nothing can produce `route://6-4`; the
> cited file "operator-gui-mode" does not exist; wo243/wo256 tests contain no route-string
> coverage. No commit and no uncommitted diff. Either never applied or wiped uncommitted.
> **This WO is fully OPEN.** The V1-failure lesson (DeckLink = channel-LAYER route, must
> carry the full route string) recorded below is still the right design input.

**Source:** todos22.07.26 — "add the ability to add (and remove) to compose preview other live
sources like decklink ndi etc."

## Problem
The compose preview shows a fixed PGM/PRV role set per screen. The operator can move/resize tiles
but cannot add a tile bound to an arbitrary live source (Decklink SDI, NDI, v4l2/USB, etc.) or remove
one. The good news from investigation: the **server already produces preview JPEGs for live-input
channels** — the gap is almost entirely on the client (enumerator + missing add/remove UI).

## Root cause — a server/client asymmetry
Two source lists that disagree:
- **Server (broad, already includes live inputs).**
  `collectComposePreviewChannelsFromMap()` (`src/preview/compose-preview-mode.js:70-89`) builds the
  JPEG-preview channel set including PRV+PGM **plus** `map.decklinkInputChannels`,
  `map.v4l2InputChannels`, `map.hostLiveChannels` (NDI/webpage), and `map.inputChannels` (`:83-86`).
  `resolveMonitoredChannels(config)` returns this by default (`:96-109`), surfaced at
  `src/api/routes-compose-preview.js:46,63`. JPEG consumers already attach for these channels
  (WO-144 diff-based sync in `compose-preview-consumer.js`; blocklist/backpressure/404 already
  handle them).
- **Client (narrow, PGM/PRV only).**
  `resolveComposePreviewChannelsFromChannelMap()` (`client/lib/compose-preview-url.js:75-99`) only
  enumerates `programChannels`/`previewChannels` per screen and deletes multiview channels — its own
  JSDoc says "not MVR / live inputs" (`:71`). Feeds `syncComposePreviewClientChannels`
  (`client/lib/app-ws-handlers.js:143`). Tile defs carry only `role:'pgm'|'prv'` + `mainIndex`
  (`client/components/operator-compose-tiles.js:174,213-217`); `resolveTileChannel()` resolves
  strictly PRV→previewChannels else PGM→programChannels (`:301-304`);
  `resolveComposeChannelForCell()` handles only `'pgm'`/`'prv'` (`compose-preview-url.js:108-121`).

So the plumbing to composite live sources into the preview exists — the client just never offers
those channels as cells and has no add/remove affordance (confirmed absent: no source-picker in
`operator-compose-tiles.js`/`preview-canvas-panel.js`; the Sources-drop in compose targets look
layers, not preview tiles — `client/components/scenes-compose.js:83,144-158`).

## Ground truth to read first
- `src/preview/compose-preview-mode.js:70-109` — server channel set (already broad) + resolver.
- `src/api/routes-compose-preview.js:46,63` — API surface of the monitored set.
- `client/lib/compose-preview-url.js:71-121` — the narrow client enumerator + cell resolver (the gap).
- `client/lib/app-ws-handlers.js:143` — where the client channel set is synced.
- `client/components/operator-compose-tiles.js:174,213-217,258-304` — tile def schema, role
  resolution, layout persistence + "re-default wholesale on role-set change" (`:262-278`).
- **Reuse — live-input abstraction:** `src/config/routing-map.js:300-468` (decklink/live_audio/v4l2/
  host channels), `src/config/host-live-sources.js:28-111` (`extraLiveSources`, NDI/webpage/
  browser_display classification, channel dedup), `src/media/caspar-cls-id.js:112-126` (NDI/SRT/
  route/v4l2 detection), `client/components/live-input-modal.js` + `live-input-modal-submit.js`
  (existing "add live input" GUI + `window.__highascgApplyExtraLiveSources`).
- **Closest precedent — the Multiview editor:** cells accept any `route://<ch>` dropped from the
  Sources panel; `getCellOverlayType()` classifies decklink/input cells
  (`client/components/multiview-editor-canvas-layout.js:41-52`), resolutions via
  `resolveMvCellSourceChannel`/`resolveCellSourceResolution` (`multiview-editor.js:11`,
  `multiview-editor-canvas-layout.js:87-107`); server apply `src/engine/multiview-apply.js:146,251`
  (MIXER FILL of route cells). WO-319 §1 explicitly says to copy this pattern.

## Fix direction
1. **Client channel enumerator (small):** extend `compose-preview-url.js:75` to optionally include
   live-input channels — either surface the server's already-broad `resolveMonitoredChannels` set
   (`routes-compose-preview.js:63`) to the client, or mirror `collectComposePreviewChannelsFromMap`
   (`compose-preview-mode.js:83-86`). JPEG consumers already exist for these channels.
2. **Tile schema + layout:** add a third role beyond pgm/prv (e.g. `role:'source'` + explicit
   `channel`) in `operator-compose-tiles.js:174,301-304`; the localStorage layout schema
   (`layoutStorageKey`) and the "re-default wholesale on role-set change" rule (`:262-278`) must
   **preserve user-added source tiles** across screen-count/role changes. WO-319 §1's proposed
   server-owned shared layout (`cells:[{rect01,srcCh,role}]` over API/WS) is the natural home —
   align with it (one shared layout at a time, single-operator, WO-319 §4b).
3. **Client UI:** an add/remove control on the compose canvas + a source picker — reuse the
   `showLiveInputModal` inventory or the Sources-panel `route://<ch>` drag payload like the multiview
   editor; reuse `getCellOverlayType`/input resolution for aspect-fit
   (`operator-compose-tiles.js:106-121`).

## Constraints
- **Hot vs cold:** adding an **already-configured** live input to the preview is hot (just poll its
  existing channel). Registering a **brand-new** live source not yet in config goes through
  `extraLiveSources`/channel-map (`host-live-sources.js`) → **Caspar config rewrite + restart, not
  hot-applyable** — coordinate with the owner (same constraint as WO-319 §Constraints).
- WO-156 self-route guard + WO-271 route-heal apply if any composed cell uses `route://`
  (`scenes-compose.js:96-106`, `multiview-editor.js:84-89`).
- Client changes → **`npm run build:client`** + kiosk reload (server serves `dist-web/`).
- dist-web + backpressure: live-input JPEG polling adds preview load; respect WO-280 activity/
  backpressure and the blocklist path already in place.

## Acceptance
- Operator can add a Decklink and an NDI (and other configured live inputs) as compose-preview tiles
  and remove them; the tiles show live JPEG frames of those sources.
- Added source tiles persist across a screen-count / role-set change (not wiped by the re-default
  rule) and across reconnect.
- No new NVENC/consumer churn for unchanged channels (diff-based sync respected); idle preview
  behaviour unchanged.
- `npm run test:ci` → 0 fail; non-vacuous test for the extended client enumerator (includes
  live-input channels) and the tile-schema `role:'source'` resolution. No new eslint warnings.

## Ambiguities for the owner
1. **Which source kinds in scope?** Decklink + NDI are named; also supported: v4l2/USB, live_audio,
   webpage/browser_display, SRT (`caspar-cls-id.js:112-126`). Expose all input kinds or a subset?
2. **Existing vs new sources:** surface already-configured inputs (hot), provision brand-new ones
   (needs config rewrite + Caspar restart), or both?
3. **Fixed PGM/PRV grid vs freeform:** do live-source tiles join the same freeform canvas as extra
   cells (like the multiview editor) or a separate strip? This decides whether the "re-default
   wholesale on role-set change" behaviour must be reworked.
4. **Scope & cap:** global list vs per-screen; any cap (cf. WO-114 preview-source counts).
5. **Shared vs per-operator layout:** WO-319 §4b chose one shared server-owned layout — does
   add/remove mutate that shared layout (all clients) or a client-local view?

---

## IMPLEMENTATION PLAN (refined 2026-07-22) — owner decision + de-risked

Owner decision (todos22.07.26): "everything in the Live tab of the sources browser should be
draggable onto the compose preview, like the multiviewer layout." Target surface (owner-picked):
the **freeform tiles** surface `client/components/operator-compose-tiles.js` (the multiview-like
compose canvas), NOT the default PRV/PGM canvas.

### KEY DE-RISK — the server already routes arbitrary per-cell sources
`src/system/operator-gui-channel.js` already handles a cell `role:'mvcell'` carrying an explicit
`srcCh` (`resolveCellSourceChannel` → `route://${srcCh}`, PLAY+MIXER FILL per cell in
`_doApplyOperatorGuiLayout`). The multiview editor uses exactly this. So a dropped live-source tile
= a `mvcell` cell with `srcCh = <live source's channel>`, and the server routes it with NO server
change. WO-323 is therefore CLIENT-ONLY, and can be **purely additive** (guard every new branch on
`role === 'mvcell'` / presence of user source tiles → existing PGM/PRV + stream-crop paths byte-
identical when nothing is dropped). It is PREVIEW, not broadcast — low stakes.

### Client integration points (all in operator-compose-tiles.js unless noted)
1. **User-source-tile store** — persist `[{id, srcCh, label, frac}]` in localStorage (new key, e.g.
   `${storageKeyPrefix}_operator_source_tiles`). Separate from the pgm/prv position map so the
   "re-default wholesale on role-set change" rule (`resolveTileLayout`, :269) never wipes them.
2. **`currentDefs()` (:410)** — merge caller `getComposeCellDefs()` with the user source tiles as
   `{ id, role:'mvcell', srcCh, mainIndex:0, label }`.
3. **`resolveTileChannel(d, cm)` (:301)** — add `if (d.role === 'mvcell') return d.srcCh`.
4. **Drop handler on `root`** — dragover/drop parsing the sources-panel payload
   (`application/json` = `{type, value:'route://<ch>', label}` from `sources-panel-helpers.js`
   `makeDraggable` :137-145; handle `{type:'multi', items:[…]}` too). Resolve `srcCh` from
   `route://<ch>` (reuse `resolveMvCellSourceChannel`/parse), add to the store at the drop frac,
   rebuild. Mirror `multiview-editor.js:373-395` (dropHover highlight, WO-156 self-route guard).
5. **Cell-rect reporting (:462-472)** — include `srcCh` for mvcell tiles in the pushed cellRects so
   the server plan routes them (`computeOperatorGuiCellPlan` keys mvcell off `srcCh`).
6. **`seedFromCells` byKey (:531,:546)** — key mvcell cells by `mvcell:${srcCh}` (or tile id), not
   `role:mainIndex`, so crop-source/position seeding works for source tiles.
7. **Aspect** — `resolveTileAspect` for a mvcell uses `channelResolutionsByChannel[srcCh]` (already
   the mvcell path in the multiview editor) so the hole/letterbox matches the source.
8. **Remove control** — a small ✕ on the source-tile footer that drops it from the store + rebuilds
   (footer is real chrome; hole body is click-dead by design).

### Constraints
- Additive/guarded: with no source tiles, behaviour is identical (protects the operator compose +
  the WO-319 stream crops). Existing `smoke-wo256-operator-compose-tiles.test.js` must stay green.
- WO-156 self-route guard + WO-271 route-heal apply (mvcell routing `route://`).
- dist-web: `npm run build:client` + kiosk reload.
- Verify on-box: drop a decklink/NDI from the Live tab onto the compose tiles → a movable tile shows
  it (hole in operator-GUI mode; stream crop in Live-preview mode); remove works; persists across
  reload; PGM/PRV tiles unaffected. Add offline tests for `resolveTileChannel(mvcell)` and the
  drop-payload→srcCh resolution.
