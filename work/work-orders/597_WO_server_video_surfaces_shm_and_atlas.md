# WO-597 — Server: "video surfaces" (shm consumers in config + runtime), descriptor API, atlas allocator

**Area:** engine, godot-client
**Status: DONE pending owner check (2026-10-21) — A (config `videoOutput`), B/C (runtime surfaces, descriptor + lease API), D (atlas: moves cost zero AMCP, box-verified) and T4 (Video output selector in both clients) implemented. Owner check: see the checklist entry "WO-597 atlas". Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: [WO-594](./594_WO_caspar_shm_frame_consumer.md) (consumer exists). Needed by: WO-599 (canvas mode), WO-600 (atlas mode), WO-607 (previs sources).**

The native client draws Caspar channels from shared memory (WO-594/596). The server must (a) put
an `shm` consumer on the operator-GUI channel instead of the `<screen>` consumer, (b) add/remove
shm consumers on other channels on demand (previs), (c) tell the client where the frames are, and
(d) later, lay the preview tiles out as a fixed **atlas** the client samples, instead of following
monitor rects.

## Investigation

### Today's operator-GUI channel (config) — `src/config/config-generator-operator-gui.js`

- `buildOperatorGuiChannel()` (`:65-135`) emits ch5 with a `<screen>` consumer:
  `<windowed>true`, `<vsync>true`, `<always-on-top>false` (`:94`, WO-263: it must stack **below**
  Firefox), `<borderless>true`, `<gpu-texture>true` (`:99`, WO-502), position from
  `resolveLayoutRectForOperatorPort` (`:70`), size = destination dims (`:85`).
- Headless branch (`:109-120`, WO-325): channel with **empty `<consumers>`**, kept for the route
  layers 10-49 and the runtime NVENC gui-stream (WO-319). → precedent: the channel is useful
  without a screen consumer.
- Config keys: dest `mode:'operator_gui'`, `physicalPort` 1-4, `headless`, `autoLaunch`,
  `label`; dims from the destination (`getModeDimensions('custom')`, `config-modes.js:170-196`);
  factory seed `src/config/factory-starter.js:25-30`. (Inventory F §3.)

### Today's layout path — rects in, MIXER FILL out

- Client reports preview cell rects as **0–1 fractions of the viewport**:
  `client/lib/operator-gui-mode-report.js` (445 LOC, `LAYOUT_ENDPOINT = '/api/operator-gui/layout'`,
  `:13`), rect math `client/lib/operator-gui-mode-rects.js` (69 LOC).
- Server: `POST /api/operator-gui/layout` (`src/api/router.js:258` → `routes-operator-gui.js:34`)
  → `applyOperatorGuiLayout()` (`src/system/operator-gui-channel.js:315`), debounced
  (`APPLY_DEBOUNCE_MS = 50`), serialized per channel, `computeOperatorGuiCellPlan()`
  (`operator-gui-channel-geometry.js:255`) → one `route://` PLAY per cell on layers 10-49 +
  aspect-fit `MIXER FILL` (`computeAspectFitCellRect`, `:221`; `fitAspectRectPx`, `:184`) + one
  `MIXER COMMIT`; also feeds the shape helper. Persisted per project
  (`scheduleComposeLayoutProjectPersist`, `:267`); boot-shrink guard (`shouldIgnoreBootShrink`, `:137`).
- WO-592 media preview cell rides the same channel (`operator-gui-media-layer.js`, 81 LOC;
  `POST /api/media/preview`, `router.js:326`).
- `GET /api/operator-gui/layout` is also read by the **remote** operator view (stays).
- Remote transport: `/ws/gui-stream` (WO-319, `src/preview/gui-stream-ws-relay.js`): ch5 NVENC
  H.264 AUs over a binary WS (`u32 seq | u8 flags | …`). Untouched by this WO.

### What changes when the client draws video itself

| Mode | Channel geometry | Who decides tile positions | AMCP on UI move/resize |
|------|-----------------|----------------------------|------------------------|
| today (kiosk) | = operator monitor | client rects → server MIXER FILL | **yes** (debounced 50 ms) |
| **canvas** (WO-599, step 1) | = operator monitor (unchanged) | same as today | yes — zero server logic change |
| **atlas** (WO-600, step 2) | free (e.g. 1920×1080 or 3840×2160) | **server allocates slots**, client places tiles | **no** — only when the *set* of sources or a needed resolution changes |

## Design

### A. Config: `operator_gui` destination gets `output: 'screen' | 'shm'`

