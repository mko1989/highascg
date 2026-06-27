# Work Order 59: Device View — server inspector redo (project frame rate + network)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** In progress  
**Priority:** High (operator rig setup — stale inspector blocks day-one configuration)  
**Related:** [33_WO_DEVICE_VIEW_INDEX.md](./33_WO_DEVICE_VIEW_INDEX.md), [33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md), [33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md](./33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md), [40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md), [55_WO_DECKLINK_OUTPUT_STANDARD_RESOLUTION_INHERIT.md](./55_WO_DECKLINK_OUTPUT_STANDARD_RESOLUTION_INHERIT.md), [docs/HIGHASCG_PASSWORDLESS_SUDO.md](../../docs/HIGHASCG_PASSWORDLESS_SUDO.md)

**Supersedes / replaces (UI only):** most of today’s **Caspar host setup** block in `device-view-inspector-caspar.js` — AMCP host/port, OSC, per-screen mode text fields, build profile, browser monitor, Companion deep-link, and “Save Caspar host setup” are **stale or duplicated** elsewhere and must be **removed** from the server inspector.

---

## 1. Goal

When the operator clicks the **whole Caspar / HighAsCG server** (rear-panel band click → `selectDevice(CASPAR_HOST)`) or selects the server device in Device View, show a **minimal, authoritative server inspector** with only:

1. **Read-only host identity** (hostname, platform, AMCP connection state — informational).
2. **Default project frame rate** — one project-wide setting that drives sensible defaults everywhere else.
3. **Network** — configure the **active Ethernet** interface: **DHCP (auto)** vs **static (manual)** IP, with optional **interface dropdown** when multiple NICs exist.
4. **Factory reset** — keep existing purge behaviour (only destructive action retained from current inspector).

Everything else currently in `renderCasparSettingsInspector` is **out of scope for this panel** and should be removed (settings live in per-output inspectors, Settings modal, or dedicated WO surfaces).

---

## 2. Product behaviour (normative)

### 2.1 Default project frame rate

| Requirement | Detail |
|-------------|--------|
| **Storage** | New persisted field, e.g. `machineProfile.defaultProjectFps` or `casparServer.default_project_fps` in `highascg.config.json` (pick **one** canonical key; document in schema). |
| **UI control** | Dropdown of **standard broadcast frame rates**: at minimum **23.98, 24, 25, 29.97, 30, 50, 59.94, 60** (Hz). Label: **“Default project frame rate”**. |
| **Default on fresh install** | **50** (matches current `FALLBACK_RESOLUTION.fps` and common EU broadcast rigs). |
| **Output mode defaults** | When project fps changes (or on first apply), **new** output video-mode selections should default to modes matching that fps (e.g. 50 → `1080p5000`, `720p5000`; 59.94 → `1080p5994`, etc.). Use existing `STANDARD_VIDEO_MODES` / `CASPAR_VIDEO_MODE_SPECS` in `device-view-destinations-inspector.js` — **filter or rank** by fps, do not fork a second mode list. |
| **Per-output override** | Each GPU / DeckLink / screen destination inspector **keeps** its own mode dropdown; changing project fps does **not** silently overwrite outputs the operator already customized. Only **unset** / **still-at-default** outputs pick up the new default. Define “still-at-default” precisely in implementation (e.g. mode matches previous project fps bucket, or explicit `inheritsProjectFps: true` flag on destination). |
| **Downstream consumers** | Project fps must feed: `channelMap.programResolutions[].fps`, timeline default fps, transition duration auto (`fps/2` sentinel — see `client/lib/transition-duration.js`), and Caspar config generator where channel raster fps is derived. **Single source of truth** on server; client reads via settings + WS state. |

### 2.2 Network (Ethernet IP)

| Requirement | Detail |
|-------------|--------|
| **Scope v1** | **IPv4** on **wired Ethernet** only (`eth*`, `enp*`, `eno*` — document chosen filter). Wi‑Fi / Tailscale / loopback out of scope unless read-only display. |
| **Interface picker** | Dropdown of discovered interfaces (from server inventory). **Active** interface = currently carrying default route or user-selected “primary NIC”. |
| **Mode** | **Auto (DHCP)** vs **Manual (static)**. |
| **Manual fields** | IP address, subnet mask (or prefix length — pick one UX), gateway, optional DNS (primary; secondary optional). |
| **Apply** | **Apply network** button runs audited root helper (see §4); show success/error + current addresses after apply. |
| **Read-only summary** | Always show current IPv4, MAC, link state, and whether config is DHCP or static (parsed from backend). |

