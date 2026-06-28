# Work Order 72: Companion compose preview — label polish, seam-safe quadrant badges, config gates, custom mosaics

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** In progress — Phases A, B, C, E implemented (2026-06-28); Phase D deferred  
**Priority:** Medium (Stream Deck polish + operator control over bandwidth)  
**Primary repo:** `companion-module-dev/companion-module-highpass-highascg/`  
**Related server WOs:** [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md), [63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md](./63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md), [71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md](./71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md)

**Out of scope:** Changing Caspar consumer fps/scale (WO-58 done); replacing look take actions; HighAsCG web UI compose panel layout.

---

## 1. Problem statement

Compose preview on Stream Deck is **working at ~25 fps** after WO-58 follow-on fixes (letterboxed thumb filter, live `highascg_compose_preview_chN_image` variables). Operators now want **visual polish** and **connection-level control** — not more pipeline work.

### 1.1 Look recall button labels (on air)

| Today | Desired |
|-------|---------|
| On-air look name sits on a **semi-transparent black bar** (`label_air_bg` box layer) | **No background box** |
| Label uses default outline | **White text, black letter border** (Companion `outlineColor` / outline width — match idle label treatment) |

Files: `src/look-air-overrides.js`, `src/look-button-style.js`, `scripts/patch-look-label-air-layer.py`, layered preset `look-preview-linked-presets.js`.

### 1.2 Quadrant compose preview buttons

| Today | Desired |
|-------|---------|
| Quadrant cells show coloured **edge bars** only (`quadrant-edge-borders.js`) | Keep edge colour cue **plus** readable badges |
| No bus/screen legend | **PGM** or **PRV** in the **bottom-left** of the 2×2 mosaic; **SCR 1** / **SCR 3** (screen index + 1) in the **bottom-right** |
| N/A | Text must **not straddle the seam** between adjacent buttons — each label lives entirely inside one quadrant cell |

**Seam-safe layout (2×2 per channel):**

```text
┌─────────────┬─────────────┐
│  TL preview │  TR preview │
│             │             │
├─────────────┼─────────────┤
│ PRV         │      SCR 1  │  ← BL cell: bus label bottom-left
│  BL preview │  BR preview │  ← BR cell: screen label bottom-right
└─────────────┴─────────────┘
```

- **TL / TR:** preview image only (no bottom legend).
- **BL:** text layer `bus_badge` — bottom-left, e.g. `PRV` (green outline) or `PGM` (red outline).
- **BR:** text layer `screen_badge` — bottom-right, e.g. `SCR 1` (neutral white + black outline).

Use `resolveChannelBusStyle()` + screen index from `channelMap.programChannels` / `previewChannels` index.

### 1.3 Module configuration gaps

| Request | Rationale |
|---------|-----------|
| **Option: compose preview on buttons** | Some sites want actions/variables only — live JPEG base64 over WebSocket is **~0.5–1.5 Mbps** per active channel; operators may disable preview traffic on remote Companion hosts |
| **Custom button layouts / mosaic definitions** | e.g. **PGM SCR 1** spanning **5×4** Stream Deck keys (one logical surface split across many buttons) — not limited to 1 key = 1 quadrant |

### 1.4 Sloppy placeholder channels

The module currently hard-codes **`PREVIEW_CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8]`** and registers presets + variable definitions for **all eight**, even when `channelMap` only maps **PGM 1 / PRV 2 / PGM 3** (two screens). That produces **empty or misleading presets** — not acceptable for a connection module.

**Required:** Derive the channel list from **`instance._channelMap`** (same semantics as HighAsCG `resolveMonitoredChannels` / compose-visible channels). No presets, variables, or poller fetches for **non-existent** Caspar outputs.

---

## 2. Goals (normative)

### G1 — Look label on-air styling

1. Remove **`label_air_bg`** from default on-air overrides (opacity 0 or delete layer from presets + patch script).
2. On-air label: **white** (`color`), **black** `outlineColor`, sufficient `outline` width for Stream Deck legibility.
3. Idle label unchanged (centered, same outline treatment).
4. Update **`patch-look-label-air-layer.py`** so existing bank buttons migrate without manual re-drag.

