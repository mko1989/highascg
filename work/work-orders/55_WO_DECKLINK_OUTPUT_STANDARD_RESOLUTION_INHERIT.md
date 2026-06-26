# Work Order 55: DeckLink SDI output — inherit channel resolution, standard modes only

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do NOT delete previous agents' log entries

**Parent / context:** [WO-33 Device View index](./33_WO_DEVICE_VIEW_INDEX.md); [WO-28 DeckLink I/O routing](./28_WO_DECKLINK_INPUT_OUTPUT_ROUTING.md); [WO-40a Pixel map → GPU / DeckLink alignment](./40a_WO_PIXEL_MAP_GPU_XRANDR_CASPAR_ALIGNMENT.md); GPU source inherit pattern in `client/lib/device-view-gpu-source-inherit.js`  
**Status:** 🔴 **OPEN / UNRESOLVED** (custom PGM ch1 → DeckLink SDI still broken on hardware as of 2026-06-26). See [WO-56 open tracker](./56_WO_DECKLINK_SDI_PGM_CUSTOM_OPEN.md). Pass 1 shipped resolver/UI; pass 2 added explicit SDI format + 1:1 subregion — **not verified fixed**.  
**Prerequisites:** 33a (device graph + edges), 33c (rear panel + inspector), config generator DeckLink consumers (`config-generator-consumer-attach.js`)

---

## 1. Problem (operator scenario)

Operator cables **Multiview** (or PGM/PRV destination) at **2160p50** to a **DeckLink SDI output** jack. The MVR channel is correctly sized for that signal. DeckLink hardware and Caspar's `<decklink>` consumer only support **standard Caspar video-mode IDs** (e.g. `2160p5000`) — not arbitrary custom canvas sizes (e.g. `16384×2160` from pixel-map staging, or destination `videoMode: custom`).

Today:

- DeckLink **output** jacks may imply or expose mode-like controls that do not apply (outputs should not be a second “video mode” master).
- Custom upstream resolutions can reach generated `casparcg.config` without a clear **operator-facing complaint**.
- Device View does not **inherit** the cabled channel's effective mode for DeckLink XML the way GPU heads inherit from destinations (`device-view-gpu-source-inherit.js`).

**Expected:** Cabling MVR @ `2160p5000` → DeckLink SDI outputs **2160p50**. Cabling a feed with **custom** WxH → **red glow** on the SDI jack, inspector warning, and validation on apply/save — not a silent broken output.

---

## 2. Goal

1. **No mode picker** on DeckLink **output** connectors in Device View (`decklink_out` / `decklink_io` when `ioDirection: out`). Outputs do not choose resolution independently.
2. **Inherit** effective video mode from the **upstream Caspar channel** reached by following the cable graph (destination → mapping → host channel, multiview bus, etc.).
3. **Validate** inherited resolution: if upstream is **custom** (not a key in `STANDARD_VIDEO_MODES`) or cannot be mapped to a supported DeckLink standard mode, surface **errors/warnings**.
4. **UI feedback:**
   - **Red glow** around the SDI jack on the Caspar rear panel when invalid.
   - Inspector **note** (read-only): “SDI outputs only support standard Caspar video modes (e.g. 1080p50, 2160p50). Change the upstream channel/destination mode or use GPU/screen for non-standard sizes.”
   - Show **inherited** mode label when valid (e.g. `2160p5000 (3840×2160 @ 50 Hz)`).
5. **Config generation:** `<decklink><video-mode>` (and tiled `<port><video-mode>`) derived from **inherited standard mode**, not from unrelated `screen_N_custom_*` unless that screen is the resolved upstream and mode is standard.

---

## 3. Scope

### In scope

- Cable-graph resolver: `decklink_out` / outbound `decklink_io` → upstream `destination_in`, `pixel_map_in`, `caspar_mv_out`, or host channel binding (`outputBinding`).
- Shared server helper (mirror GPU inherit): e.g. `resolveDecklinkOutputSourceResolution(graph, connectorId, settings)` → `{ videoMode, width, height, fps, standardModeId, isCustom, decklinkVideoMode }`.
- Extend `build-caspar-generator-config.js` / `config-generator-consumer-attach.js` to set DeckLink consumer `video-mode` from resolver when graph edge exists.
- Extend `decklink-config-validate.js` (or successor) with **custom / non-standard upstream** warnings on settings save and caspar-config apply preview.
- Device View live snapshot: per-connector `decklinkOutputStatus: { ok, inheritedMode, reason }` for rear panel + inspector.
- Client: remove/hide mode dropdowns on DeckLink **output** inspector; add read-only inherited row + warning copy; add CSS class e.g. `device-view__panel-marker--decklink-error` + red `panel-status-glow` when `!ok`.
- Unit/smoke tests for resolver + generator XML snippet (`2160p5000` on MVR → DeckLink path; custom 8192×1080 → warning).

### Out of scope

