# Work Order 73: Calamares on ISO, systemd Caspar stack, Nuclear install + Caspar control

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** Phase A–D implemented (2026-06-28) — ISO Calamares hook, systemd Caspar units, Nuclear UI + API  
**Priority:** **High** — blocks “pro” install-from-live-USB workflow and headless service model  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md](./11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md) — service integration, headless CLI
- [12_WO_PRODUCTION_INSTALLER.md](./12_WO_PRODUCTION_INSTALLER.md) — production install phases, Openbox autostart history
- [39_WO_SETTINGS_SYSTEM_HARDWARE.md](./39_WO_SETTINGS_SYSTEM_HARDWARE.md) — Nuclear password, `DISPLAY :0` GUI launches
- [47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md](./47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md) — boot ordering vs `highascg.service`
- [69_WO_CLEAN_SLATE_FULL_RESET.md](./69_WO_CLEAN_SLATE_FULL_RESET.md) — Nuclear tab patterns (confirm + password gate)

**Operator docs (update when shipped):**
- `docs/LIVE_USB_IMAGE.md` — § Calamares / permanent install
- `docs/ISO_CONTENTS.md` — systemd stack table
- `docs/HIGHASCG_PASSWORDLESS_SUDO.md` — new NOPASSWD lines
- `docs/wiki/api/system-settings-hardware.md` — already lists `POST /api/system/setup/install` (wire UI + status)

---

## 1. Problem statement

| Gap | Today | Impact |
|-----|-------|--------|
| **Calamares not on eggs clone host** | `eggs produce` / audit reports Calamares not installed | Live ISO cannot offer graphical **install to disk** — core “pro” deliverable |
| **Install launcher only via CLI** | `POST /api/system/setup/install` runs `sudo -n eggs calamares` with `DISPLAY=:0` — **no Nuclear UI button** | Operators must SSH or know eggs CLI |
| **CasparCG tied to Openbox autostart** | `~/.config/openbox/autostart` starts scanner + respawning `run.sh` loop; **`casparcg-server.service` explicitly removed** in `scripts/setup/08-caspar-cef-scanner.sh` | No clean stop/start; headless rigs still need nodm+X for playout; autorestart loop fights intentional shutdown |
| **No “stop Caspar without respawn”** | Openbox `CASPAR_RESPAWN=1` loop | Cannot pause playout for maintenance, driver work, or Calamares install prep without killing autostart or fighting respawn |
| **HighAsCG already systemd; Caspar not** | `highascg.service` after WO-47 chain | Inconsistent lifecycle; `highascg` can run headless but Caspar cannot |

**Goal:** Ship a **production-grade lifecycle** where:

1. **Eggs ISO** includes Calamares + eggs calamares integration so an operator can **install HighAsCG to internal disk** from a connected screen.
2. **Web UI → Settings → Nuclear** exposes **Launch disk installer (Calamares)** with the same password gate as reboot.
3. **CasparCG Server** and **casparcg-scanner** run as **systemd user or system units**, independent of Openbox, with explicit **stop / start / restart** API + Nuclear controls.
4. **Headless mode** is first-class: nodm+X optional (DeckLink GUI, Calamares, nvidia-settings); playout stack runs without window manager autostart.

---

## 2. Product behaviour (normative)

### 2.1 Eggs / ISO — Calamares baked in

| Item | Requirement |
|------|-------------|
| **Packages on build host before `eggs produce --clone`** | Calamares stack required by penguins-eggs (`calamares`, `calamares-settings-ubuntu`, `calamares-settings-eggs` or distro equivalents — verify against installed `eggs` version docs) |
| **Prepare script** | `prepare-eggs-clone-with-exfat.sh` (or dedicated `install-eggs-calamares.sh`) **apt-installs** missing Calamares deps and fails audit if still absent |
| **Audit** | `audit-eggs-clone-host.sh` — **fail** (strict) when `/usr/bin/calamares` or `eggs calamares --help` unavailable |
| **Squashfs verify** | `verify-iso-squashfs-excludes.sh` — optional check that `/usr/bin/calamares` present when `HIGHASCG_ISO_EMBED_CALAMARES=1` (default **1**) |
| **Theme** | Reuse existing `tools/eggs/live-usb/highascg-eggs-theme/theme/calamares/` branding (already in repo) |
| **Operator path** | Boot live USB → open display (nodm :0) → **Settings → Nuclear → Install to disk** *or* desktop/menu entry → Calamares wizard → reboot into installed system |

