# Work Order 88: Host-channel live sources (webpage, NDI, DeckLink)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete (Phases A–D)  
**Priority:** High (persistent webpage state, unified live-input architecture)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Related work orders:**
- [WO-28](./28_WO_DECKLINK_INPUT_OUTPUT_ROUTING.md) — DeckLink host channel + `route://` (partial; shared `inputsCh` still allowed)
- [WO-48](./48_WO_LAYER_ROUTE_LIVE_SOURCE_REUSE.md) — `route://` as Live source
- [WO-53](./53_WO_PER_INPUT_AUDIO_METER_CHANNELS.md) — per-input host channels (audio)
- [WO-86](./86_WO_DEVICE_VIEW_ROUTING_MATRIX.md) — Device View routing matrix
- [WO-89](./89_WO_CEF_OPERATOR_CONTROL.md) — CEF mouse/keyboard + HTTP API (depends on host registry from this WO)

---

## 1. Problem statement

### 1.1 Webpage state is lost when taken off air

Today, HTML/CEF pages are often played **directly on the operator/multiview channel** (e.g. ch4 L999). When the operator **CLEAR**s that layer or routes something else on top, Caspar **destroys** the CEF browser instance for that layer. In-memory state (forms, join codes typed but not saved, scroll position, SPA session) is **gone**.

`localStorage` may partially survive in Caspar’s CEF profile for the same URL, but **cannot be relied on** for operator workflows (Slido, Mentimeter, custom join pages).

### 1.2 Live inputs lack a single persistent-host model

| Source type | Today | Problem |
|-------------|-------|---------|
| DeckLink SDI | Often `PLAY inputsCh-N DECKLINK` or shared multiview layers | Works with `route://`, but **shared host** (`inputsCh`) is still optional; not one-channel-per-input everywhere |
| NDI | May play **directly** on program/preview layer | No dedicated host; duplicate plays; state not reusable |
| Webpage / HTML | `PLAY` on scene layer or operator overlay | **CLEAR = destroy** CEF tab |

---

## 2. Target architecture — one Caspar host channel per live input

**Rule (mandatory after this WO):** Every **live input source** (DeckLink, NDI, webpage/HTML) is played **once** on its own **dedicated Caspar host channel**, kept alive for the session (loop / persistent producer). All on-air uses **`route://hostCh-layer`** — never a second `PLAY` of the same feed on PGM/PRV/MVR.

```
┌─────────────────────────────────────────────────────────────────┐
│ Host channel N  (dedicated, no screen consumer required)        │
│   L1  PLAY [HTML] slido_join  LOOP   ← producer stays alive      │
│   or  PLAY N-1 DECKLINK 3                                         │
│   or  PLAY N-1 NDI "Source Name"                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ route://N-1
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   PGM layer            Multiview cell      Operator fullscreen
   (program ch)        (MVR grid)          (routed to consumer)
```

### 2.1 Webpage host channel

| Field | Value |
|-------|--------|
| Role | `webpage_host` (new `hostRole`) |
| Caspar channel | One **dedicated channel** per webpage live source (allocated from channel map pool) |
| Layer | Fixed **L1** (or configurable `webpage_host_layer`, default 1) |
| Producer | `PLAY hostCh-1 [HTML] <templateOrUrl>` with **`LOOP`** so producer stays up |
| On-air | Destinations use `route://hostCh-1` only |

**State guarantee:** Host channel is **not** cleared when operator takes webpage off PGM/MVR — only the **route** is removed. CEF process remains until operator explicitly stops/removes the live source.

### 2.2 NDI host channel (mandatory migration)

| Today | Target |
|-------|--------|
| `PLAY PGM-ch L NDI "…"` direct | `PLAY ndiHostCh-1 NDI "…"` + `PLAY PGM-ch L route://ndiHostCh-1` |
| Optional `useDirect` in Live tab | **Remove** direct NDI on PGM path; host channel only |

Same pattern as DeckLink per [WO-28](./28_WO_DECKLINK_INPUT_OUTPUT_ROUTING.md).

### 2.3 DeckLink host channel (complete WO-28 mandate)

| Today | Target |
|-------|--------|
| `decklink_inputs_host_channel_enabled: false` → inputs on MVR L1–9 | **Always** dedicated channel per assigned DeckLink input slot |
| Shared `inputsCh` | **Deprecated** for new projects; migration converts to per-slot host channels |

---

## 3. Operator workflow (product)

### 3.1 Create webpage live source

1. **Sources → Live → +** (or Device View) → **Webpage**.
2. Enter URL or pick template; system **allocates host channel** `hostCh` and starts:
   ```text
   PLAY hostCh-1 [HTML] <nameOrUrl> LOOP
   MIXER hostCh-1 FILL 0 0 1 1
   ```
3. Live tab shows tile: **label**, `route://hostCh-1`, badge **host ch N**.

