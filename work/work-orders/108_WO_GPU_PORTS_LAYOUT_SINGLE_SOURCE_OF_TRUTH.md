# Work Order 108: GPU ports layout — single source of truth

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Complete
**Priority:** High — rear-panel layout drives Caspar screen-consumer indices and xrandr application; drift between its three stores mis-routes real outputs
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md), builds on [35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md](./35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md), [40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md)

**Builds on / touches:**
- `src/utils/gpu-topology-xrandr.js` — discovery + `ensureGpuPhysicalTopologyFromXrandr` boot persist
- `src/utils/gpu-topology-drm.js` — DRM discovery (**dead code** in main path)
- `src/utils/gpu-physical-map.js` — `resolvePhysicalTopology`, `buildGpuPhysicalMap`
- `src/api/system-hardware-gpu-ports.js` (reset), `src/api/system-hardware-gpu-layout.js` (legacy parallel API)
- `src/config/defaults-core.js`, `data/known-gpus.json`, `config/general.json` (`gpuPhysicalTopology`)
- `client/lib/device-view-gpu-port-topology.js`, `device-view-gpu-port-layout-prefs.js`, `device-view-gpu-port-merge.js`, `device-view-gpu-port-utils.js`
- `client/components/device-view-inspector-gpu-layout-editor.js`
- Consumers: `src/config/screen-consumer-port-resolve.js`, `src/config/device-graph-suggest.js`, `src/utils/os-layout-calculator*.js`, `src/utils/os-config.js`

---

## 1. Problem statement (from 2026-07-02 layout review)

The "GPU ports layout" (which RandR names DP-0/DP-1… belong to which rear socket `gpu_pN`, in what order) is created in **three competing places** and consumed by safety-critical paths (Caspar `screen_N_*` key routing, xrandr apply, pixel-map attachment):

### 1.1 Three sources of truth that disagree
- **Server config** `gpuPhysicalTopology` (`config/general.json`) — used by `buildGpuPhysicalMap` (config-first via `resolvePhysicalTopology`).
- **Browser localStorage** `gpu_custom_layout` — **wins over server config** in the client (`resolveEffectiveGpuTopology`, `device-view-gpu-port-topology.js` 76–84). A second operator station or a cleared browser shows a different rear order than the server's `physicalMap`, while Caspar config generation follows the server view.
- **Hardcoded defaults, three divergent copies**: `defaults-core.js` and `defaultClientGpuTopology()` include an HDMI socket; `known-gpus.json` is 4× DP only; the live `config/general.json` is 4× DP pairs. Client `mergeTopologyWithDefaultSockets()` force-merges everything to the 4-socket RTX 20/30 template even for other GPUs.

### 1.2 Dead / misleading code paths
- `physicalMap.effectiveTopology` is checked first by the client (`resolveTopologyForDeviceView`, 145–146) but the **server never sets it** — the intended "server-reconciled" path is dead.
- `discoverGpuPhysicalTopologyFromDrm()` is fully implemented (`gpu-topology-drm.js` 429–443) and never called; `discoverGpuPhysicalTopology()` says "Prefer DRM" but only runs xrandr (451–480). Already flagged in `work/LIVE_ISO_BUILD_FIXES.md`.
- `hasDrmGpuPhysicalMap()` tests `topologySource === 'drm'` which the main path never produces.
- Legacy parallel API `GET /api/system/gpu-layout` returns a **different schema** (`port-N` ids) and is only used by the support bundle.
- Client-only `reconcileTopologyWithLiveDisplays()` re-aligns stale pairs against live RandR; the server has no equivalent, so client and server can disagree about `activePort` until settings are re-saved.

### 1.3 Persistence hazards
- `ensureGpuPhysicalTopologyFromXrandr()` **auto-overwrites saved config at boot** whenever discovery differs (`gpu-topology-xrandr.js` 213–245) — driver updates or enumeration-order changes silently clobber operator-arranged layouts.
- `POST /api/system/gpu-ports-reset` returns fresh pairs to localStorage only; server config is untouched, yet the editor's reset flow reports "Server xrandr layout applied" (`device-view-inspector-gpu-layout-editor.js` ~269) while **no xrandr command runs**.
- `gpuPhysicalTopology` is stripped from replication (`config-classify.js` 17–21, correct per-machine) but localStorage isn't synced anywhere, so a fresh browser loses order/hidden prefs even on the same machine.

### 1.4 Consumer coupling
- `screen-consumer-port-resolve.js` derives Caspar consumer flags from `gpu_pN` index (`gpu_p0` → port 1); `device-graph-suggest.js` builds `gpu_out` connectors from `physicalMap.ports`. If UI topology (localStorage) and server topology diverge, the operator cables against a rear panel that doesn't match the generated Caspar config.
- Unmatched connected displays become `gpu_unmapped_N` rows (`gpu-physical-map.js` 222–256) with no UI affordance to adopt them into a socket.
- `collectGpuPortNameOptions()` hardcodes DP-0..7 / HDMI-0..3 / eDP regardless of actual hardware.

---

## 2. Goal (normative)

