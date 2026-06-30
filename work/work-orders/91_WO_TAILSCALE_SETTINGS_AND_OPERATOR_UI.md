# Work Order 91: Tailscale — Settings modal control + operator-monitor login

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress (Phase A–D shipped; live QA **T91.C4** pending)  
**Priority:** High (remote admin reachability; today requires SSH + `sudo tailscale up`)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on:**
- [61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md](./61_WO_RSYNC_PEER_SYNC_AND_NETWORK_SETTINGS.md) — §5 Tailscale tasks (T2.1–T2.5); this WO adds **operator-monitor UX** and **Local API** detail
- [39_WO_SETTINGS_SYSTEM_HARDWARE.md](./39_WO_SETTINGS_SYSTEM_HARDWARE.md) — Settings modal tabs, `sudo -n` + nuclear password pattern
- [73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md](./73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md) — `DISPLAY :0` GUI spawn pattern
- [87_WO_OPERATOR_POINTER_CONFINE.md](./87_WO_OPERATOR_POINTER_CONFINE.md) — operator monitor is the primary interactive head

**Related:**
- [`docs/HIGHASCG_PASSWORDLESS_SUDO.md`](../../docs/HIGHASCG_PASSWORDLESS_SUDO.md) — existing `sudo tailscale up` note
- `src/api/routes-system-setup.js` — read-only `GET /api/system/setup` tailscale block today
- `client/setup.html` — standalone setup page (CLI-only Tailscale instructions)
- `src/system/private-secrets-export.js` — exports tailnet status snapshot (not auth state)

**Implementation note:** WO-61 bundles Tailscale with Syncthing + rsync under a **Network sync** tab. WO-91 may ship **first** as a focused **Tailscale** pane (subset of WO-61 T2.x + T4.x) or land when WO-61 Settings tab is built — avoid duplicate APIs; prefer one module `src/network/tailscale-service.js` shared by both WOs.

---

## 1. Problem statement

| Gap | Today | Impact |
|-----|-------|--------|
| **No Settings control** | Tailscale status only on `setup.html` + `GET /api/system/setup` | Operators must SSH to run `sudo tailscale up` |
| **No login URL in UI** | CLI prints auth URL to terminal | Headless / booth rigs miss the URL unless someone is on SSH |
| **No operator-monitor assist** | No spawn of browser on `:0` for OAuth | Login blocked when only the playout monitor is available |
| **Unstructured status** | Shell `execSync('tailscale status')` | Fragile parsing; misses prefs / health JSON |
| **No persisted enable policy** | `tailscaled` state excluded from ISO squashfs | Fresh stick always needs manual login; no “enable on boot” toggle in config |

**Goal:** Make Tailscale **configurable from the Web client Settings modal** (enable, login, status, common prefs) and **spawn the login flow on the operator monitor** when interactive auth is required — using Tailscale’s **Local API** / structured CLI where possible, not scraping stderr.

---

## 2. Tailscale integration surfaces

### 2.1 Local API (preferred server backend)

`tailscaled` exposes a Unix-socket HTTP API (Linux: typically **`/run/tailscale/tailscaled.sock`**).

| Endpoint | Method | Use in HighAsCG |
|----------|--------|-----------------|
| `/localapi/v0/status` | GET | Connected, tailnet IP, peers, `BackendState`, auth URL when pending |
| `/localapi/v0/login-interactive` | POST | Start browser/OAuth login (same as `tailscale up` interactive) |
| `/localapi/v0/prefs` | GET/POST | Hostname, route acceptance, shields-up, etc. (v1 subset) |
| `/localapi/v0/logout` | POST | Optional v1.1 — with confirm |

**Request rules:** `Host: local-tailscaled.sock`; access via Unix socket (Node: `http.request({ socketPath })` or thin wrapper). Prefer Local API over parsing `tailscale status` text.

**CLI fallback:** `tailscale status --json`, `tailscale ip -4`, `tailscale up --json` when socket permissions block Node (document `tailscale` group or sudo helper).

### 2.2 Config persistence

New file: **`config/tailscale.json`** (or `config/network-sync.json` if WO-61 lands first):

```json
{
  "enabled": true,
  "autoLoginOnBoot": false,
  "hostname": "",
  "acceptRoutes": false,
  "operatorLoginAssist": true
}
```

| Key | Meaning |
|-----|---------|
| `enabled` | `systemctl enable --now tailscaled` vs stop/disable |
| `autoLoginOnBoot` | If `needsLogin` at highascg start, call `login-interactive` once |
| `hostname` | Optional `--hostname=` on `tailscale up` |
| `acceptRoutes` | `--accept-routes` |
| `operatorLoginAssist` | Spawn browser on operator `:0` when auth URL available |