### G2 — Quadrant badges (seam-safe)

1. Extend **`addComposePreviewPresets`** quadrant presets with two optional text layers per cell (see §1.2).
2. Font size small enough for 72×72-equivalent cell (test on Stream Deck XL + Mini).
3. Badge text is **static per preset** (channel + screen index baked at preset generation time when `channelMap` syncs).
4. Re-run preset refresh when **`channelMap`** changes (`instance.updatePresets()` already triggered from `state-sync.js`).

### G3 — Connection config: compose preview traffic gate

Add to **`config-fields.js`** (Companion module instance settings):

| Field | Type | Default | Behavior when off |
|-------|------|---------|-------------------|
| `compose_preview_buttons_enabled` | checkbox | `true` | Do not register compose preview **presets** sections; do not subscribe/apply `compose_preview_*` variable updates in `state-sync` / `PreviewVariableGate`; optional: skip HTTP poller entirely |
| `compose_preview_max_fps` | number (optional v1.1) | inherit server | Cap how often Companion applies preview variable updates (future — document only if not in v1) |

**HighAsCG server** may continue generating JPEGs when `companionThumbEnabled` is on — this gate is **Companion-side** bandwidth control. Document in `companion/HELP.md`.

When disabled, **look recall** buttons should still show **text labels** and PGM/PRV borders; preview layers stay hidden (no image traffic).

### G4 — Custom mosaic layouts (v1 design + v2 implementation)

**v1 (this WO — design + minimal MVP if time):**

1. Config UI: **JSON or structured list** of layout definitions (stored in module config, exportable with Companion backup).
2. Each layout:

```javascript
{
  id: 'pgm_scr1_wall',
  label: 'PGM Screen 1 — 5×4',
  channel: 1,           // Caspar channel (from channelMap)
  bus: 'pgm',           // 'pgm' | 'prv' | 'full'
  screenIndex: 0,
  grid: { cols: 5, rows: 4 },
  // Each cell: which slice of the 144×144 (or full) thumb to show
  cells: [
    { col: 0, row: 0, quad: 'tl' },  // or { srcRect: { x, y, w, h } } in 0..1 normalized coords
    // ...
  ]
}
```

3. Preset generator emits **one layered preset per cell** with crop metadata (may require **normalized crop** in image layer if Companion supports it — else continue using server-side quadrant vars or add **`compose_preview_chN_tile_{row}_{col}`** variables on HighAsCG — see §4.2).

**v2 (follow-on if MVP too large):** Visual layout editor in Companion config; span presets that Companion 3.4+ multi-button graphics support.

**Acceptance for v1 MVP:** Operator can define **one** 5×4 PGM screen 1 wall via config JSON; dragging 20 presets places correct slices without seam labels duplicated.

### G5 — Channel list hygiene

1. Replace hard-coded **`PREVIEW_CHANNELS`** with **`resolveComposePreviewChannels(instance)`**:
   - Union of `channelMap.programChannels` and `channelMap.previewChannels` (numeric, &gt; 0, deduped, sorted).
   - Optionally intersect with HighAsCG `/api/compose-preview/stats` `channels` when bridge connected (fail-open to map only).
2. **`getComposePreviewVariableDefinitions()`** — only define variables for resolved channels.
3. **`ComposePreviewPoller`** — only poll resolved channels.
4. Remove preset definitions for unmapped channels on **`updatePresets()`** (Companion replaces preset list from module — ensure stale keys are not left in structure).
5. Smoke test: 2-screen map → presets for ch **1, 2, 3** only (not 4–8).

---

## 3. Architecture

### 3.1 Data flow (unchanged core)

```text
HighAsCG Caspar consumer → chN.jpg (144×144 letterbox)
  → compose_preview_chN_image (+ quad vars) over WebSocket
  → Companion state-sync → Stream Deck button layers
```

WO-72 only changes **what Companion exposes** and **how buttons are decorated**.

### 3.2 Optional server extension for custom mosaics (§G4)

If Companion cannot crop arbitrary rectangles from one variable client-side at 25 fps:

- HighAsCG adds **`compose_preview_chN_tile_{row}_{col}`** variables (or single JSON manifest) generated from the same JPEG in `compose-preview-companion-thumb.js`.
- Gated by same `companionThumbEnabled` + new `companionMosaicLayouts` config on server **or** computed only for channels referenced in Companion layout JSON pushed via API (future).

**Default path for 2×2 quadrants:** existing **`compose_preview_chN_quad_{tl|tr|bl|br}`** — no server change for §G2.

### 3.3 Label styling (Companion layered)

```text
On air (look_on_pgm / look_on_prv_for_screen):
  preview_pgm / preview_prv  → opacity 100, base64Image = $(HighAsCG:highascg_compose_preview_chN_image)
  label_air                  → opacity 100, NO label_air_bg
  label                      → opacity 0
  border                     → opacity 100
```

---

## 4. Code map

| Area | File |
|------|------|
| Look on-air overrides | `companion-module-highpass-highascg/src/look-air-overrides.js` |
| Look preset layers | `companion-module-highpass-highascg/src/presets/look-preview-linked-presets.js` |
| Label constants | `companion-module-highpass-highascg/src/look-button-style.js` |
| DB patch (existing buttons) | `companion-module-highpass-highascg/scripts/patch-look-label-air-layer.py` |
| Compose presets | `companion-module-highpass-highascg/src/presets/compose-preview-presets.js` |
| Quadrant edge bars | `companion-module-highpass-highascg/src/quadrant-edge-borders.js` |
| Variable defs | `companion-module-highpass-highascg/src/variables.js` |
| Preview gating | `companion-module-highpass-highascg/src/preview-variable-gate.js`, `src/bridge/state-sync.js` |
| Poller | `companion-module-highpass-highascg/src/bridge/compose-preview-poller.js` |
| Instance config | `companion-module-highpass-highascg/src/config-fields.js` |
| Preset aggregation | `companion-module-highpass-highascg/src/presets.js` |
| Channel map source | `instance._channelMap` via bridge `/api/state` |
| Server channel resolve (reference) | `highascg/src/preview/compose-preview-mode.js` → `resolveMonitoredChannels()` |

---

## 5. Tasks

### Phase A — Look label polish

- [x] **T72.A1** Remove `label_air_bg` from `labelOnAirOverrides()` and preset layer lists
- [x] **T72.A2** Set on-air `label_air` / idle `label`: white text, black outline (verify Stream Deck Mini vs XL)
- [x] **T72.A3** Update `patch-look-label-air-layer.py` — strip `label_air_bg`, apply outline colors, re-run on QA bank
- [ ] **T72.A4** QA: on-air look shows name over live preview **without** grey bar

### Phase B — Quadrant seam-safe badges

- [x] **T72.B1** Add `bus_badge` / `screen_badge` text layers to BL/BR quadrant presets only
- [x] **T72.B2** Helper `quadrantBadgeElements(instance, channel, quadrant)` — returns [] for TL/TR
- [x] **T72.B3** Screen label format: `SCR ${screenIndex + 1}` from channelMap index
- [x] **T72.B4** Bus label: `PGM` / `PRV` from `resolveChannelBusStyle()`; neutral `SCR n` only on BR
- [ ] **T72.B5** QA: 2×2 grid — no text crosses button seams; readable on hardware

### Phase C — Config: disable compose preview on buttons

- [x] **T72.C1** Add `compose_preview_buttons_enabled` to `config-fields.js` + `normalizeConnectionConfig` if needed
- [x] **T72.C2** When false: skip compose preset sections in `presets.js`; gate `state-sync` preview batches; stop poller
- [x] **T72.C3** When toggled off→on: refresh presets + request HighAsCG bootstrap variables
- [x] **T72.C4** Document in `companion/HELP.md` (traffic estimate, remote Companion note)
- [ ] **T72.C5** QA: disabled → no compose preview variables updated; actions/looks still work

### Phase D — Custom mosaic layouts

