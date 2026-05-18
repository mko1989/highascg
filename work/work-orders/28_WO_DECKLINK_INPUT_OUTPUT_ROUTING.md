# WO-28 — DeckLink input / output routing

**Location:** This work order lives under `work/` as the working copy for design + status. A short pointer also exists in `docs/28_WO_DECKLINK_INPUT_OUTPUT_ROUTING.md` so searches under `docs/` still resolve.

## Implementation status (HighAsCG)

| Item | Status |
|------|--------|
| Channel map, `inputsOnMvr`, dedicated inputs channel | Implemented (`src/config/routing.js`, `config-generator.js`) |
| `PLAY … DECKLINK` on inputs channel / MVR layers 1–9 | Implemented (`setupInputsChannel`) |
| Per-slot `decklink_input_N_device` + Settings UI rows | Implemented (`config/default.js`, `settings-modal*.js`) |
| Output vs input conflict skip + log | Implemented |
| Multiview layers 10+ BG, 11+ cells, `route://` for inputs | Implemented (`routes-multiview.js`) |
| INFO CONFIG parsing: DeckLink output consumers | Implemented (`parseServerChannels` exposes `hasDecklinkOutput`) |
| Host IP splash on DeckLink-only PGM (no `<screen>`) | Implemented (see below) |
| Config validation warnings on save (duplicate / output conflict) | Implemented (`decklink-config-validate.js`, `POST /api/settings` → `warnings`) |
| Runtime PLAY summary in Settings + WS state | Implemented (`ctx._decklinkInputsStatus`, `GET /api/settings`, `getState().decklinkInputsStatus`, Screens tab line) |

---

## Problem

- A DeckLink device used as a **capture input** in Caspar cannot simultaneously be used as a **playback output** on another consumer. Hardware and the DeckLink SDK treat a given card/port in one role at a time.
- Caspar’s `PLAY channel-layer DECKLINK N` typically binds **one** layer on **one** channel to that input. The application needs the same live feed in **multiple** places (PGM, PRV, multiview cells). Playing the input in many layers directly is not the intended model.
- **Solution:** play each needed input **once** on a **host channel** (dedicated inputs channel or multiview channel), then reference it elsewhere with **`route://ch-layer`** (`PLAY dst-channel dst-layer route://src-ch-srcLayer`).

## Configuration model (HighAsCG)

### Channel map

- Program / preview pairs: channels `1…2N` for `N` screen pairs.
- **Multiview (MVR)** channel: next channel when multiview is enabled.
- **DeckLink inputs** when `decklink_input_count > 0`:
  - If **multiview is enabled** and **`multiview_mode` === `inputs_channel_mode`**, inputs are hosted on the **same channel as multiview** (`inputsOnMvr`). No extra channel is generated in `casparcg.config`.
  - Otherwise a **dedicated empty channel** is emitted after MVR for inputs only.

### Layer budget on MVR (when `inputsOnMvr`)

| Layers | Role |
|--------|------|
| 1–9 | DeckLink inputs: slot `i` → `PLAY MVR-ch i DECKLINK <device>` |
| 10 | Solid background colour (multiview editor / API; default black) |
| 11+ | Multiview layout cells (PGM/PRV/routed sources) |
| 60 (typ.) | HTML overlay CG for labels/borders |

`POST /api/multiview/apply` clears layers **≥10** so DeckLink layers **1–9** stay live while the grid updates.

### Per-input device index

- **`decklink_input_count`**: how many logical input slots (1–8).
- **`decklink_input_{1…8}_device`**: Caspar **device index** `N` in `PLAY … DECKLINK N`.
  - **`0` or unset**: auto — slot `i` uses device index **`i`** (matches common 1:1 wiring).
  - **Non-zero**: explicit index; required when physical order does not match slot order.
- **Must not** equal:
  - another input slot’s resolved device index (duplicate play), or
  - any **`screen_*_decklink_device`** or **`multiview_decklink_device`** used as **output** (runtime skips conflicting inputs and logs a warning).

Settings UI: **Screens** → after “Decklink input channels”, map each slot to a device index; a warning appears if an input index matches a configured output device.

### Runtime

- `src/config/routing.js` — `setupInputsChannel`: resolves devices via `readCasparSetting` / `resolveDecklinkInputDeviceIndex`, merges `casparServer` keys, plays `PLAY {inputsCh}-{layer} DECKLINK {device}`, logs duplicates and output conflicts.
- `src/api/routes-multiview.js` — `routeForCell` builds `route://{inputsCh}-{layer}` for decklink cells.
- Sources panel / live input UI use the same `route://` strings for labels and routing.

### Dedicated inputs channel (mode mismatch)

If MVR mode ≠ inputs channel mode, the generator adds a **separate** channel with **no consumers** — only a valid `video-mode` so `PLAY … DECKLINK` can run. Multiview still uses layers 10+ on the MVR channel for the grid; inputs live on the other channel and are referenced by `route://` only.

## Host IP splash (related operability)

After reboot, LAN IPv4 may not be assigned when Node starts; splash previously also required a `<screen>` consumer, so **DeckLink-only** program outputs showed nothing.

**Current behaviour** (`src/bootstrap/startup-host-ip-splash.js`):

- Targets any channel that has a **screen** and/or **DeckLink output** consumer in INFO CONFIG.
- **Retries** (no LAN IP yet, or INFO CONFIG not ready) up to ~45 × 3s.
- If **WebSocket clients** are already connected (e.g. headless automation), **defers** splash (retries) up to a cap; the web UI uses the same HTTP server’s WebSocket (`/api/ws`, `/ws`, …).
- When the **first** WebSocket client connects (browser UI), **`clearHostIpSplash`** removes the overlay CG on layer 990.

Set `HIGHASCG_NO_IP_SPLASH=1` to disable the feature entirely.

## Related files

| Area | File |
|------|------|
| Channel map, `inputsOnMvr`, startup `PLAY` | `src/config/routing.js` |
| Generated XML (extra inputs channel) | `src/config/config-generator.js` |
| Multiview apply, layers 10+, BG, cells | `src/api/routes-multiview.js` |
| Defaults / persisted keys | `config/default.js` |
| Settings UI (count + per-device rows) | `web/components/settings-modal.js`, `settings-modal-caspar-ui.js` |
| INFO CONFIG channel parse (screen + DeckLink) | `src/config/config-compare.js` |
| Host IP splash + WS clear | `src/bootstrap/startup-host-ip-splash.js`, `src/server/ws-server.js`, `index.js` |

## Future / optional hardening

- Enumerate DeckLink devices via OS or Caspar INFO where available, and validate indices against hardware before save (beyond index-vs-index checks).