- New dest key `videoOutput` (default `'screen'` until WO-609 cutover, then `'shm'`).
- `'shm'` → `<consumers><shm><name>opgui</name></shm></consumers>` (no `<screen>`); headless
  branch unchanged. The `<screen>` branch stays as the rollback path until WO-609 deletes it.
- Pure generator change; existing smokes pinning `:94`/`:99` lines must be **repointed, not
  weakened** (CLAUDE.md smoke rule).

### B. Runtime shm consumers for other channels (previs) — `src/system/video-surfaces.js` (new)

- `acquireSurface(ctx, role)` / `releaseSurface(ctx, role)`, refcounted per role (`pgm1`, `prv1`,
  `pgm2`, …), resolving the channel via `getChannelMap()` (`src/config/routing`).
- AMCP `ADD <ch>-<idx> SHM NAME <role>` with reserved indices **740–749** (WO-594 §7);
  `REMOVE <ch>-<idx>` when the refcount drops to 0 **after a 10 s grace** (avoid add/remove churn
  on on-air channels while the operator toggles views).
- Re-ADD on Caspar reconnect (same pattern as `ensureOperatorGuiChannel`, `operator-gui-channel.js:391`).
- Leases are tied to the client WS connection: a client that disconnects releases its leases
  (crash safety — no orphaned consumer on PGM).

### C. Descriptor API

```
GET  /api/video-surfaces            → { surfaces: [{ role, channel, shm: "/highascg-opgui",
                                         width, height, fps, live: bool, refs }] }
POST /api/video-surfaces/acquire    { role }  → descriptor (adds consumer if needed)
POST /api/video-surfaces/release    { role }
WS   'video_surfaces'               broadcast on any change (consumer added/removed, Caspar restart)
```
The client never guesses segment names; it maps whatever the server announces.

### D. Atlas allocator (step 2) — replaces `computeOperatorGuiCellPlan` for shm clients

- Input: the set of preview **sources** the UI currently shows (compose cells, timeline, mv-edit,
  media preview) with each tile's *largest on-screen size* (the client reports "max px I will
  draw this at"), **not** positions.
- Output: `{ atlas: { channel, w, h }, slots: [{ id, source, x, y, w, h }] }` — shelf-packed,
  aspect-correct slots on the operator channel; each slot = one route layer + MIXER FILL in atlas
  pixels (reuses the PLAY-only-on-change / MIXER COMMIT / stale-layer hygiene of
  `_doApplyOperatorGuiLayout`, `:160`).
- Re-allocation only when sources are added/removed or a tile's needed size crosses its slot size
  by > 25 % (hysteresis). Broadcast `operator_gui_atlas` over WS.
- API: `POST /api/operator-gui/atlas/demand { tiles: [{ source, maxW, maxH }] }`,
  `GET /api/operator-gui/atlas`.
- Remote browser view keeps working off the same channel (it just sees an atlas instead of a
  monitor-shaped mosaic) — the web client's remote view must learn to read slots (small change,
  or keep canvas mode for the web client; decided in WO-608).

## Tasks

- [x] T1 — `videoOutput` dest key + generator branch + normalization in `screen-destinations.js`;
      smoke: shm XML emitted, screen XML unchanged when `'screen'`.
- [x] T2 — `src/system/video-surfaces.js` + routes + WS broadcast + lease-per-WS-connection; smoke
      with fake AMCP (indices 740–749, grace timer, reconnect re-ADD).
- [x] T3 — Atlas allocator (pure, offline-testable: packing, hysteresis, aspect) + apply path +
      API; smoke covers "UI move/resize ⇒ zero AMCP".
- [x] T4 — Device View (operator_gui destination inspector): `Video output: Screen | Shared memory`
      selector (web client; minimalism — one select).
- [x] T5 — Docs: `docs/wiki/api/` entries for the new routes (WO-593 contract doc).

## Acceptance

- `videoOutput:'shm'` → generated `casparcg.config` has `<shm>` on ch5, Caspar boots, segment present.
- Previs open → `ADD 1-741 SHM` appears once; closing for > 10 s → `REMOVE`; WS drop → released.
- Atlas mode: dragging/resizing tiles in the Godot client produces **zero** AMCP lines in the
  journal; adding a source produces exactly one re-allocation.

## What was done (2026-10-17)

**Design change vs §B/§C above:** leases are **declarative HTTP** instead of WS-connection-bound — the
client POSTs the full set of roles it draws every ~5 s, TTL 15 s. Same crash safety, and
`src/server/ws-server.js` (exactly 500 lines) did not have to be touched.