### 2.3 Inspector layout (server)

Replace `renderCasparSettingsInspector` content with roughly:

```text
┌─ Server ─────────────────────────────
│ Hostname / platform / AMCP connected
├─ Project ────────────────────────────
│ Default project frame rate [50 ▼]
│ (note: outputs inherit until customized)
├─ Network ──────────────────────────
│ Interface [eth0 ▼]
│ Mode ( ) Auto (DHCP)  ( ) Manual
│ [ IP / mask / gateway / DNS when Manual ]
│ [ Apply network ]
├─ Danger zone ──────────────────────
│ [ Factory reset ]
└──────────────────────────────────────
```

**Remove** from this inspector: AMCP host/port editors, OSC toggles, per-screen mode text inputs, Caspar build profile, browser monitor, “Settings → Companion”, generic “Save Caspar host setup”.

---

## 3. Current state (baseline)

| Area | Today | Problem |
|------|--------|---------|
| **Server click** | `device-view-caspar-render.js` band click → `selectDevice(CASPAR_HOST)` | Correct entry point; wrong inspector content |
| **Inspector** | `client/components/device-view-inspector-caspar.js` | Mixes stale Caspar/OSC/screen/build-profile fields with factory reset |
| **Device summary** | `device-view-inspector-render.js` `renderDeviceInspector` | Read-only rows for host — **not** shown when `CASPAR_HOST` selected (caspar path bypasses it) |
| **Output fps** | Per-destination `STANDARD_VIDEO_MODES` in GPU/DeckLink inspectors | No project-wide default; operators set modes independently |
| **Project fps in client** | `scene-state` / `channelMap.programResolutions[].fps`, `transition-duration.js` | Derived from output modes, not a first-class “project fps” setting |
| **Network** | `system-inventory-file.js` collects IPv4 list; no apply API | Read-only; no UI for static/DHCP |
| **Privileged apply** | `docs/HIGHASCG_PASSWORDLESS_SUDO.md` | No network helper yet |

---

## 4. Architecture

### 4.1 Settings / API

```text
highascg.config.json
  machineProfile.defaultProjectFps: 50
  network.primaryInterface: "eth0"
  network.mode: "dhcp" | "static"
  network.static: { address, netmask|prefix, gateway, dns[] }  // when static

GET  /api/system/network          → interfaces[], active, current config, applied state
POST /api/system/network/apply    → { interface, mode, static? }  → sudo helper
POST /api/settings                → merge defaultProjectFps (existing settings path)
```

- **Do not** accept arbitrary shell from the client.
- **Allow-list** interface names server-side (regex `^(eth|enp|eno)[0-9]+$` or similar).
- Validate IPv4 dotted-quad + mask/prefix before calling helper.

### 4.2 Root helper + sudoers (required for network apply)

Add **`/usr/local/lib/highascg/network-apply.sh`** (name TBD):

- Inputs: fixed args or JSON file path under `/run/highascg/` written by Node (mode, iface, static fields).
- Implementation target: **Netplan** (`/etc/netplan/*.yaml`) on Ubuntu live image **or** **`nmcli`** if NetworkManager owns interfaces — **Phase 0 spike** must record which stack the live USB image uses and implement **one** path only.
- Log stdout/stderr for API response.
- **`sudo -n`** only; document new fragment in `docs/HIGHASCG_PASSWORDLESS_SUDO.md`:

```text
casparcg ALL=(root) NOPASSWD: /usr/local/lib/highascg/network-apply.sh
```

Install hook: `scripts/install-phase4.sh` (or sibling) copies script + sudoers fragment.

**Security:** helper must reject unknown interfaces, reject multi-line injection in IP fields, and never execute user-provided commands.

### 4.3 Project fps propagation

```text
User sets defaultProjectFps in server inspector
  → POST /api/settings (machineProfile)
  → server normalizes settings + regenerates channelMap.programResolutions fps where inherited
  → WS broadcast settings / channelMap change
  → client sceneState.setCanvasResolutions, timeline defaults, transition auto duration
  → output inspectors show pre-selected modes matching fps for unset destinations only
```