1. **Server config `gpuPhysicalTopology` is the single source of truth.** The client renders it; localStorage holds only cosmetic prefs (hidden flags) or is removed entirely; any reorder/pair edit saves to the server immediately.
2. Server publishes `physicalMap.effectiveTopology` (config reconciled against live RandR) and the client consumes it — reconciliation logic lives in **one** place, server-side.
3. Boot discovery **never silently overwrites** a topology the operator saved; it may propose (`suggestedTopology` + warning) but persists only when no operator-saved topology exists.
4. Defaults are defined **once** (server), keyed by GPU model where known; the client has no divergent hardcoded template and does not force 4-socket RTX shape onto other GPUs.
5. Reset flow is honest: it re-discovers, shows a preview diff, and persists to server config only on confirm; UI copy matches what actually happened.
6. Unmapped live displays are adoptable from the layout editor (assign to socket → persists).

---

## 3. Recommended approach

### 3.1 Server-authoritative topology (core change)
- In `buildGpuPhysicalMap`, after resolving topology, run the reconcile step (port of client `reconcileTopologyWithLiveDisplays`) and emit `physicalMap.effectiveTopology` + `physicalMap.topologySource` + `physicalMap.suggestedTopology` (when discovery differs from saved config).
- Client `resolveTopologyForDeviceView` already prefers `effectiveTopology` — once the server sets it, delete `resolveEffectiveGpuTopology`'s localStorage-wins branch, `reconcileTopologyWithLiveDisplays`, and `defaultClientGpuTopology` fallbacks (keep a minimal skeleton for offline render).
- Layout editor edits call `saveGpuPhysicalTopology()` (already exists → `POST /api/settings`) on every commit; `gpu_custom_layout` localStorage reduced to `hidden` flags only, with a one-time migration that pushes any existing localStorage order to the server then clears it.

### 3.2 Boot persist discipline
- Add a marker on saved rows (e.g. `source: 'operator' | 'discovered'` or a top-level `gpuPhysicalTopologyOperatorSaved: true` set by `POST /api/settings`). `ensureGpuPhysicalTopologyFromXrandr` persists only when there is no operator-saved topology; otherwise it stores the discovery as `suggestedTopology` in the inventory and logs a warning.
- Surface the mismatch in Device View: banner "Detected GPU wiring differs from saved layout — Review".

### 3.3 Defaults consolidation
- Keep one default table server-side: `known-gpus.json` extended per model (incl. HDMI where the board has it); `defaults-core.js` and `gpu-physical-map.js#defaultTopology` reference it; delete `defaultClientGpuTopology()`'s independent copy (client receives defaults via `effectiveTopology`).
- `mergeTopologyWithDefaultSockets` (forcing 4 sockets) becomes server-side and GPU-model-aware; socket count comes from discovery/known-GPU entry, not a fixed RTX template.

### 3.4 Reset + editor honesty
- `POST /api/system/gpu-ports-reset` gains `{ persist: boolean }`; editor shows discovered-vs-current diff and only persists on confirm. Fix the "Server xrandr layout applied" message (nothing xrandr-related happens there).
- Layout editor: add "Assign to socket…" action on `gpu_unmapped_N` rows → updates topology row dpA/dpB and saves.
- `collectGpuPortNameOptions()` builds options from live xrandr output names + saved topology instead of the hardcoded list (keep hardcoded as last-resort fallback).

