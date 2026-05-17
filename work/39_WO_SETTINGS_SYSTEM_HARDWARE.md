# Work Order 39: Settings — “system” (NVIDIA) and “decklink” tabs

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done  
> 2. Update task checkboxes to reflect current status  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry  
> 4. Do **NOT** delete previous agents' log entries  

---

## Goal

Add two panes under **Application Settings** for headless broadcast rigs:

1. **System** (`data-tab="system-hardware"` or `system` — pick one id and use everywhere)  
   - Read-only summary of the **currently loaded NVIDIA kernel driver / Metro package set** (derive from `nvidia-smi`, `modinfo nvidia`, and/or `dpkg -l 'nvidia-driver-*' 'nvidia-dkms-*'` — document chosen source in code).  
   - **Dropdown** of target branches: **535**, **580**, **595** (configurable list; only show versions that have **`.deb` trees** present under **`/opt/nvidia-pool`**).  
     - *Canonical pool path:* **`/opt/nvidia-pool`** (default for `fetch-debs.sh` and first-boot picker; override with **`NVIDIA_DEB_POOL`** only if needed).  
     - **595**: builder must download debs even when that branch is already installed on the build host (e.g. `apt-get download nvidia-driver-595 nvidia-dkms-595` into the pool, or a dedicated script flag) — see **Tasks**.  
   - **Button: “Apply driver set”** — runs an **audited root helper** (no arbitrary shell from the UI) that `dpkg -i` / `apt install` from the pool for the selected branch, triggers **`dkms`** rebuild if needed, and returns log output to the UI. **Requires new `NOPASSWD`** or polkit; see `docs/HIGHASCG_PASSWORDLESS_SUDO.md`.  
   - **Button: “Open NVIDIA Settings”** — launch **`nvidia-settings`** on **`DISPLAY=:0`** with correct **`XAUTHORITY`** (reuse pattern from `src/utils/os-config.js` / `getXAuthority()`). Usually **no sudo**.

2. **Decklink** (`data-tab="decklink"` or `decklink-hardware"`)  
   - Read-only card summary: enumerate DeckLink devices and **logical ports** (reuse or extend existing host inventory if present under `src/` / device-view; otherwise call **`DesktopVideoHelper`** / **`mctl`** / sysfs — **pick one supported path** and degrade gracefully if BMD tools are missing).  
   - **Button: “Desktop Video Setup”** — spawn **`desktopvideo_setup`** (from `desktopvideo-gui`) on **`:0`** (same DISPLAY/XAUTHORITY pattern as above).  
   - **Button: “Desktop Video updater”** — spawn the **GUI updater** shipped with Desktop Video if available. **Discovery rule:** at install time or runtime, locate the binary via **`dpkg -L desktopvideo-gui`** (or sibling package) filtering for `*`updat*` / `*Updater*` / `Blackmagic*`; cache the path in config or resolve on each click. Fallback: document running **`BlackmagicFirmwareUpdater`** CLI if no GUI exists on that BMD version.

---

## Success criteria

1. New settings tabs appear next to existing tabs in `web/components/settings-modal-templates.js`, with matching handlers in `settings-modal.js` / small module.  
2. All **privileged** actions go through **narrow** server endpoints + **fixed-path** helper scripts (same security model as WO-38 **`media-mount.sh`**).  
3. **NVIDIA apply** never executes user-controlled shell; pool path and branch allow-list are server-side.  
4. **DISPLAY :0** launches use the same **XAUTHORITY** resolution as other headless helpers to avoid “cannot open display”.  
5. **Docs:** extend `docs/HIGHASCG_PASSWORDLESS_SUDO.md` with the exact new `NOPASSWD` lines once helpers exist. **Installer:** `install-phase4.sh` (or new phase) installs helper + sudoers fragment.

---

## Non-goals (this WO)

- Replacing **Nuclear** tab; driver switch may **require the same optional password** as reboot (`checkNuclearPassword` in `routes-system-setup.js`) — **recommend reuse** for parity.  
- Supporting non-Debian/package-manager distros beyond current HighAsCG target.

---

## Tasks

- [x] **T1** Server: `GET /api/system/gpu-nvidia` — current version, pool contents (branches with debs), `nvidia-smi` parse (json).  
- [x] **T2** Server: `POST /api/system/gpu-nvidia/apply` — body `{ branch: "535"|"580"|"595" }` — calls `/usr/local/lib/highascg/nvidia-apply-from-pool.sh` under `sudo -n`.  
- [x] **T3** Root helper script: verify branch allow-list, `dpkg`/`apt` from `/opt/nvidia-pool` only, log to stdout/stderr for API response; optional `reboot` hint in JSON.  
- [x] **T4** Sudoers fragment + install hook; document in `HIGHASCG_PASSWORDLESS_SUDO.md`.  
- [x] **T5** Server: `GET /api/system/decklink` — card + ports summary.  
- [x] **T6** Server: `POST /api/system/gui-launch` — allow-listed commands only: `nvidia-settings`, `desktopvideo_setup`, `{discovered-updater}` — all with `DISPLAY=:0`, `XAUTHORITY=…` (never pass client-controlled argv).  
- [x] **T7** Web: templates + `fetch` wiring + error states.  
- [x] **T8** Pool population: documented in `tools/live-usb/nvidia-multi-driver/README.md` (per-branch download / `fetch-debs.sh`).  
- [ ] **T9** QA on live USB with persistence: switch branch, reboot, confirm `nvidia-smi`.

---

## Architecture sketch

```
Web UI  →  POST /api/system/gpu-nvidia/apply  →  sudo -n /usr/local/lib/highascg/nvidia-apply-from-pool.sh 535
                     ↓
               journal / JSON response to UI