- DeckLink **input** slot device index UI (WO-28 / WO-53).
- New non-standard DeckLink modes or Caspar fork changes.
- Automatic rescaling / FILL on DeckLink to “fix” custom upstream (same rejection as WO-40).
- PixelHue / PH timing apply.

---

## 4. Normative behaviour

### 4.1 Inheritance rules

| Upstream feed | Resolved channel mode | DeckLink `video-mode` | UI |
|---------------|----------------------|------------------------|-----|
| Destination `2160p5000` on PGM ch 1 | `2160p5000` | `2160p5000` | Green/normal jack |
| Multiview destination `2160p5000`, cabled to SDI | `multiview_mode` / MVR ch | `2160p5000` | Green/normal jack |
| Destination `custom` 16384×2160 @ 50 | custom | **invalid** | Red glow + inspector warning |
| Custom canvas with **exact** standard match (e.g. 3840×2160@50 → `2160p5000`) | mappable | `2160p5000` | OK with note “mapped from custom WxH” (optional) |
| No cable / unresolved graph | — | use legacy `screen_N` / `multiview_decklink_device` keys | Warn “no upstream cable” |

- [x] **T55.1** Resolver walks edges **backward** from DeckLink connector to first resolvable `sources[]` / `screenDestinations` / `destinationIntent` entry (reuse patterns from `device-view-gpu-source-inherit.js`).
- [x] **T55.2** `isCustom` = `videoMode === 'custom'` OR `(width,height,fps)` not matching any `STANDARD_VIDEO_MODES` entry within tolerance.
- [x] **T55.3** `decklinkVideoMode` = standard preset id used in XML; null when invalid.

### 4.2 Inspector (output jacks only)

- [x] **T55.4** `decklink_out` inspector: **no** video-mode `<select>`, no custom WxH fields.
- [x] **T55.5** Read-only row: **Inherited from:** `<label>` — `<mode>` (`WxH @ fps`).
- [x] **T55.6** When invalid: prominent warning paragraph (SDI standard modes only); link to docs/wiki if available.
- [ ] **T55.7** `decklink_io` **input** path unchanged (WO-28 input controls).

### 4.3 Rear panel visual

- [x] **T55.8** When `decklinkOutputStatus.ok === false`, add class on marker (e.g. `--decklink-invalid`) and enable **red** `device-view__panel-status-glow` (existing glow div in `device-view-caspar-render-markers.js`).
- [x] **T55.9** Tooltip / `title` on jack: short reason (`Custom upstream resolution`, `No cable`, etc.).

### 4.4 Config + API

- [x] **T55.10** Generator: for each DeckLink output bound in graph, set `<video-mode>` from `decklinkVideoMode`; do not emit DeckLink consumer if invalid and graph says output-only (product choice: **warn + omit consumer** vs **fallback** — prefer **warn, omit or keep last valid**; document in Work Log).
- [x] **T55.11** `POST /api/settings` and caspar-config apply response include `warnings[]` entries: `decklink_output_custom_resolution:<connectorId>`.
- [x] **T55.12** `GET /api/device-view` live snapshot exposes `live.decklink.outputs[]` with `{ connectorId, deviceIndex, inherited, ok, reason }`.

### 4.5 Tests

- [x] **T55.13** Smoke: MVR `2160p5000` + edge to `decklink_out` → generated XML contains `<video-mode>2160p5000</video-mode>`.
- [x] **T55.14** Smoke: destination custom 8192×1080 → validator warning; resolver `ok: false`.
- [ ] **T55.15** Client unit (if feasible): marker class when snapshot reports invalid.

---

## 5. Code map (starting points)

| Area | File |
|------|------|
| GPU inherit (pattern) | `client/lib/device-view-gpu-source-inherit.js` |
| DeckLink inspector | `client/components/device-view-inspector-decklink.js` |
| Rear markers / glow | `client/components/device-view-caspar-render-markers.js` |
| Graph → Caspar merge | `src/config/build-caspar-generator-config.js` |
| DeckLink XML | `src/config/config-generator-consumer-attach.js` (`buildDecklinkTiledConsumersXml`, multiview decklink) |
| Standard modes | `src/config/config-modes.js` (`STANDARD_VIDEO_MODES`) |
| Validation | `src/config/decklink-config-validate.js` |
| Device view apply | `src/api/device-view-apply.js` |
| Live snapshot | `src/api/device-view-snapshot.js` |
| Destination custom modes | `client/components/device-view-destinations-inspector.js` |

---

## 6. Acceptance criteria

1. Operator cables **Multiview @ 2160p50** to DeckLink SDI → apply config → Caspar `<decklink>` uses `2160p5000`; jack shows inherited mode, no red glow.
2. Operator sets upstream destination to **custom** non-standard size cabled to DeckLink → **red glow** on jack, inspector explains SDI standard-only constraint, apply/save returns warning.
3. DeckLink **output** inspector has **no** mode picker; input inspector unchanged.
4. Behaviour documented in `docs/reference/` or wiki (short operator note).

---

## 7. Risks / notes