| File | Change |
|------|--------|
| `src/config/screen-destinations.js` | operator_gui `videoOutput: 'screen'|'shm'` (default `'screen'`) + validated `shmName` (default `opgui`) |
| `src/config/config-generator-operator-gui.js` | `videoOutput:'shm'` → `<shm><name>…</name></shm>` instead of `<screen>` (raster + audio-osc kept) |
| `src/system/operator-gui-launcher.js` | no Firefox kiosk auto-launch for an shm surface (`native_client_shm`) |
| `src/system/video-surfaces.js` (new, 169 LOC) | manager: roles `pgm1..4`/`prv1..4` → channels via channelMap (PRV==PGM refused), indices **741–748** (740 operator config, 749 diagnostics), lease/sweep/TTL, `onCasparReady()` re-ADD, `list()` descriptors incl. the configured operator surface |
| `src/api/routes-video-surfaces.js` (new) + `src/api/router.js` | `GET /api/video-surfaces`, `POST /api/video-surfaces/lease {clientId, roles}` |
| `src/config/routing-setup.js` | re-ADD leased runtime surfaces on every Caspar (re)connect |
| `godot/client/video/video_surfaces.gd` | lease loop (5 s), descriptor paths on Linux |
| `tools/smoke/smoke-wo597-operator-gui-shm-output.test.js` (5) + `smoke-wo597-video-surfaces.test.js` (8) | added to the curated list |

⚠️ Do not set `videoOutput:'shm'` on the box until the Caspar build has the shm module (WO-594/613):
an older Caspar does not know `<shm>` in the config. Runtime ADDs just fail and are logged.

## What was VERIFIED

- New smokes 5/5 + 8/8; WO-325 smoke unchanged 5/5; `node index.js --no-http` boot check OK.
- **Full offline suite: 2588 tests, my changes add 5 and break none** — compared against a clean
  `origin/main` worktree run the same way: identical failure set (13 env-only failures on the Mac: Linux
  paths, systemd-run, ffmpeg HAP) + 3 `smoke-api-auth` failures caused by this Mac's local
  `.private/api-token` (pass 10/10 with the file moved aside; CI has no such file).
- Simulator (scratchpad copy): `GET /api/video-surfaces` lists 8 runtime roles; `POST …/lease` → `leases: 1`;
  missing `clientId` → 400. A raw-body parsing bug was caught here and fixed (`parseBody`), now pinned by a test.
- Godot client leases against the simulator (`video_lease_ok: true`, 8 surfaces announced).
- Not verified: real AMCP ADD/REMOVE of `SHM` (needs the WO-594 Caspar build), atlas (§D).


## What was VERIFIED

Code reading only (refs above, cross-checked with inventory F [`work/godot-port/inventory/runtime-kiosk-tests.md`](../godot-port/inventory/runtime-kiosk-tests.md)).

## Box finding (2026-10-17) — operator shm could not be switched on

`POST /api/device-view {updateDestination:{videoOutput:'shm'}}` answered `ok:true` but kept `screen`:
`src/api/device-view-crud.js` operator_gui merge only carried guiUrl/physicalPort/autoLaunch/headless.
Fixed (`110c05d`, same present-key-wins rule; smoke `smoke-wo243-operator-gui-crud-ui` 16/16). Verified
live: stored `shm`, `/api/caspar-config/apply` generated `<shm><name>opgui</name></shm>`, Godot showed
the channel and reattached after a Caspar RESTART. The shop dev box now runs the operator GUI in shm mode
(switch back: same API with `videoOutput:'screen'` + apply).

## Requirement from WO-601 (2026-10-18) — Godot media-inspector preview
The web previews a library file by LOADing it on the GUI channel's MEDIA_PREVIEW_LAYER and reporting a hole rect.
A Godot client cannot do the same today: `POST /api/operator-gui/layout` replaces the whole cell layout (last writer
wins, `src/api/routes-operator-gui.js:34-52`), so its media cell would wipe the kiosk's cells. §D should therefore
either keep per-client cell sets merged server-side, or give the media preview its own atlas slot the client crops
from its `opgui` surface (WO-601 addendum 8).
**Resolved without §D (2026-10-18, owner):** only one local operator client ever runs (Godot replaces the kiosk; the remote
browser has thumbnails only and reports no cells), so Godot re-sends the compose cells + its media cell — see WO-601
"What was done". §D stays open on its own merits (no AMCP on UI moves), not as a blocker for the media preview.