```

DeckLink GUI launches: **prefer no root**; if BMD tools require root in some installs, use a second allow-listed wrapper only after verifying need.

---

## Related files

- `web/components/settings-modal-templates.js` — tab buttons + panes  
- `web/components/settings-modal.js` — tab activation, API calls  
- `src/api/routes-system-setup.js` — pattern for `sudo -n` + nuclear password  
- `src/utils/os-config.js`, `src/utils/hardware-info.js` — DISPLAY / XAUTHORITY  
- `scripts/sudoers.d/highascg-media-mount` — sudoers template pattern  
- `tools/live-usb/nvidia-multi-driver/fetch-debs.sh` — offline pool  
- `docs/HIGHASCG_PASSWORDLESS_SUDO.md` — living list of NOPASSWD commands  

---

## Work Log

### 2026-05-15 — WO drafted; automation + sudo inventory

- Added **`tools/live-usb/build-flash-and-persist.sh`**: optional eggs build, interactive USB disk selection (or `--usb`), **`dd`**, then **`add-union-persistence-partition.sh`** (`/ union`). Documented from **`tools/live-usb/BUILD_AND_FLASH.md`**.
- Added **`docs/HIGHASCG_PASSWORDLESS_SUDO.md`**: consolidates NOPASSWD rules (optional asound + media mount) + Node `sudo -n` call sites + WO-39 for future NVIDIA helper.
- **Instructions for next agent:** implement T1–T9; ~~align NVIDIA pool path (`/opt/nvidia-pool` vs `/opt/nvidia-debs`)~~ **done** — use **`/opt/nvidia-pool`** everywhere (`NVIDIA_DEB_POOL` for picker overrides only).

### 2026-05-15 (b) — Reference image defaults

- Offline NVIDIA cache path unified to **`/opt/nvidia-pool`** (`fetch-debs.sh`, `highascg-pick-nvidia.sh`, docs). Picker override: **`NVIDIA_DEB_POOL`**.
- **`HIGHASCG_INSTALL_ASOUND_SUDOERS`** default **off** — **`highascg-asound`** only when system-wide ALSA is required; PortAudio + **`~/.asoundrc`** remain the default story.
- **`nvidia-multi-driver/README.md`**: note for **`apt-get download nvidia-driver-595 nvidia-dkms-595`** when the builder already has 595 installed.

### 2026-05-15 (c) — WO-39 implementation (API + UI)

- **`src/api/routes-system-hardware.js`** + **`src/api/router.js`**: `GET /api/system/gpu-nvidia`, `GET /api/system/decklink`, `POST /api/system/gpu-nvidia/apply`, `POST /api/system/gui-launch` (optional nuclear password same as reboot via exported **`checkNuclearPassword`**).
- **`scripts/highascg-nvidia-apply-from-pool.sh`** → `/usr/local/lib/highascg/nvidia-apply-from-pool.sh`; sudoers **`scripts/sudoers.d/highascg-nvidia-apply-from-pool`** wired in **`scripts/install-phase4.sh`**.
- **Settings:** **`system`** (`data-tab="system-hardware"`) and **`decklink`** panes in **`settings-modal-templates.js`** + handlers in **`settings-modal.js`**.
- **`docs/HIGHASCG_PASSWORDLESS_SUDO.md`**: documents NVIDIA apply NOPASSWD + GUI launch (no sudo).

**Instructions for next agent:** complete **T9** on real hardware; tighten BMD updater path heuristics per installed `desktopvideo-gui` layout if needed.