### 2.2 Nuclear tab — new actions

Add to **`settings-pane-nuclear`** (`settings-modal-templates.js`), grouped under **“Playout & system”**:

| Button | Behaviour |
|--------|-----------|
| **Install to disk (Calamares)** | `POST /api/system/setup/install` — launches Calamares on `:0`; show status in `#set-nuclear-status` |
| **Stop CasparCG** | Graceful stop — **no autorestart** until operator starts again |
| **Start CasparCG** | Start scanner (if down) + server from last config |
| **Restart CasparCG** | Controlled restart (stop → start), not Openbox respawn loop |

All four respect **`checkNuclearPassword`** when `ui.nuclearRequirePassword` is on (same as reboot).

**UX notes:**
- Disable **Install to disk** when Calamares not installed (`GET /api/system/setup` adds `calamares: { installed, launchable }`).
- **Stop CasparCG** copy: “Stops playout output until you start again — autorestart is off for this stop.”
- Show running state: `caspar: { scanner: 'active'|'inactive', server: 'active'|'inactive', respawnEnabled: boolean }`.

### 2.3 API (HighAsCG Node backend)

Extend **`src/api/routes-system-setup.js`** (or split `routes-caspar-service.js` if file grows):

| Method | Route | Body | Response |
|--------|-------|------|----------|
| GET | `/api/system/setup` | — | Add `calamares: { installed, binary, eggsAvailable }`, `casparService: { scanner, server, respawnEnabled }` |
| POST | `/api/system/setup/install` | `{ password? }` | **Exists** — harden: verify Calamares installed; set `DISPLAY`, `XAUTHORITY`, `WAYLAND_DISPLAY` empty; log stderr |
| POST | `/api/system/setup/caspar/stop` | `{ password? }` | Stop server + optionally scanner; set **inhibit autorestart** flag |
| POST | `/api/system/setup/caspar/start` | `{ password? }` | Clear inhibit; `systemctl start` caspar units |
| POST | `/api/system/setup/caspar/restart` | `{ password? }` | `systemctl restart` caspar server (scanner stays up unless configured otherwise) |

**Implementation preference:** delegate to **fixed-path helpers** under `scripts/runtime/` or `tools/runtime/` (audited shell), invoked via `sudo -n`, matching WO-39 / WO-69 security model.

### 2.4 Systemd — CasparCG + scanner as services

Replace Openbox autostart responsibility with units (names bikeshed — default below):

| Unit | Type | User | Notes |
|------|------|------|-------|
| `casparcg-scanner.service` | simple | `casparcg` | `/usr/bin/casparcg-scanner`; `After=network.target`; port **8000** |
| `casparcg-server.service` | simple | `casparcg` | Staged start script (see `tools/runtime/casparcg-staged-start.sh`) — config `~/highascg/config/casparcg.config`, CEF cache clear policy |
| `casparcg-server.service` **drop-in** | — | — | `Restart=on-failure` **or** `Restart=no` when inhibit flag set (see §3.3) |

**Ordering relative to HighAsCG:**

```text
network-online.target
  → home-casparcg-exfat.mount (WO-47, when stick present)
  → highascg-exfat-server-update.service
  → highascg-exfat-sync.service
  → casparcg-scanner.service
  → casparcg-server.service   # After=highascg.service OR After=config-ready — bikeshed in T73.C
  → highascg.service          # May start before Caspar if AMCP connect is lazy — document chosen order
  → nodm.service              # Optional — only when GUI needed
```

**Openbox autostart (after migration):**
- Remove Caspar scanner + respawn loop from `scripts/setup/09-openbox-autostart.sh` and `scripts/legacy/install-phase3.sh`.
- Keep: `xset`, `unclutter`, `highascg-nvidia-x-apply.sh` (X session tweaks only).
- Migration note on installed systems: install units + `systemctl disable` autostart Caspar lines (one-shot migration script).

### 2.5 Headless / “pro experience”