Reuse **`src/config/config-modes.js`** and client **`CASPAR_VIDEO_MODE_SPECS`** — add shared helper `modesForProjectFps(fps)` if needed (server + client or server-only with API).

---

## 5. Tasks (checklist)

### Phase 0 — Discovery

- [x] **T59.0.1** Confirm live-image network stack (Netplan vs NetworkManager vs `/etc/network/interfaces`) and document in Work Log.
- [x] **T59.0.2** Inventory which fields in `device-view-inspector-caspar.js` are still referenced elsewhere; confirm safe removal list.

### Phase 1 — Server inspector UI redo

- [x] **T59.1.1** Replace `renderCasparSettingsInspector` with new layout (§2.3); **keep factory reset** only from legacy actions.
- [x] **T59.1.2** Merge read-only host summary into server inspector (hostname, platform, AMCP connected) — avoid duplicate empty `renderDeviceInspector` path for `CASPAR_HOST`.
- [x] **T59.1.3** Remove stale controls: AMCP/OSC/screen mode text/build profile/browser monitor/Companion link/generic save.
- [x] **T59.1.4** CSS pass: `device-view__server-inspector` section spacing consistent with other inspectors (WO-41 polish patterns).

### Phase 2 — Default project frame rate

- [x] **T59.2.1** Add `defaultProjectFps` to settings schema + `normalizeSettings` / defaults in `src/config/`.
- [x] **T59.2.2** Server: apply inherited fps to `programResolutions` and Caspar config generator when destinations use default inheritance rules.
- [x] **T59.2.3** Client: GPU/DeckLink/screen destination inspectors — default mode dropdown to best match `defaultProjectFps` when output has no explicit override.
- [x] **T59.2.4** Client: wire `sceneState`, timeline, transition auto duration to resolved project fps from settings/state (not hardcoded 50 when setting exists).
- [x] **T59.2.5** Migration: existing installs without `defaultProjectFps` → infer from `screen_1_mode` / first program resolution, else 50.

### Phase 3 — Network

- [x] **T59.3.1** Server: `GET /api/system/network` — enumerate interfaces, current addresses, DHCP vs static hint.
- [x] **T59.3.2** Root helper + sudoers + install hook (§4.2).
- [x] **T59.3.3** Server: `POST /api/system/network/apply` with validation + `sudo -n` wrapper.
- [x] **T59.3.4** Client: network section in server inspector (interface dropdown, auto/manual, apply, status/errors).
- [x] **T59.3.5** Document NOPASSWD in `docs/HIGHASCG_PASSWORDLESS_SUDO.md`; add smoke test or manual QA steps for DHCP→static→DHCP on lab NIC.

### Phase 4 — Docs & migration notes

- [x] **T59.4.1** Update WO-33f settings migration matrix: “Caspar host setup” fields **removed** from Device View server inspector; deep-link to Settings only where still needed (AMCP connection if retained there).
- [ ] **T59.4.2** Operator doc snippet: “Set project frame rate and network on Device View → click server.”

---

## 6. Success criteria

1. Clicking the **server rear panel** opens the **new** inspector (not legacy Caspar host setup form).
2. Inspector contains **only**: host summary, project fps, network, factory reset.
3. Changing project fps to **50** causes **new** outputs to default to **1080p5000-class** modes; existing customized outputs unchanged.
4. Network apply works via **`sudo -n`** without interactive password on installed rig.
5. Invalid IP / unknown interface rejected with clear UI error — no shell injection.
6. Factory reset still purges config and reloads (regression test).

---

## 7. Non-goals (this WO)

- Wi‑Fi configuration, Tailscale login, or firewall rules.
- IPv6.
- Moving **per-output** DeckLink/GPU advanced settings into the server inspector (stay on connector inspectors).
- Removing AMCP host/port from **Settings → Connection** (may remain; just not duplicated in Device View server inspector).
- Automatic network apply on boot without user confirmation.

---

## 8. Related files (starting points)

