# Work Order 107: GPU output EDID pipeline + inspector visibility

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete
**Priority:** High — operators cannot see which monitor/EDID a GPU output actually received; miscabling is diagnosed by trial and error
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md), supersedes/absorbs the EDID parts of [33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md](./33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md) (draft, never implemented)

**Builds on / touches:**
- `src/utils/hardware-info.js` — `getGpuConnectorInventory`, `getDisplayDetails`, `getDisplaysXrandrVerboseRaw`
- `src/utils/gpu-modetest.js` — full modetest/EDID-hex correlation pipeline (**currently dead code**)
- `src/api/device-view-snapshot.js` — `buildLiveSnapshot` → `live.gpu.*`
- `client/components/device-view-inspectors.js`, `device-view-inspector-gpu.js`, `device-view-inspector-gpu-video-modeline.js`
- `client/components/device-view-caspar-render-markers.js`, `device-view-caspar-render-simple.js`

---

## 1. Problem statement (from 2026-07-02 flow review)

### 1.1 EDID is never actually retrieved
- The live path is **xrandr `--query` only**. `getGpuConnectorInventory()` (`hardware-info.js` 214–230) hardcodes `edid: ''`, `modes: []`, `modetestId: null`, `drmCard: 'card0'`. `getDisplayDetails()` also always returns `edid: ''`.
- A complete modetest + EDID-hex pipeline exists in `src/utils/gpu-modetest.js` (`probeModetestConnectors`, `parseModetestConnectors`, `parseXrandrVerboseOutputs`, `matchModetestToXrandr`) but is **never called outside its own module and smoke tests**.
- `getDisplaysXrandrVerboseRaw()` (would give EDID hex via `xrandr --verbose`) is exported and unused.
- There is **no EDID descriptor parser anywhere** — no monitor product name, manufacturer PNP id, serial, EDID version, or physical size ever reaches the API.

### 1.2 What the client shows is misleadingly labeled "EDID"
- The "OS output (DP-X) — EDID or Custom" dropdown (`device-view-inspector-gpu-video-modeline.js` ~215–330) is populated from **xrandr mode tokens**, not EDID identity. Operators believe they're seeing EDID; they're seeing timings.
- The GPU connector inspector **skips the summary table** entirely (`device-view-inspectors.js` ~50–54: `if (!isGpu && !isDecklinkPort)`), so unlike DeckLink there are no structured rows (name/status/monitor) at all.
- The only monitor identity shown is `Physical: DP-0` at **10px / 60% opacity inside the collapsed "Show advanced consumer settings…" section** (`device-view-inspector-gpu.js` 368).
- On the rear-panel port nodes, connection details (xrandr name, resolution, Hz) are **tooltip-only** (`device-view-caspar-render-markers.js` 140–146); nothing on the glyph identifies which monitor/EDID that jack received.

### 1.3 Concrete client bug
- The Caspar `screen_N_edid_override` input `edidIn` is **created and wired but never appended to the DOM** (`device-view-inspector-gpu.js` 279–285 — it is absent from both `wrapCtl.append(...)` at 338 and `advancedToggles.append(...)` at 365). Reset clears the key (300), but no one can set it in the UI.

### 1.4 Freshness
- No hotplug detection; Device View refreshes on load/manual Refresh/settings events only. Swapping a cable shows stale info until the operator clicks Refresh.
- GPU enumeration errors are pushed into `live.warnings[]` but not surfaced in the GPU inspector.
- Misleading names: `getPhysicalPortsFromModetest()` in `system-hardware-gpu-layout.js` actually calls the xrandr inventory.

---

## 2. Goal (normative)

1. Every **connected** GPU output in `live.gpu` carries real EDID data: raw hex plus parsed `{ monitorName, pnpId, serial, edidVersion, sizeMm, preferredMode }`.
2. The GPU ports inspector shows a **summary table** (like DeckLink) with: physical port, active RandR output, monitor name, serial, native/preferred mode, link status — visible **without expanding anything**.
3. The rear-panel port node itself shows the received monitor name (or "no EDID") — not tooltip-only.
4. The "EDID or Custom" dropdown is relabeled/regrouped so mode tokens are not presented as EDID identity.
5. The `screen_N_edid_override` field is actually editable in the UI.
6. Hotplug (connect/disconnect) refreshes GPU data in the Device View within a few seconds without manual Refresh.