| Mode | Stack |
|------|-------|
| **Playout headless** | `casparcg-scanner` + `casparcg-server` + `highascg.service` — **no nodm required** |
| **GUI tools** | nodm :0 for Calamares, DeckLink setup, nvidia-settings — launch on demand from Settings tabs |
| **HIGHASCG_HEADLESS** | API-only debug — unchanged; Caspar still runs via systemd when playout headless |

---

## 3. Architecture

### 3.1 Calamares launch path

```text
Web UI Nuclear → POST /api/system/setup/install
    → checkNuclearPassword
    → scripts/runtime/launch-calamares.sh
        → verify /usr/bin/calamares OR /usr/bin/eggs calamares
        → export DISPLAY=:0 XAUTHORITY=/home/casparcg/.Xauthority
        → sudo -n /usr/bin/eggs calamares   (preferred on eggs images)
        → or sudo -n calamares -d
    → JSON { ok, action: 'install', pid? }
```

**Eggs produce prerequisite installer** (`tools/eggs/live-usb/install-eggs-calamares.sh`):

```bash
apt-get install -y calamares calamares-settings-ubuntu …  # exact list from eggs docs
eggs calamares --help  # must succeed
```

Called from `prepare-eggs-clone-with-exfat.sh` when `HIGHASCG_ISO_EMBED_CALAMARES=1` (default).

### 3.2 Caspar stop without autorestart

**Problem:** systemd `Restart=always` and Openbox `while CASPAR_RESPAWN` both fight “stop for maintenance”.

**Approach (v1 — pick one, document in code):**

**Option A (recommended):** systemd **`Restart=on-failure`** by default + **`systemctl stop casparcg-server.service`** for Nuclear stop. No respawn on clean stop. Optional **`/run/highascg/inhibit-caspar-autostart`** checked by a **Path=** unit or helper — only if we keep Openbox fallback during migration.

**Option B:** drop-in override `Restart=no` written by stop helper, removed by start helper.

Nuclear **Start** clears inhibit and runs `systemctl start casparcg-scanner.service casparcg-server.service`.

### 3.3 Openbox migration / backwards compatibility

| Phase | Behaviour |
|-------|-----------|
| **Dual-run guard** | During rollout, autostart script checks `systemctl is-active casparcg-server.service` — skip Openbox launch if service owns Caspar |
| **Clean cut** | Remove autostart Caspar lines once ISO + install.sh ship systemd units |
| **Installed base upgrade** | `scripts/setup/13-caspar-systemd-units.sh` — idempotent install + enable |

---

## 4. Implementation map

| Area | Path |
|------|------|
| Eggs Calamares install | `tools/eggs/live-usb/install-eggs-calamares.sh` **(new)** |
| Prepare hook | `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh` |
| Clone audit | `tools/eggs/live-usb/audit-eggs-clone-host.sh` |
| Squashfs verify | `tools/eggs/live-usb/verify-iso-squashfs-excludes.sh` |
| Calamares launcher | `scripts/runtime/launch-calamares.sh` or `tools/runtime/launch-calamares.sh` **(new)** |
| Caspar service control | `scripts/runtime/caspar-systemd-control.sh` **(new)** |
| systemd units | `scripts/systemd/casparcg-scanner.service`, `casparcg-server.service` **(new)** |
| Install on host | `scripts/setup/13-caspar-systemd-units.sh` **(new)** |
| Openbox trim | `scripts/setup/09-openbox-autostart.sh`, `scripts/legacy/install-phase3.sh` |
| API | `src/api/routes-system-setup.js` |
| Nuclear UI | `client/components/settings-modal-templates.js`, `settings-modal.js` |
| Sudoers | `scripts/setup/12-passwordless-sudo.sh`, `docs/HIGHASCG_PASSWORDLESS_SUDO.md` |
| Smoke | `tools/smoke/smoke-system-setup-caspar.test.js` **(new)** |
| Docs | `docs/ISO_CONTENTS.md`, `docs/openbox_autostart.md`, `docs/STICK_QUICK_START.md` (post-install note) |

---

## 5. Tasks

### Phase A — Eggs / ISO Calamares