- **Tiled DeckLink** (`screen_N_decklink_tiles`): each tile port may need per-tile standard mode or shared parent `video-mode` — align with existing `buildDecklinkTiledConsumersXml` comment (“Caspar cannot use channel custom mode for DeckLink format”).
- **Multiple edges** to one DeckLink: resolver should warn on conflict (same as WO-40 T40.2).
- **INFO CONFIG vs plan:** optional follow-up to compare live Caspar mode with inherited plan after restart.

---

## 8. Work Log

### 2026-06-24 — Agent (WO creation from operator report)

**Work Done:**
- Created WO-55 from production issue: MVR @ 2160p50 to DeckLink SDI; custom pixel-map / destination sizes must not silently reach DeckLink outputs.
- Specified inherit-from-cable-channel model (parallel to GPU WO-40 / `device-view-gpu-source-inherit.js`).
- Defined UI: no output mode picker, red SDI jack glow, inspector standard-resolution note.
- Listed generator, validation, snapshot, and test tasks.

**Status:** Draft work order only — **no implementation** in this session.

**Instructions for Next Agent:** Start with **T55.1–T55.3** (server resolver + unit tests), then **T55.10** (generator wiring). UI (T55.4–T55.9) can follow once snapshot shape is stable.

### 2026-06-24 — Agent (WO-55 pass 1 implementation)

**Work Done:**
- Added `src/config/decklink-output-resolve.js`: cable-graph backward walk, standard mode matching, per-connector status, target video-mode for generator.
- Generator: `buildDecklinkKeyFillConsumersXml` now accepts `<video-mode>`; screen + multiview DeckLink consumers use inherited standard id.
- Validation: `validateDecklinkOutputResolution` wired into `POST /api/settings` warnings.
- Snapshot: `live.decklink.outputs[]` in `device-view-snapshot.js`.
- Client: `decklink_out` / output `decklink_io` inspector shows inherited mode + warning (no mode picker); rear panel red glow (`device-view__port--err`) + tooltip reason.
- `applyDecklinkOverridesToScreens` handles `decklink_out` connectors.
- Smoke: `tools/smoke/smoke-decklink-output-resolve.js` (6 tests, all pass).

**T55.10 product choice:** Invalid upstream → **warn** on save/settings + red UI; generator still emits DeckLink consumer **without** `<video-mode>` when unresolved (Caspar falls back to channel mode). Multiview `decklink_only` profile already blocks custom channel modes. Consider omitting consumer entirely on invalid graph in pass 2.

**Remaining:**
- T55.7 verify input path unchanged (smoke/manual).
- T55.15 client unit test for marker class.
- Short operator doc in `docs/reference/`.
- Rebuild `dist-web/` (`npm run build:client`) and restart highascg when operator is ready.
- Caspar-config apply preview warnings (if separate from settings POST).

**Instructions for Next Agent:** Run `npm run build:client`, verify Device View with MVR@2160p50→DeckLink (green jack, inherited label) and custom destination→DeckLink (red glow). Add apply-preview warnings in `routes-caspar-config.js` if missing. Optional: omit DeckLink XML when `!ok`.

### 2026-06-24 — Agent (WO-55 pass 1b: channel video-mode fix)

**Work Done:**
- Root cause: channel `<video-mode>` stayed `1080p5000` (default `multiview_mode`) while DeckLink consumer got inherited `2160p5000` → Caspar error "Decklink does not support the channel format".
- `applyMultiviewDestinationOverrides`: sync `multiview_mode` from multiview destination panel (`2160p5000` etc.).
- `channelVideoModeForDecklinkConsumer`: when DeckLink-only (no screen consumer), channel `<video-mode>` matches inherited DeckLink standard mode.
- Same alignment for PGM screen when `decklink_replace_screen`.
- Note: Caspar log `[3-2|2160p5000]` is channel 3 + device 2 notation, not key/fill.

**Instructions for Next Agent:** Re-apply Caspar config after pull; confirm MVR ch 3 channel + decklink both `2160p5000`.

### 2026-06-26 — Agent (pass 2: SDI inspector + 1:1 subregion — UNRESOLVED)

**Work Done:**
- SDI inspector: `embedded-audio`, `channel-layout`, `latency`, `buffer-depth`, `color-space`, required SDI format (removed auto/nearest).
- Generator: `buildDecklinkPassthroughSubregion`, `<subregion>` on simple DeckLink consumers; no scaling intent.
- `reconcileDecklinkScreenConsumerFlags`: GPU + DeckLink coexist when screen consumer cabled.
- Smoke: `smoke-decklink-output-resolve.js` updated (12 tests pass).

**Status:** 🔴 **NOT RESOLVED** — operator confirms PGM ch1 → DeckLink still blocked/broken. Parked; track in [WO-56](./56_WO_DECKLINK_SDI_PGM_CUSTOM_OPEN.md).

**Instructions for Next Agent:** Do not mark fixed without hardware repro (WO-56 T56.1–T56.7). Next step: capture live `casparcg.config` + Caspar log for ch1 PGM with custom canvas + DeckLink cable.