---

## 3. Recommended approach

### 3.1 Server: wire the existing EDID pipeline
- In `buildLiveSnapshot` (or inside `getGpuConnectorInventory`), obtain EDID per output. Prefer the cheapest reliable source, in order:
  1. `/sys/class/drm/card*-*/edid` (raw bytes, no exec) — matched to xrandr names via existing `matchModetestToXrandr`/name heuristics;
  2. `xrandr --verbose` parse (`parseXrandrVerboseOutputs` already exists);
  3. `probeModetestConnectors()` as fallback.
- Add a small pure parser `src/utils/edid-parse.js`: header check, manufacturer PNP id, product code, serial, EDID version, physical size, and descriptor blocks 0xFC (name) / 0xFF (serial string) / preferred detailed timing. ~120 lines, no deps. Unit-test with captured blobs.
- Extend shapes: `live.gpu.connectors[i].edid = { raw, parsed }`, `live.gpu.displays[i].monitor = parsed`, and copy onto `physicalMap.ports[].runtime.monitor`. Cache per (output, edid-hash) so repeated GETs don't re-parse.
- Fix `drmCard: 'card0'` hardcode while in there (derive from the DRM path actually matched).
- Rename `getPhysicalPortsFromModetest` → honest name or make it use modetest for real.

### 3.2 Client: make EDID visible
- **Inspector summary table**: allow the GPU branch in `renderConnectorInspector` to render rows: `Port (rear)`, `OS output`, `Monitor` (EDID name, bold), `Serial`, `Native mode`, `Status`. Show `live.warnings` entries mentioning `gpu_enum` here too.
- **Rear panel**: extend marker label building (`device-view-gpu-port-entries.js` / `labelForPhysicalPort`) with monitor name when connected, e.g. `DP 0/1 · DP-0 · LG UltraFine · 4K60`; keep full detail in tooltip. Simple-node subtitle (`device-view-caspar-render-simple.js` 29–39) already shows `monitor · resolution · Hz` — feed it the parsed EDID name instead of xrandr display name where available.
- **Modeline section**: retitle dropdown group to "Detected modes (from display)" vs "Custom"; add one line above it: `EDID: <MonitorName> (<serial>)` or `No EDID received` in a warning color — this is the operator's primary "did the output receive the right EDID" signal.
- **Bugfix**: append `edidIn` into `advancedToggles` next to the reset button.

### 3.3 Freshness
- Cheap hotplug watch: server-side `fs.watch` on `/sys/class/drm` (or poll connector `status` files every ~2 s while at least one Device View WS client is subscribed) → broadcast a small WS event `gpu_topology_changed`; client Device View listens and calls `load()`. Reuse the existing `highascg-device-view-reload` event on the client side.
- Keep manual Refresh as-is; no periodic full snapshot polling.

---

## 4. Tasks

- [x] **T107.1** `src/utils/edid-parse.js` + unit test with real captured EDID blobs (grab from `/sys/class/drm` on the dev box; store fixtures under `tools/smoke/fixtures/`).
- [x] **T107.2** Server EDID acquisition (sysfs → xrandr-verbose → modetest fallback) wired into `buildLiveSnapshot`; extend `connectors`/`displays`/`physicalMap.ports[].runtime` shapes; per-hash parse cache.
- [x] **T107.3** Fix `drmCard` hardcode; rename or fix `getPhysicalPortsFromModetest`.
- [x] **T107.4** GPU inspector summary table incl. monitor name/serial/native mode + `gpu_enum` warnings surfaced.
- [x] **T107.5** Rear-panel marker + simple-node labels show EDID monitor name; tooltip gains serial + native mode.
- [x] **T107.6** Modeline section: `EDID: <name>` headline line, relabel mode dropdown, mount the missing `edidIn` override input.
- [x] **T107.7** Hotplug: DRM status watch → WS `gpu_topology_changed` → Device View auto-reload.
- [x] **T107.8** Smoke test: snapshot contains parsed EDID for a connected head; inspector renders name; simulated EDID-absent output shows "No EDID received".
- [x] **T107.9** Reconcile with WO-33e: mark its EDID-match/apply scope as superseded here or rebase it on the new `edid.parsed` data.