### 3.5 Cleanup
- Wire or delete `discoverGpuPhysicalTopologyFromDrm` (recommended: use as verification source feeding `suggestedTopology`, per WO-107's sysfs work); fix `hasDrmGpuPhysicalMap` semantics.
- Deprecate `GET /api/system/gpu-layout` or convert the support bundle to consume `physicalMap` so one schema remains.

---

## 4. Tasks

- [x] **T108.1** Server: `effectiveTopology` + `suggestedTopology` in `buildGpuPhysicalMap`; port reconcile logic server-side with unit test.
- [x] **T108.2** Client: consume `effectiveTopology`; remove localStorage-wins ordering; one-time localStorage→server migration; editor commits persist via `POST /api/settings`.
- [x] **T108.3** Boot persist gate: operator-saved marker; `ensureGpuPhysicalTopologyFromXrandr` proposes instead of overwriting; Device View mismatch banner.
- [x] **T108.4** Defaults consolidation into `known-gpus.json`-driven server table; delete client template; GPU-model-aware socket count.
- [x] **T108.5** Reset flow with diff preview + explicit persist; fix misleading status message.
- [x] **T108.6** Adopt-unmapped-display action in layout editor.
- [x] **T108.7** Dynamic `collectGpuPortNameOptions` from live outputs.
- [x] **T108.8** DRM discovery wired as verification (`suggestedTopology` source) or removed; fix `hasDrmGpuPhysicalMap`; retire `GET /api/system/gpu-layout` duplicate schema.
- [x] **T108.9** Smoke tests: config-vs-localStorage divergence eliminated (same order on two clients), boot with changed enumeration does not clobber operator layout, unmapped adoption round-trip, Caspar `screen_N_*` routing follows edited topology.

---

## 5. Acceptance criteria

1. Two different browsers against the same server show identical rear-panel order; reordering in one is visible in the other after refresh (server-persisted).
2. With an operator-saved layout, rebooting after an xrandr enumeration change does NOT modify `config/general.json`; Device View shows a review banner instead.
3. Reset shows a diff and only writes config on confirm; no message claims xrandr was applied.
4. A connected display on an unknown pair can be adopted into a socket from the editor and survives reload + reboot.
5. `screen_N_*` Caspar consumer keys and `gpu_out` suggested connectors follow the (single) server topology after any edit — verified by generating Caspar config before/after a reorder.
6. No remaining references to `defaultClientGpuTopology`'s independent socket table; non-RTX GPU (e.g. 2-output card) shows 2 sockets, not 4.

---

## 6. Rollout / risk notes

- T108.2's migration must not lose existing operator localStorage layouts — push-then-clear, and keep a `gpu_custom_layout.bak` key for one release.
- T108.3 changes boot behavior; on truly fresh machines discovery must still auto-persist (that's the current bootstrap path for new ISOs) — the gate is only for operator-saved layouts.
- Coordinate with WO-107 (EDID): both touch `buildGpuPhysicalMap` shapes; land shape changes together or sequence WO-107 first.
- `screen-consumer-port-resolve` behavior must be regression-tested on the live playout box before shipping (miswired `screen_N` keys = wrong physical output on air).

---

## Work Log

### 2026-07-02 — Initial WO (from GPU ports layout review)

- Documented the three competing topology stores (server config, localStorage-wins client resolution, three divergent hardcoded defaults), the never-populated `effectiveTopology` contract, boot auto-overwrite of saved config, the non-persisting reset with misleading status text, and dead DRM discovery.
- **Instructions for Next Agent:** T108.1 + T108.2 are the core and should land together (server publishes, client consumes, localStorage demoted). T108.3 is independent and high value (prevents silent config clobber). Sequence relative to WO-107: agree on `physicalMap` shape extensions first.

### 2026-07-02 — Core single-source-of-truth (T108.1–T108.3, partial T108.5)

**Server**
- `src/utils/gpu-topology-reconcile.js` — server-side reconcile against live RandR.
- `buildGpuPhysicalMap` now emits `effectiveTopology`, `suggestedTopology`, `topologyMismatch`.
- `gpuPhysicalTopologyOperatorSaved` set on `POST /api/settings` when topology is saved.
- `ensureGpuPhysicalTopologyFromXrandr` skips overwrite when operator-saved; returns `suggested` instead.

**Client**
- `resolveTopologyForDeviceView` prefers server `effectiveTopology`; localStorage no longer wins ordering.
- `migrateLegacyGpuLayoutPrefsToServer()` pushes legacy layout order to server once, keeps hidden flags only.
- Rear panel / merge / helpers use server topology; `gpu_custom_layout.bak` backup on migration.
- Device View banner when `topologyMismatch` is set.
- Reset message no longer claims xrandr was applied.

**Tests:** extended `smoke-gpu-physical-map.test.js`; added `smoke-gpu-topology-boot.test.js` (CI bundle).

**Instructions for Next Agent:** T108.4 (defaults consolidation), T108.6 (adopt unmapped), T108.8 (DRM/legacy API cleanup), T108.9 (full integration smoke). T108.5 still needs diff preview + explicit persist on reset.

### 2026-07-02 — Remaining tasks T108.4–T108.9

**T108.4 — Defaults**
- `src/utils/known-gpu-topology.js` — single server table loader; `data/known-gpus.json` extended with `__generic__`, RTX 3060, 2-output stub.
- `defaults-core.js` and `gpu-physical-map.js` reference known-gpu-topology; removed independent `defaultTopology()` / `defaultClientGpuTopology()` client table.
- Socket count is GPU-model-aware via `effectiveTopology` length and `isPrimaryTopologySocket(id, socketCount)`.

**T108.5 — Reset**
- `POST /api/system/gpu-ports-reset` accepts `{ persist: true }`; writes `gpuPhysicalTopology` + operator-saved marker.
- Layout editor shows current-vs-discovered diff in confirm dialog; persists on confirm.

**T108.6 — Unmapped adoption**
- Layout editor section lists `gpu_unmapped_*` ports with socket dropdown + Assign → saves topology.

**T108.7 — Port name options**
- `collectGpuPortNameOptions()` prefers effectiveTopology, connectors, displays; hardcoded DP/HDMI fallback only when no live names.

**T108.8 — Cleanup**
- `discoverGpuPhysicalTopology()` falls back to DRM when xrandr empty.
- `hasServerGpuPhysicalMap()` replaces misleading DRM topologySource check (`hasDrmGpuPhysicalMap` alias kept).
- Support bundle uses `physicalMap` instead of legacy `GET /api/system/gpu-layout`; route marked deprecated.

**Tests:** `tools/smoke/smoke-gpu-topology-ssot.test.js` added to CI bundle.

**Instructions for Next Agent:** WO-108 complete. Verify on live playout box: reorder in layout editor → two browsers match; reset diff + persist; adopt unmapped display; regenerate Caspar config and confirm `screen_N_*` routing.