| Layer | Path |
|-------|------|
| Server inspector (replace) | `client/components/device-view-inspector-caspar.js` |
| Server select / band click | `client/components/device-view.js`, `client/components/device-view-caspar-render.js` |
| Device summary (reference) | `client/components/device-view-inspector-render.js` |
| Video modes / fps map | `client/components/device-view-destinations-inspector.js`, `src/config/config-modes.js` |
| Transition auto fps/2 | `client/lib/transition-duration.js`, `client/lib/scene-state.js` |
| Settings persist | `src/api/routes-settings.js`, `src/config/settings-normalize.js` (or equivalent) |
| Network inventory | `src/bootstrap/system-inventory-file.js`, `src/utils/lan-ipv4.js` |
| Sudo pattern | `src/api/routes-system-setup.js`, `scripts/install-phase4.sh`, `docs/HIGHASCG_PASSWORDLESS_SUDO.md` |
| Factory reset | `client/components/device-view-actions.js` → `factoryResetConfig()` |

---

## 9. Manual QA checklist

- [ ] Fresh config: server inspector shows fps **50**, network **Auto**, factory reset present.
- [ ] Set project fps **59.94** → add new DeckLink output → mode defaults to 59.94-family; change existing output unchanged.
- [ ] Set manual IP on `eth0` → apply → `ip addr` / UI matches; AMCP/Web UI still reachable.
- [ ] Revert to DHCP → apply → address from router.
- [ ] Factory reset → config cleared, page reload, defaults restored.
- [ ] Sudoers missing → apply shows actionable error (not hang).

---

## Work Log

### 2026-06-27 — WO drafted (operator request)

**Work done:**
- Drafted WO-59 from operator request: redo Device View **server** inspector; remove stale Caspar host fields except factory reset; add **default project frame rate** and **Ethernet IP (auto/manual)** with passwordless sudo helper for network apply.
- Mapped current code paths (`selectDevice(CASPAR_HOST)`, `device-view-inspector-caspar.js`) and related fps/mode/network inventory.

**Status:** Draft — no implementation started.

**Instructions for Next Agent:** Run **T59.0.1** (Netplan vs NM on live image). Then **T59.1.1** UI skeleton with factory reset preserved; wire project fps persist before network apply.

---

### 2026-06-27 — Agent (WO-59 implementation pass 1)

**Work done:**
- **Phase 0:** Live image uses **NetworkManager** (`nmcli` active; netplan YAML present). Stale `device-view-inspector-caspar.js` fields removed from server inspector only (still available in Settings elsewhere).
- **Phase 1:** Rewrote `renderCasparSettingsInspector` — host summary, project fps, network, factory reset only.
- **Phase 2:** Added `machineProfile.defaultProjectFps` + `src/config/project-fps.js`; settings GET/POST; `applyProjectFpsToInheritedOutputs` updates inherited `screen_N_mode`, multiview, and destinations with `inheritsProjectFps`; `channel-map-from-ctx` uses project fps when Caspar INFO unavailable.
- **Phase 3:** `GET /api/system/network`, `POST /api/system/network/apply`, `tools/runtime/highascg-network-apply.sh` (nmcli), smoke test `tools/smoke/smoke-project-fps-network.test.js`, sudoers doc snippet.
- **Remaining:** T59.1.4 CSS polish; T59.2.3 per-output inspector default mode on *new* destinations; T59.3.5 install-hook in `install-phase4.sh`; T59.4 docs/migration matrix.

**Instructions for Next Agent:** Install network sudoers on rig and QA DHCP/static. Wire `defaultVideoModeForProjectFps` into destination creation paths in GPU/DeckLink inspectors (T59.2.3). Add installer copy of `highascg-network-apply.sh`.

---

### 2026-06-27 — Agent (WO-59 implementation pass 2)

**Work done:**
- **CSS:** `device-view__server-inspector` sections, fields, danger zone in `09b3-device-view-inspector-sidebar.css`.
- **Installer:** `scripts/runtime/install-network-apply.sh` + hook in `install-phase4.sh`.
- **Project fps propagation:** new destinations use project default mode (server + client); screen consumer seed includes `screen_N_mode`; GPU video modeline / cable inherit use `resolveDefaultVideoMode`; settings-state defaults for `machineProfile` + `network`.
- **Docs:** WO-33f migration matrix row for WO-59 server inspector; npm script `smoke:project-fps-network`.

**Instructions for Next Agent:** Run `sudo bash scripts/runtime/install-network-apply.sh casparcg` on rig; manual QA network apply. Optional: T59.4.2 operator doc snippet.

---

*Work Order created: 2026-06-27 | Series: HighAsCG Device View | Related: 33, 33f, 40, 55*