- [x] **T73.A.1** Research exact Calamares package set for **penguins-eggs 26.x** on Ubuntu 24.04 — document in WO Work Log.
- [x] **T73.A.2** `install-eggs-calamares.sh` — apt install + `eggs calamares --help` verification.
- [x] **T73.A.3** Wire into `prepare-eggs-clone-with-exfat.sh` (`HIGHASCG_ISO_EMBED_CALAMARES=1`).
- [x] **T73.A.4** `audit-eggs-clone-host.sh` — strict fail if Calamares missing.
- [x] **T73.A.5** Optional squashfs presence check for `/usr/bin/calamares`.
- [ ] **T73.A.6** Rebuild ISO on build host; boot test → Calamares wizard reaches partition step.

### Phase B — API + Nuclear UI (Calamares + status)

- [x] **T73.B.1** Extend `GET /api/system/setup` with `calamares` + `casparService` blocks.
- [x] **T73.B.2** Harden `POST /api/system/setup/install` — preflight binary check, structured errors.
- [x] **T73.B.3** Nuclear tab: **Install to disk (Calamares)** button + wired handler in `settings-modal.js`.
- [x] **T73.B.4** Disable button + tooltip when `calamares.installed === false`.
- [ ] **T73.B.5** Update wiki `system-settings-hardware.md` with Nuclear entry point.

### Phase C — systemd Caspar + scanner

- [x] **T73.C.1** Author `casparcg-scanner.service` + `casparcg-server.service` (use existing staged start script).
- [x] **T73.C.2** `scripts/setup/13-caspar-systemd-units.sh` — install, enable, migrate away from autostart.
- [x] **T73.C.3** Trim Openbox autostart — X tweaks only; dual-run guard until migration complete.
- [x] **T73.C.4** Boot order integration with WO-47 units + `highascg.service` (document in unit comments).
- [x] **T73.C.5** Remove `rm -f casparcg-server.service` anti-pattern from `08-caspar-cef-scanner.sh` — replace with enable.

### Phase D — Nuclear Caspar stop / start / restart

- [x] **T73.D.1** `caspar-systemd-control.sh` — `stop|start|restart|status` subcommands.
- [x] **T73.D.2** API routes `POST /api/system/setup/caspar/{stop,start,restart}`.
- [x] **T73.D.3** Nuclear UI buttons + live status poll (or reuse `/api/state` extension).
- [x] **T73.D.4** NOPASSWD sudoers for systemctl + launcher scripts.
- [x] **T73.D.5** Smoke tests — mock systemctl or test in VM.

### Phase E — Docs & QA

- [ ] **T73.E.1** Update `ISO_CONTENTS.md` — Casamares + systemd Caspar table.
- [ ] **T73.E.2** Update `openbox_autostart.md` — “Caspar moved to systemd”.
- [ ] **T73.E.3** `STICK_QUICK_START.md` — optional “install to internal SSD” subsection.
- [ ] **T73.E.4** Manual QA matrix (below).

---

## 6. Security & sudoers

Add to `scripts/setup/12-passwordless-sudo.sh` (exact paths after helpers land):

| Command | Used by |
|---------|---------|
| `/usr/bin/eggs calamares` | Install launcher |
| `/usr/bin/calamares` | Fallback direct launch |
| `/bin/systemctl start\|stop\|restart casparcg-server.service` | Nuclear Caspar control |
| `/bin/systemctl start\|stop\|restart casparcg-scanner.service` | Nuclear Caspar control |
| `/usr/local/bin/launch-calamares.sh` | Optional wrapper |

All Nuclear POSTs reuse **`checkNuclearPassword`**.

---

## 7. Test plan

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `audit-eggs-clone-host.sh` on prepared build host | Calamares OK |
| 2 | Boot fresh ISO, Nuclear → Install to disk | Calamares GUI on :0 |
| 3 | Complete Calamares install to VM disk | Reboot into installed system; services enabled |
| 4 | Headless boot (nodm stopped) | `casparcg-server` + `highascg` active; AMCP playout works |
| 5 | Nuclear → Stop CasparCG | Server stops; **does not** respawn via Openbox or systemd |
| 6 | Nuclear → Start CasparCG | Server returns; same config path |
| 7 | Nuclear → Restart CasparCG | Brief outage; single restart |
| 8 | Calamares missing on dev host | Install button disabled; API 503 with clear error |
| 9 | Password gate on | Wrong password → 403 |

---

## 8. Open decisions (resolve in Phase A/C)