### 3.2 Operator fullscreen (video route only)

1. On the webpage tile, click **fullscreen / operator** icon on the badge (new UI).
2. System routes `route://hostCh-1` to **operator channel** fullscreen (multiview or configured operator consumer layer).
3. **Take off operator screen:** remove route from operator consumer only — **host channel keeps playing**.

> **CEF mouse/keyboard** when fullscreen is **[WO-89](./89_WO_CEF_OPERATOR_CONTROL.md)** — this WO only owns the **video route** and host-channel registry metadata (`sourceId`, `hostChannel`, `cefNeedle`).

### 3.3 Device View visibility

When a live input is created with its own host channel, it **must** appear under:

- **Screen destinations → Host channels** (existing virtual destination list)
- **Matrix view** — **left column** as a cabled **source** (same as DeckLink input host rows today)

Extend `client/lib/device-view-host-channels.js`:

| `hostRole` | Matrix label | `hostChannelDestinationId` |
|------------|--------------|----------------------------|
| `webpage_host` | `Webpage: <label> (ch N)` | `host_webpage_<sourceId>` |
| `ndi_host` | `NDI: <name> (ch N)` | `host_ndi_<sourceId>` |
| `decklink_input` | (existing) | `host_decklink_input_<slot>` |

Add `webpage_host` and `ndi_host` to `HOST_CHANNEL_DEST_ROLES`.

---

## 4. Data model & persistence

### 4.1 Live source record (`extraLiveSources` / device graph)

Extend live webpage / NDI entries:

```json
{
  "type": "browser",
  "routeType": "webpage_host",
  "value": "route://12-1",
  "label": "Slido join",
  "hostChannel": 12,
  "hostLayer": 1,
  "sourceId": "webpage_slido_join",
  "templateOrUrl": "slido_join",
  "cefNeedle": "slido_join",
  "interactiveCapable": true
}
```

NDI analogue: `routeType: "ndi_host"`, `ndiName`, dedicated `hostChannel`.

`cefNeedle` / `interactiveCapable` are consumed by [WO-89](./89_WO_CEF_OPERATOR_CONTROL.md) for CDP targeting.

### 4.2 Channel map generator

- [x] Allocate `webpageHostChannels[]` / `ndiHostChannels[]` in `src/config/routing-map.js`.
- [x] Emit extra empty channels in `config-generator-channels.js` (video-mode only, no consumers).
- [x] Startup `PLAY` host producers in `routing-setup.js` (like `setupInputsChannel`).

---

## 5. Migration & deprecation

| Legacy path | Action |
|-------------|--------|
| HTML on operator L999 for interactive test | Keep for dev (`cef-interactive-load-test.sh`) until WO-89 retargets; production uses host channel |
| NDI `useDirect` on PGM | Deprecate; migrate to host + route |
| Shared `inputsCh` for all DeckLink | Deprecate for new saves; one-time migration script |
| `browserAsCg` on scene layer without host | Scene browser fills that need persistence → prompt to create webpage host source |

---

## 6. Tasks

### Phase A — Data model + channel allocation

- [x] **T88.A1** Add `webpage_host` / `ndi_host` roles to channel map + generator
- [x] **T88.A2** Persist live source records with `hostChannel`, `hostLayer`, `sourceId`, `cefNeedle`
- [x] **T88.A3** Startup PLAY LOOP on host channels when project loads
- [x] **T88.A4** Mandate host-only path in `live-input-modal.js` (remove direct NDI/browser on PGM)

### Phase B — Device View + matrix

- [x] **T88.B1** `device-view-host-channels.js` — webpage + NDI host rows
- [x] **T88.B2** Matrix left column shows new host sources (cable to Record/Stream/PGM)
- [x] **T88.B3** Inspector copy for webpage host destination

### Phase C — Sources UI workflow

- [x] **T88.C1** Live tab webpage tile + **operator fullscreen** badge icon (video route)
- [x] **T88.C2** Fullscreen action: `route://hostCh-1` → operator consumer layer
- [x] **T88.C3** Take off operator: clear route only; toast “Webpage still running on ch N”
- [x] **T88.C4** Emit event / state flag for WO-89 when operator fullscreen toggles (`sourceId`, `hostChannel`)

### Phase D — DeckLink / NDI completion

- [x] **T88.D1** DeckLink: enforce dedicated host channel per slot (no shared MVR L1–9 for new projects)
- [x] **T88.D2** NDI: host channel + route only; remove direct play path
- [x] **T88.D3** Migration helper for existing projects (settings save warnings)

---

## 7. Acceptance criteria