**Security:** Never store OAuth tokens in HighAsCG config; `tailscaled` keeps state under `/var/lib/tailscale` (excluded from ISO per eggs fragment).

---

## 3. Settings modal UX

Add section under **Settings** — either:

- **Option A (recommended for WO-91 alone):** new tab **`network`** or sub-panel under **Diagnostics** labelled **Tailscale**
- **Option B (WO-61):** **Network sync** tab → Tailscale section first; Syncthing/rsync follow

### 3.1 Panel contents

| Control | Behaviour |
|---------|-----------|
| **Installed / running** | From `tailscaled` systemd + `which tailscale` |
| **Enable Tailscale** | Toggle → start/stop `tailscaled`; persist `enabled` |
| **Status** | Tailnet IPv4, machine name, backend state (`Running`, `NeedsLogin`, …) |
| **Log in** | `POST /api/network/tailscale/login` → starts interactive login; show **auth URL** + **Copy** + **Open on this computer** (remote browser) |
| **Open on operator monitor** | `POST /api/network/tailscale/login-operator-ui` → spawn Firefox (or `$HIGHASCG_BROWSER`) on **`DISPLAY=:0`** with auth URL — only when `operatorLoginAssist` and X session active |
| **Admin console** | Link `https://login.tailscale.com/admin/machines` |
| **Advanced (collapsed)** | Hostname, accept routes — maps to prefs / `tailscale up` flags |

**Password gate:** Reuse nuclear password for enable/disable/login/logout when `ui.nuclearRequirePassword` (same as WO-39 / WO-73).

### 3.2 Polling

After **Log in**, UI polls `GET /api/network/tailscale/status` every **3s** until `connected` or **120s** timeout — show QR-friendly URL if Tailscale provides one in status JSON.

---

## 4. Operator-monitor login spawn

When `NeedsLogin` and operator has a physical monitor (nodm `:0`):

```
Settings "Log in" OR boot autoLoginOnBoot
        │
        ▼
POST /localapi/v0/login-interactive  (or sudo tailscale up)
        │
        ▼
Parse AuthURL from status JSON
        │
        ├── Remote Web UI: show link + copy
        └── operatorLoginAssist:
              spawn on :0 (reuse gui-launch pattern from routes-system-hardware-gui.js)
              firefox --new-window '<AuthURL>'
              OR xdg-open with DISPLAY/XAUTHORITY from getXAuthority()
```

**Constraints:**
- Do **not** steal focus from Caspar multiview permanently — browser is a **temporary** window; optional auto-close on connect.
- Respect **WO-87** pointer confine — browser on operator head is OK; no global grab.
- If **no X session** (`display-mode` headless API-only), skip spawn; show URL in Settings only.

---

## 5. API (new routes)