## What was done (2026-10-21) — §D atlas + T4 + T5

**Design change vs §D above:** no separate `/atlas/demand` route. The client keeps reporting its cells to
`POST /api/operator-gui/layout` and adds `atlas: true`; the server derives each tile's needed pixels from the
cell's aspect-fitted rect. One route, one persistence record, and the WO-624 server-side cell edits and the boot
re-apply keep working unchanged (they omit the key, so the remembered mode applies). The descriptor rides the
existing answers instead of a new `operator_gui_atlas` message: the POST reply, `GET /api/operator-gui/layout`
and the `operatorGuiLayout` broadcast all carry `atlas: {channel, w, h, slots: {cellId: {x,y,w,h}}} | null`.

| File | Change |
|------|--------|
| `src/system/operator-gui-atlas.js` (new) | mode (shm surfaces only; `atlas` key from the report, else remembered, persisted as `operatorGuiAtlas`), shelf packing (4 px gutter, tallest first, uniform 0.9 down-scale until it fits), 25 % hysteresis on each tile's needed size, plan-key skip |
| `src/system/operator-gui-channel.js` | `_doApplyOperatorGuiLayout` plans from the rewritten cells; an unchanged atlas plan returns before any AMCP; no shape-overlay holes in atlas mode; persist/broadcast moved to `finishOperatorGuiApply` (persists the REPORTED cells, never the slots); `ensureOperatorGuiChannel` forgets the applied plan on (re)connect |
| `src/system/operator-gui-compose-persist.js` (new) | `scheduleComposeLayoutProjectPersist` moved out unchanged (line budget) |
| `src/api/routes-operator-gui.js` | POST passes `atlas` when it is a boolean; GET returns `atlas` |
| `godot/client/features/live/compose_tiles.gd` + `compose_tile_math.gd` | reports carry `atlas: true` (and one opt-in report per run when the GET shows no atlas); a premultiplied `AtlasTexture` crop per window at its picture rect; `atlas_changed` signal |
| `godot/client/features/live/live_tab.gd` | hides the whole-surface picture while the windows crop |
| web `operator-compose-tiles*.js`, `app-ws-handlers.js` | the remote view's crop source is the window's slot when an atlas is announced (positions still come from the reported rects) |
| T4: `device-view-destinations-inspector-operator-gui-fields.js`, Godot `destination_inspector.gd` | `Video output: Screen | Shared memory` select → `{videoOutput}` patch (golden extended by hand: one field + one action) |
| T5 | no new routes, so the generated contract (`docs/wiki/api/contract/`) is unchanged and `--check` passes |
| Tests | `smoke-wo597-operator-gui-atlas.test.js` (7: packing, scaling, move ⇒ zero AMCP, > 25 % resize ⇒ FILL only, add source ⇒ one apply, mode memory, screen surface never atlas, atlas off ⇒ mosaic, web wiring); shm-output smoke +1 (T4 web); Godot `test_atlas_slots` + destination-form golden |

## What was VERIFIED (2026-10-21)

- Offline suite 3006 pass / 0 fail / 2 skipped; Godot tests 20419 pass; eslint 216 warnings; prettier, line
  limit, unwired exports, API contract `--check`, `node index.js --no-http` and `build:client` all clean.
- **Box (shm operator surface, ch 3), Caspar log counted:** the first atlas report gave 5 AMCP lines (4 FILL + COMMIT,
  no PLAY: the routes were already live); a report with two windows moved gave **0**; a report without the
  `atlas` key gave **0** (mode remembered); a **real drag of the DeckLink window in the Godot GUI gave 0** and the
  picture followed the window. `MIXER 3-1x FILL` queries returned exactly the slot rects.
- A dump of the shm frame shows the four routes packed top-left; the Godot crops match the mosaic-mode picture
  pixel for pixel (the PGM/PRV inset framing seen in both is the looks' own layer transform, not the atlas).
- Restored afterwards: the original cells (diffed equal), Live view back to 3D (`ui.cfg` diffed equal). **The box
  stays in atlas mode** (`operatorGuiAtlas: true`); switch back with `POST /api/operator-gui/layout
  {cells, atlas:false}`.

### Open

- Owner check (checklist): drag/resize windows in the Godot Live view and compare with the web remote view.
- Packing is simple shelves; a tight canvas scales every tile down uniformly (no per-tile priority yet).
- Not verified: the web remote view against an atlas (no remote browser was open during the test).