---

## 5. Acceptance criteria

1. `GET /api/device-view` returns, for each connected GPU output, `edid.raw` (hex) and `edid.parsed.monitorName` matching the physically attached monitor.
2. Opening a GPU port in the inspector shows monitor name + serial **without** expanding advanced settings; disconnected/no-EDID ports say so explicitly.
3. Rear-panel port label includes the monitor name when connected.
4. The EDID override input is visible, editable, persists to `screen_N_edid_override`, and reset clears it.
5. Unplugging/replugging a monitor updates the Device View within ~5 s with no manual Refresh.
6. No regression on machines where sysfs EDID is unavailable (falls back gracefully, still shows xrandr data).

---

## 6. Rollout / risk notes

- `xrandr --verbose` and `modetest` can be slow/absent; sysfs read is the default path and is nearly free. Never block `buildLiveSnapshot` more than ~250 ms on EDID acquisition — degrade to empty EDID with a warning instead.
- `modetest` requires DRM master or works only on some drivers with NVIDIA proprietary — treat as best-effort fallback only.
- Hotplug watch must be gated to active Device View clients to avoid constant sysfs polling on headless playout.

---

## Work Log

### 2026-07-02 — Initial WO (from GPU output/EDID flow review)

- Documented that the modetest/EDID pipeline in `gpu-modetest.js` is dead code, `edid` fields are always empty, the "EDID" dropdown is really xrandr modes, monitor identity is buried in a collapsed 10px line, and the `edidIn` override input is never mounted.
- **Instructions for Next Agent:** T107.1 + T107.2 first (server data must exist before UI work). T107.6's `edidIn` mount is a one-line quick win — can land immediately. Check WO-35 (`35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md`) and WO-33e for overlapping intent before changing shapes; coordinate shape changes with WO-108 (ports layout) which consumes `physicalMap`.

### 2026-07-02 — Implemented WO-107 (GPU EDID pipeline + inspector visibility)

**Server**
- Added `src/utils/edid-parse.js` (EDID 1.x base-block parser) and `src/utils/gpu-edid-probe.js` (sysfs → xrandr-verbose → modetest catalog, per-hash parse cache, ~250 ms budget).
- Wired EDID into `getGpuConnectorInventory()` / `getDisplayDetails()`; `live.gpu.displays` + `physicalMap.ports[].runtime.monitor/edid` in `device-view-snapshot.js`.
- Renamed `getPhysicalPortsFromModetest` → `getPhysicalPortsFromXrandrInventory`; `drmCard` derived from matched DRM path.
- Hotplug: `src/bootstrap/gpu-drm-hotplug-watch.js` polls `/sys/class/drm/*/status` while Device View is active; broadcasts WS `gpu_topology_changed`.

**Client**
- GPU inspector summary table (monitor, serial, native mode, gpu_enum warnings).
- Rear-panel labels/tooltips use parsed EDID monitor name.
- Modeline section: `EDID: <name>` headline, relabeled mode dropdown, `edidIn` mounted in advanced settings.
- Device View sends `device_view_subscribe` over WS; `gpu_topology_changed` triggers `highascg-device-view-reload`.

**Tests**
- `tools/smoke/smoke-edid-parse.test.js`, `tools/smoke/smoke-gpu-edid-pipeline.test.js` + fixture `tools/smoke/fixtures/edid-acer-k222hql.hex` (in CI bundle).

**WO-33e** marked superseded for GPU EDID identity scope; cable mismatch/apply flow there remains future work on top of `edid.parsed`.

**Instructions for Next Agent:** WO-108 (GPU ports layout single source of truth) can proceed; it consumes `physicalMap` shapes extended here.