1. Operator creates webpage live source → dedicated host channel plays HTML **LOOP**; tile appears in **Sources → Live** and **Device View → Host channels** (matrix left).
2. **Go fullscreen** routes **video** to operator monitor via `route://`; host channel keeps playing when route is removed.
3. Removing webpage from operator/PGM **does not CLEAR** host channel; rejoining shows **same page state** (form fields, counters).
4. NDI and DeckLink inputs follow **host channel only** — no direct PGM `PLAY` in UI or generator.
5. Host source registry exposes `sourceId`, `hostChannel`, `hostLayer`, `cefNeedle` for [WO-89](./89_WO_CEF_OPERATOR_CONTROL.md).

---

## 8. Related files

| Area | Files |
|------|--------|
| Channel map | `src/config/routing.js`, `config-generator.js`, `routing-setup.js` |
| Device View hosts | `client/lib/device-view-host-channels.js`, `device-view-destinations-ui.js` |
| Live sources UI | `client/components/live-input-modal.js`, `sources-panel-live-render.js`, `sources-panel-helpers.js` |
| Route strings | `src/config/routing-map.js`, `getRouteString` |

---

## Work Log

### 2026-06-29 — Agent (Phase A–B implementation)

**Work Done:**
- Added `src/config/host-live-sources.js` + `host-live-sources-setup.js` — normalize webpage/NDI to dedicated host channels, `PLAY … LOOP` on boot, AMCP on add.
- Wired `routing-map.js`, `config-generator-channels.js`, `buildHostLiveChannel` in consumer-attach, `routing-setup.js`, `routes-device-view.js` (normalize + play on add).
- Device View: `device-view-host-channels.js` (`webpage_host` / `ndi_host` roles), `buildGeneratedChannelOrder`, `channel-map-from-ctx` exposes `hostLiveChannels`.
- Live UI: `live-input-modal.js` host-only NDI/browser (no direct PGM play); Live tab shows host ch badge.
- Tests: `tools/smoke/smoke-host-live-sources.test.js` (5 passing).

**Instructions for Next Agent:**
1. **Phase B remainder:** matrix left-column cabling for webpage/NDI host rows (T88.B2–B3) — verify in Device View UI.
2. **Phase C:** operator fullscreen badge + route to operator consumer (video only); emit `cefFocusTarget` state for WO-89 (T88.C4).
3. After adding a host source: **Apply Caspar config + restart** so new `<channel>` exists before `PLAY` succeeds.
4. Manual test: add `interactive_click_test` webpage host → route to PGM → CLEAR route → re-route → state preserved.

### 2026-06-29 — Agent (Phase B — matrix + inspector)

**Work Done:**
- Matrix view lists virtual host destinations under **Host channels** (left column).
- `device-graph-suggest.js` synthesizes `dst_in_host_webpage_*` / `dst_in_host_ndi_*` for Record/Stream cabling.
- Inspector shows route, sourceId, page/CEF needle, NDI name; Device View GET includes `extraLiveSources`.
- Test: `smoke-device-graph-host-destinations.test.js`.

**Instructions for Next Agent:** **Phase C** — operator fullscreen badge + video route; `cefFocusTarget` for WO-89.

### 2026-06-29 — Agent (Phase C — operator fullscreen)

**Work Done:**
- `host-operator-fullscreen.js` — video route to multiview interactive layer; host channel untouched on take-off.
- API `/api/host-live/operator-fullscreen`; state exposes `hostOperatorFullscreen` + `cefFocusTarget`.
- Live tab ⛶ on webpage host tiles; toast “Webpage still running on ch N”.
- Test: `smoke-host-operator-fullscreen.test.js`.

**Instructions for Next Agent:** **Phase D** — DeckLink enforcement; WO-89 retarget CDP to `cefFocusTarget`.

### 2026-06-29 — Agent (Phase D — migration + NDI/DeckLink)

**Work Done:**
- `host-live-sources-migrate.js` — legacy NDI/browser → host channels; decklink_inputs_host → dedicated on save.
- Warnings in state/settings; `GET/POST /api/host-live/migration`.
- Removed direct NDI PLAY from live-input-modal; scene drops strip useDirect for route://.
- Test: `smoke-host-live-sources-migrate.test.js`.

**Instructions for Next Agent:** **WO-89** — retarget CEF bridge to `cefFocusTarget`.

### 2026-06-30 — Agent (split from combined WO)

**Work Done:**
- Split host-channel scope out of the former combined WO-88.
- CEF operator control moved to [WO-89](./89_WO_CEF_OPERATOR_CONTROL.md).
- Operator fullscreen in this WO is **video route only**; interactive input is WO-89.

**Instructions for Next Agent:** Start **Phase A** (`webpage_host` channel allocation + LOOP PLAY on load). **T88.C4** should expose fullscreen state for WO-89 without implementing CDP there.

### 2026-06-30 — Agent (initial combined draft)

**Work Done:** Original combined work order drafted (later split).

---
*Work Order created: 2026-06-30 | Series: HighAsCG live inputs*