- [ ] **T72.D1** Config schema + validation for layout definitions (§G4)
- [ ] **T72.D2** Preset generator: `addCustomMosaicPresets(presets, structure, instance, layouts)`
- [ ] **T72.D3** Decide crop strategy (client fillMode + crop vs server tile vars) — document in WO log
- [ ] **T72.D4** MVP: ship one example layout `pgm_scr1_5x4` in docs / default config sample
- [ ] **T72.D5** QA: 5×4 wall shows contiguous PGM picture across keys

### Phase E — Remove placeholder channels

- [x] **T72.E1** Implement `resolveComposePreviewChannels(instance)` — map-driven channel list
- [x] **T72.E2** Replace `PREVIEW_CHANNELS` usage in presets, variables, poller
- [x] **T72.E3** `updatePresets()` after `channelMap` sync — verify preset count matches live map
- [ ] **T72.E4** Unit/smoke test: 2-screen fixture → exactly 3 channel presets, no ch4–ch8
- [ ] **T72.E5** QA: fresh connection with 2-screen project — Companion preset list shows no ghost channels

---

## 6. Testing plan

1. **Hardware:** Stream Deck XL — look recall + 2×2 quadrant page + optional 5×4 mosaic.
2. **Bandwidth:** With `compose_preview_buttons_enabled: false`, confirm WebSocket traffic drops (no `compose_preview_*` in Companion debug / variable churn).
3. **Map change:** Toggle project screen count — preset list regenerates without orphan channels.
4. **Regression:** 25 fps preview unchanged when enabled; look take / PGM-PRV feedbacks still correct.

---

## 7. Documentation

- Update `companion-module-highpass-highascg/companion/HELP.md` — config fields, mosaic JSON example, channel list behavior.
- Update `highascg/docs/STICK_QUICK_START.md` — pointer to Companion layout config (optional one paragraph).
- Cross-link WO-63 / WO-71 so thumbnail-cache work does not duplicate mosaic tile generation.

---

## Work Log

### 2026-06-28 — WO created (operator request)

**Context:** Compose preview live at 25 fps on Stream Deck after WO-58 pipeline fixes (letterbox thumb filter, live compose variables on look tally). Operator confirmed playback quality; requested visual and configuration improvements only.

**Captured requirements:**
1. Remove semi-transparent on-air label bar; white text + black outline.
2. Quadrant buttons: PGM/PRV bottom-left, SCR n bottom-right, seam-safe across 2×2.
3. Module config: opt-out of compose preview button traffic; custom multi-button layouts (e.g. 5×4 PGM SCR1).
4. Stop generating presets/variables for Caspar channels that do not exist in `channelMap`.

**Instructions for next agent:** Start with **Phase A + E** (small, high-impact). Phase B next. Phase C is isolated config work. Phase D needs a crop strategy decision (§3.2) before coding — prototype one 5×4 layout on hardware before committing to server-side tile vars.

### 2026-06-28 — WO-72 Phases A, B, C, E implemented

**Done:**
- **Phase A:** Removed `label_air_bg` from look presets/overrides; white text + black outline on-air; patch script updated and re-run (5 look buttons).
- **Phase B:** `quadrant-badges.js` — BL bus badge (PGM/PRV), BR `SCR n`; wired into compose quadrant presets.
- **Phase C:** `compose_preview_buttons_enabled` config checkbox; gates presets, `state-sync` preview vars, poller; off→on re-fetches `/api/state`; documented in `HELP.md`.
- **Phase E:** `resolveComposePreviewChannels()` from `channelMap`; presets/variables/poller no longer hard-code ch1–8.

**Deploy:** `npm run package` → `~/.config/companion/modules/highpass-highascg/`; patch script run; Companion restart attempted.

### 2026-06-28 — Stream Deck glitch regression fix

**Cause:** Look buttons re-bound to shared `highascg_compose_preview_chN_image` (all 5 buttons invalidated on every ch1/ch2 frame). Client-side quadrant split duplicated server quad vars and bypassed preview gate (`[preview-split] could not decode`).

**Fix:** Look tally → `highascg_look_air_frame_{lookId}` (per-look, hash dedupe). Removed Companion client quadrant splitter; server already pushes `compose_preview_chN_quad_*`.

**Instructions for next agent:** Restart Companion; verify Stream Deck look + quadrant buttons. Hardware QA checkboxes still open.