| ID | Question | Default recommendation |
|----|----------|------------------------|
| O1 | `casparcg-server` **Restart=** policy | `on-failure` — clean stop stays down |
| O2 | Stop scanner when stopping server? | **No** — stop server only; separate scanner restart rare |
| O3 | `highascg.service` before or after Caspar? | **After** WO-47 sync; Caspar **before** HighAsCG if Node connects AMCP at boot |
| O4 | Keep Openbox respawn as fallback one release? | **Dual-run guard** one cycle, then remove |
| O5 | Calamares via `eggs calamares` only vs direct `calamares` | **eggs calamares** on ISO; fallback direct on non-eggs installs |

---

## 9. Acceptance criteria

1. **`eggs produce` audit passes** with Calamares installed on clone host.
2. Operator can launch **Calamares from Web UI Nuclear tab** on live ISO with display attached.
3. **CasparCG + scanner** start at boot via **systemd**, not Openbox autostart (on new installs).
4. **Nuclear Stop CasparCG** stops playout **without autorestart**; **Start** brings it back.
5. **Headless playout** works with nodm disabled (document minimum services).
6. Docs and sudoers updated; smoke tests green.

---

## Work Log

### 2026-06-28 — Work order authored (planning agent)

**Work Done:**
- Captured operator requirements: Calamares missing at eggs produce; Nuclear install GUI; Caspar stop/start without Openbox respawn; migrate Caspar + scanner to systemd; headless-first pro lifecycle.
- Reviewed existing pieces: `POST /api/system/setup/install` (`eggs calamares`), Nuclear tab (reboot / restart WM only), Openbox autostart in `09-openbox-autostart.sh`, deliberate removal of `casparcg-server.service` in `08-caspar-cef-scanner.sh`, eggs Calamares theme under `highascg-eggs-theme`.
- Split implementation into Phases A–E with API, UI, systemd, and eggs audit tasks.

**Instructions for Next Agent:** Start **Phase A** — confirm Calamares package names for penguins-eggs 26.6.2 on this host (`apt-cache search calamares`, `eggs calamares --help`), implement `install-eggs-calamares.sh`, wire prepare + audit, rebuild ISO. Then **Phase C** systemd units before Nuclear Caspar buttons (API needs real stop/start). Wire **Phase B** Nuclear Calamares button once `GET /api/system/setup` reports `calamares.installed`.

### 2026-06-28 — Implementation (agent)

**Work Done:**
- **Phase A:** `tools/eggs/live-usb/install-eggs-calamares.sh` (`eggs calamares --install --nointeractive` + apt calamares); wired in `prepare-eggs-clone-with-exfat.sh`; audit + squashfs verify for `/usr/bin/calamares`.
- **Phase C:** `scripts/systemd/casparcg-{scanner,server}.service`, `scripts/setup/13-caspar-systemd-units.sh`, `08-caspar-cef-scanner.sh` installs units; `09-openbox-autostart.sh` dual-run guard (skip legacy run.sh when systemd owns Caspar); `run.sh` inhibit file + `CASPAR_SYSTEMD_SERVICE=1` (no SIGTERM relaunch).
- **Phase D:** `tools/runtime/caspar-systemd-control.sh`, `launch-calamares.sh`; extended `routes-system-setup.js` with caspar stop/start/restart + setup status; updated `12-passwordless-sudo.sh`.
- **Phase B:** Nuclear tab — Install to disk, Stop/Start/Restart CasparCG; status from `GET /api/system/setup`.
- **Tests:** `test/system-setup-caspar.test.js`.

**Packages (T73.A.1):** `calamares`, `calamares-settings-ubuntu-common`, plus `eggs calamares --install` for eggs policies/deps on penguins-eggs 26.6.2.

**Instructions for Next Agent:** On build host run `sudo bash tools/eggs/live-usb/install-eggs-calamares.sh` then `sudo npm run eggs:prepare` / produce (**T73.A.6**). On playout host run `sudo bash scripts/setup/13-caspar-systemd-units.sh` + `sudo bash scripts/setup/12-passwordless-sudo.sh`. Finish **T73.B.5** wiki + **T73.E** docs. Manual QA: Nuclear Calamares on :0, Caspar stop stays down until Start.