Prefer **`src/api/routes-network-tailscale.js`** (thin) + **`src/network/tailscale-service.js`**:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/network/tailscale/status` | JSON status (Local API or `tailscale status --json`) |
| POST | `/api/network/tailscale/enable` | `{ enabled: boolean }` — systemd + config |
| POST | `/api/network/tailscale/login` | Start interactive login; return `{ authUrl?, state }` |
| POST | `/api/network/tailscale/login-operator-ui` | Login + spawn browser on `:0`; return `{ spawned, authUrl?, error? }` |
| POST | `/api/network/tailscale/prefs` | v1 subset: `{ hostname?, acceptRoutes? }` |
| POST | `/api/network/tailscale/logout` | v1.1 — optional |

Extend **`GET /api/system/setup`** to delegate to same service (avoid drift with `setup.html`).

**Sudo:** Narrow helpers only — `systemctl start tailscaled`, `tailscale up` with **fixed flag allow-list** (no arbitrary argv from client). Document in `HIGHASCG_PASSWORDLESS_SUDO.md`.

---

## 6. Tasks

### Phase A — Server service + Local API

- [x] **T91.A1** `src/network/tailscale-service.js` — status via Local API socket; CLI JSON fallback.
- [x] **T91.A2** `config/tailscale.json` + load/save module.
- [x] **T91.A3** `routes-network-tailscale.js` — GET status, POST enable, POST login.
- [x] **T91.A4** Sudoers fragment: `tailscale up`, `systemctl … tailscaled` (deb + snap unit names).
- [x] **T91.A5** Smoke: `tools/smoke/smoke-tailscale-status.test.js` — mock socket or skip-if-no-tailscale.

### Phase B — Settings modal UI

- [x] **T91.B1** Templates: Tailscale panel in `settings-modal-templates.js` (tab or Diagnostics subsection).
- [x] **T91.B2** `settings-modal-tailscale.js` — fetch, toggle, login, poll, copy URL.
- [x] **T91.B3** Wire save/apply for prefs; nuclear password prompts.
- [x] **T91.B4** Update `setup.html` to use `/api/network/tailscale/status` (shared data shape).

### Phase C — Operator-monitor spawn

- [x] **T91.C1** `spawnOperatorTailscaleLogin(authUrl)` — `DISPLAY=:0`, `XAUTHORITY`, allow-listed browser binary.
- [x] **T91.C2** `POST …/login-operator-ui` + Settings button **Open on operator monitor**.
- [x] **T91.C3** Boot hook: if `autoLoginOnBoot` && `NeedsLogin` → login + optional spawn (log, do not block `highascg.service`).
- [ ] **T91.C4** Live QA on playout box with DP operator head.

### Phase D — Docs + WO-61 alignment

- [x] **T91.D1** `docs/reference/tailscale-integration.md` — Local API, config keys, operator spawn.
- [x] **T91.D2** Mark WO-61 **T2.1–T2.5** as satisfied or delegated to WO-91 in WO-61 Work Log.
- [x] **T91.D3** Wiki API page: network tailscale routes (`docs/wiki/api/network-tailscale.md`).

---

## 7. Acceptance criteria

1. Operator enables Tailscale and completes login **from Settings** without SSH (auth URL visible in UI).
2. On a rig with operator monitor, **Open on operator monitor** opens the Tailscale login page on `:0`.
3. Status shows tailnet **100.x** IPv4 and machine name after connect.
4. `GET /api/system/setup` and `setup.html` show the same status as `/api/network/tailscale/status`.
5. No tailscale auth keys / state files committed or exposed via API (redact per `src/support/redact-settings.js`).
6. Privileged actions use **allow-listed** commands only (WO-39 security model).

---

## 8. Non-goals (v1)

- Tailscale ACL / policy editor in HighAsCG (admin console link only).
- MagicDNS / subnet router full wizard (prefs subset only).
- Replacing Syncthing or rsync (see WO-61).
- Storing `tailscaled.state` on exFAT private volume (status snapshot only — existing `private-secrets-export.js`).

---

## 9. Related files

| Area | Files |
|------|--------|
| Read-only today | `src/api/routes-system-setup.js`, `client/setup.html` |
| GUI launch pattern | `src/api/system-hardware-gui.js`, `src/utils/hardware-info.js` |
| Settings modal | `client/components/settings-modal-templates.js`, `settings-modal.js` |
| Private export | `src/system/private-secrets-export.js` |
| Sudo docs | `docs/HIGHASCG_PASSWORDLESS_SUDO.md` |
| ISO exclude | `tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list` (tailscale state) |

---

## Work Log

### 2026-06-30 — Phase D docs (agent)

**Work Done:**
- **T91.D2:** WO-61 §5 Tailscale tasks T2.1–T2.4 marked done/delegated; T2.5 left optional.
- **T91.D3:** `docs/wiki/api/network-tailscale.md`; cross-links in `system-settings-hardware.md`, wiki index, `wiki-pages.config.js`.

**Instructions for Next Agent:** **T91.C4** live QA on playout box. WO-91 code complete pending field verification.

### 2026-06-30 — Phase A–C shipped (agent)

**Work Done:**
- `src/network/tailscale-service.js` — Local API / CLI status, enable, login, operator Firefox spawn, boot auto-login.
- `src/api/routes-network-tailscale.js` + router wiring; `GET /api/system/setup` uses shared summary.
- Settings → **Tailscale** tab (`settings-modal-tailscale.js`); updated `setup.html`.
- `config/tailscale.json`, docs `docs/reference/tailscale-integration.md`, smoke `smoke-tailscale-status.test.js`.
- `highascg-launch-operator-firefox.sh` accepts optional login URL argument.

**Instructions for Next Agent:** Live QA **T91.C4** on playout box (login + operator monitor). Confirm passwordless sudo for `tailscale up` / `systemctl` on field image. Delegate WO-61 T2.x in WO-61 log.

### 2026-06-30 — Work order created (agent)

**Work Done:**
- Drafted WO-91 from user request for configurable Tailscale + operator-monitor login.
- Documented Tailscale Local API endpoints (`/localapi/v0/status`, `login-interactive`, `prefs`).
- Cross-linked WO-61 §5 to avoid duplicate implementation paths.

**Instructions for Next Agent:**
1. Implement **T91.A1–A3** first (service + routes) — unblocks UI and setup.html parity.
2. Decide tab placement with user: standalone **network** tab vs WO-61 **Network sync** shell.
3. For operator spawn, reuse **`POST /api/system/gui-launch`** allow-list or extend with `firefox` + URL only from server-generated auth URL (never client-supplied URL).
4. Test on rig with both **deb** and **snap** `tailscaled` if field images differ.

---
*Work Order created: 2026-06-30 | Series: HighAsCG network / remote admin*
