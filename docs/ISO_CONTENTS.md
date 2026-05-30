# HighAsCG live ISO — contents reference

What is inside the **penguins-eggs** hybrid ISO produced by **`tools/eggs/live-usb/build-highascg-egg.sh`** (or **`make-dev-github-release-iso-quick.sh`**).

The image is a **`eggs produce --clone --max --excludes static`** snapshot of the **build host** at produce time. It is **not** a minimal net-install recipe: whatever was installed and configured on that machine (via **`scripts/install.sh`** and WO‑47 prep) is what gets cloned—minus paths listed in [**`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`**](../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list).

**Related:** [`LIVE_USB_IMAGE.md`](LIVE_USB_IMAGE.md) (workflow), [`WO47_ISO_VS_EXFAT.md`](WO47_ISO_VS_EXFAT.md) (ISO vs stick payload), [`BUILD_AND_FLASH.md`](../tools/eggs/live-usb/BUILD_AND_FLASH.md) (build & flash).

---

## USB stick layout (after operator prep)

| Region | What it is |
|--------|------------|
| **Hybrid ISO partition(s)** | Bootable live system (this document). |
| **Operator data (exFAT)** | Label **`HIGHASCGEXF`** — configs, media, server drops; survives reboot when the stick is prepared with WO-47. No union **`/ union`** persistence partition. See [`WO47_ISO_VS_EXFAT.md`](WO47_ISO_VS_EXFAT.md). |
| **exFAT `HIGHASCGEXF`** | Operator data: **`update/server/`**, media, templates, configs — **not** inside the squashfs. See [§ WO‑47 split](#wo-47-what-is-on-the-iso-vs-on-exfat). |

---

## Stack overview (bottom → top)

```
┌─────────────────────────────────────────────────────────────┐
│  HighAsCG (Node.js API) — highascg.service → :4200 (headless) │
│  (full app tree often from exFAT after WO‑47 bootstrap)     │
├─────────────────────────────────────────────────────────────┤
│  CasparCG Server 2.5 + CEF + casparcg-scanner               │
│  Openbox autostart (respawn) — config under ~/highascg/    │
├─────────────────────────────────────────────────────────────┤
│  X11 :0 — nodm → openbox-session (user casparcg)            │
├─────────────────────────────────────────────────────────────┤
│  Drivers: NVIDIA (one branch per ISO — 535 / 580 / 595)     │
│           DeckLink desktopvideo (DKMS blackmagic_io)        │
│           NDI (libndi in tree + ~/highascg/lib copies)     │
├─────────────────────────────────────────────────────────────┤
│  FFmpeg, systemd-networkd, optional NetworkManager stack    │
├─────────────────────────────────────────────────────────────┤
│  Ubuntu 24.04 LTS (Noble) — linux-generic, systemd, GRUB    │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Operating system

| Item | Typical content |
|------|-----------------|
| **Distribution** | Ubuntu **24.04 LTS** (Noble Numbat) — target of **`scripts/install.sh`** |
| **Architecture** | **amd64** |
| **Kernel** | **linux-generic** (whatever the build host was running when `eggs produce` ran) |
| **Init** | **systemd** |
| **Boot** | GRUB / EFI hybrid layout from eggs (live + optional installer entries per eggs config) |
| **User** | **`casparcg`** — playout user (`video`, `audio`, `render`, `plugdev`, …); home **`/home/casparcg`** |

**Added at ISO build time** (`build-highascg-egg.sh`, not necessarily on a minimal Ubuntu):

- **systemd-networkd** + **netplan** (renderer `networkd`) for wired DHCP on live boot  
- Packages: `network-manager`, `wpasupplicant`, `iproute2`, `linux-firmware`, `pciutils`, `usbutils`, etc. (see script)  
- **`exfatprogs`**, **`parted`**, **`rsync`**, **`python3`** — WO‑47 stick prep (`prepare-eggs-clone-with-exfat.sh`)

---

## 2. Display — nodm + Openbox (no desktop environment)

| Component | Role |
|-----------|------|
| **nodm** | Auto-starts X11 on **`DISPLAY=:0`** as **`casparcg`** (no GDM/lightdm) |
| **openbox** | Minimal window manager only |
| **unclutter** | Hides mouse cursor on playout head |
| **xterm** | Used in **`x11-only`** display mode (DeckLink setup) |
| **X input** | `xserver-xorg-input-all` / **libinput** (USB kb/mouse on `:0`) |

**Key paths**

| Path | Purpose |
|------|---------|
| `/etc/default/nodm` | `NODM_USER=casparcg`, `NODM_ENABLED=true`, X options `-s 0 -dpms` |
| `/home/casparcg/.xsession` | `exec openbox-session` |
| `/home/casparcg/.config/openbox/autostart` | CasparCG + scanner + NVIDIA X tweaks; **`flock`** single-instance lock |
| `/etc/highascg/display-mode` | **`normal`** (Caspar autostart) or **`x11-only`** (DeckLink GUI only) |
| `/usr/local/bin/highascg-display-mode` | Switch display mode + restart nodm |

**Autostart chain (`display-mode=normal`)**

1. `xset` — disable screensaver / DPMS  
2. `highascg-nvidia-x-apply.sh` — PowerMizer / sync-to-vblank (if NVIDIA)  
3. `casparcg-scanner` (background)  
4. Loop: clear **`cef-cache`**, run **`casparcg-server-2.5`** with **`~/highascg/config/casparcg.config`** (respawn on crash)

Stock **`casparcg-server.service`** is **disabled** — Caspar is started from Openbox, not systemd.

---

## 3. NVIDIA

| Item | Notes |
|------|------|
| **Driver on build host** | Set **`HIGHASCG_NVIDIA_DRIVER=535\|580\|595`** before install + `eggs produce` (one branch per ISO) |
| **`/etc/highascg/nvidia-iso-driver`** | Stamp file baked into the image (e.g. `595`) |
| **`GET /api/system/gpu-nvidia`** | Read-only status + GPU → branch recommendation (`data/nvidia-driver-guide.json`) |
| **No** `/opt/nvidia-pool` | Multi-driver pool removed — see **`work/work-orders/WO_single-nvidia-driver-per-iso.md`** |
| **X session** | `__GL_SYNC_TO_VBLANK=0`, `highascg-nvidia-x-apply.sh`, **`nvidia-settings`** |

Settings UI: **Application Settings → system** can apply another branch from the pool (WO‑39) when HighAsCG is deployed.

---

## 4. Blackmagic DeckLink

| Item | Notes |
|------|------|
| **Packages** | **`desktopvideo`** + **`desktopvideo-gui`** (from Blackmagic Desktop Video `.deb` tarball on build host) |
| **Kernel module** | **DKMS `blackmagic_io`** (must be present on build host at clone time for ISO to carry it) |
| **Setup GUI** | `desktopvideo_setup` — autostart in **`x11-only`** mode; optional in normal mode after delay |
| **Build warning** | `build-operator-stick.sh` / docs warn if **`desktopvideo*`** missing on clone source |

DeckLink I/O is configured in Caspar / HighAsCG config (e.g. **`config/caspar_server.json`**), not baked as fixed channel maps in the ISO.

---

## 5. CasparCG stack

| Component | Path / binary |
|-----------|----------------|
| **CasparCG Server 2.5** | `/usr/bin/casparcg-server-2.5` |
| **CEF (Caspar build)** | `/usr/lib/casparcg-cef-*` (`.deb` from CasparCG/server releases) |
| **Media scanner** | `/usr/bin/casparcg-scanner` (port **8000**) |
| **Working tree** | **`/home/casparcg/highascg/`** (not `/opt/casparcg` in current installer) |
| **Server config** | **`/home/casparcg/highascg/config/casparcg.config`** |
| **Templates / media stubs** | **`~/highascg/template/`**, **`~/highascg/media/`** (empty in ISO; media often from exFAT bind) |
| **CEF cache** | **`~/highascg/cef-cache/`** — cleared on each Caspar start in autostart |
| **Logs** | **`~/highascg/log/`**, **`/tmp/caspar.log`** |
| **NDI copies** | **`~/highascg/lib/libndi.so.6*`** (from system NDI install) |

**Also installed on build host (Phase 2–3)**

- **FFmpeg** + **libdrm2** — kmsgrab / x11grab for capture paths  
- **NDI SDK** — `/usr/lib/x86_64-linux-gnu/libndi.so.6`

Caspar is launched with config under **`~/highascg`**, matching HighAsCG’s generated **`casparcg.config`**.

---

## 6. HighAsCG (Node.js control server)

| Item | Notes |
|------|------|
| **Service** | **`highascg.service`** — `node index.js` (see **`scripts/write-highascg-systemd-unit.sh`**) |
| **HTTP API** | Default **:4200**; **`HIGHASCG_HEADLESS=true`** — no Web UI on playout (Electron on operator PC) |
| **Deploy path on playout host** | **`/home/casparcg/highascg`** |
| **Depends on** | **`package.json`** present (WO‑47: from exFAT **`update/server/`** apply) |

**WO‑47:** **`src/`**, **`scripts/`**, **`package.json`**, and **`tools/`** (playout gets **`tools/runtime/`** only via server tarball) are **excluded from the squashfs** and applied from **`exfat/update/server/`**. The ISO carries a **minimal Caspar shell** under **`~/highascg`** (see next section).

**Optional on image (if install.sh ran on build host)**

- Passwordless **sudo** fragments for media mount, NVIDIA apply, ALSA (`docs/HIGHASCG_PASSWORDLESS_SUDO.md`)  
- **Polkit** rules for headless udisks (USB ingest)

---

## WO‑47: what is on the ISO vs on exFAT

### Baked into squashfs (minimal playout shell)

Kept under **`/home/casparcg/highascg`** for Caspar + mounts:

| Path | In ISO |
|------|--------|
| **`bin/`** | Optional site helpers |
| **`config/`** | **`casparcg.config`** from **`casparcg.config.iso`** (720p50 windowed borderless screen) when prepare embed is on |
| **`lib/`** | e.g. **NDI** copies |
| **`media/`**, **`log/`**, **`template/`**, **`data/`**, **`cef-cache/`** | **Empty stubs** (contents excluded) |
| **`~/exfat`** | Empty mountpoint; **`exfat/*`** excluded from squashfs |

**Not in squashfs** (excluded — see fragment list):

- **`src/`**, **`client/`**, **`tools/`**, **`scripts/`**, **`work/`**, **`examples/`**, …  
- **`package.json`**, **`index.js`**, **`node_modules/`**  
- Builder **`media/`** scratch, **`.git`**, IDE caches  

### On operator stick (exFAT label **`HIGHASCGEXF`**)

| Path on stick | Role |
|---------------|------|
| **`update/server/`** | Server drop: **`highascg-server_*.tar.gz`** (`src/`, `scripts/`, **`tools/runtime/`**, …) |
| **`media/`**, **`templates/`**, **`configs/`**, … | Portable operator data |
| **`drop-config/`** | Optional monolithic config |

**Boot order (simplified)**

1. **`home-casparcg-exfat.mount`** — mount **`HIGHASCGEXF`** → **`/home/casparcg/exfat`**  
2. **`highascg-exfat-media-prep`** + bind **`exfat/media`** → **`~/highascg/media/exfat`**  
3. **`highascg-exfat-server-update`** — apply **`update/server/`** → **`~/highascg`** when pending  
4. **`highascg-exfat-sync`** — mtime sync **`drop-config/`** (and configured pairs)    
5. **`highascg.service`** (no NVIDIA first-boot picker)  
6. **`nodm`** → Openbox → Caspar  
7. **`highascg.service`** — Node app when **`package.json`** exists  

---

## Systemd units (WO‑47 + playout)

| Unit | Purpose |
|------|---------|
| `home-casparcg-exfat.mount` | exFAT by label **HIGHASCGEXF** |
| `highascg-exfat-media-prep.service` | Prepare media bind targets |
| `home-casparcg-highascg-media-exfat.mount` | Bind exFAT media into tree |
| `highascg-exfat-server-update.service` | Apply **`update/server/`** server drop |
| `highascg-exfat-sync.service` | Boot sync via **`exfat-sync-cli.js`** |
| `highascg.service` | HighAsCG Node server |
| `nodm.service` | X11 for **casparcg** |

---

## Network & firewall (typical)

| Item | Notes |
|------|------|
| **Live networking** | **systemd-networkd** + DHCP on `en*` / `eth*` (egg build) |
| **UFW** (if configured on build host) | Often **5250** AMCP, **6250**, **8000** scanner, **4200** HighAsCG |

---

## Explicitly omitted from squashfs (eggs excludes)

Summary of [**`penguins-eggs-exclude-highascg-fragment.list`**](../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list):

- Full HighAsCG app tree (see WO‑47 above)  
- **`~/highascg/media`** contents, **`~/exfat/*`**  
- **Tailscale** state under **`/var/lib/tailscale`**, **`/var/snap/tailscale`**  
- **casparcg** shell history, **`.cursor`**, caches  

Re-merge after editing the fragment: **`sudo bash tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh`**, then rebuild ISO.

---

## How this list is produced on the build host

| Step | Script |
|------|--------|
| Production stack (Caspar, nodm, NVIDIA, DeckLink, HighAsCG, …) | **`sudo ./scripts/install.sh`** (phases 1–5) |
| WO‑47 units + excludes + empty stubs | **`sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`** |
| NVIDIA pool + live network (full build only) | **`sudo bash tools/eggs/live-usb/build-highascg-egg.sh`** |
| Squashfs + ISO | **`eggs produce --nointeractive --clone --max --excludes static --basename highascg`** |

**ISO-only rebuild** (host already prepared):

```bash
sudo bash deprecated/tools/release/make-dev-github-release-iso-quick.sh
```

---

## Quick checklist — “is it supposed to be on the ISO?”

| Question | Answer |
|----------|--------|
| Ubuntu + kernel + systemd? | **Yes** (clone of build host) |
| nodm + Openbox + X? | **Yes**, if install.sh ran |
| NVIDIA driver per ISO? | Set **`HIGHASCG_NVIDIA_DRIVER`** on build host; **`npm run eggs:build`** |
| DeckLink **desktopvideo**? | **Yes**, if installed on build host before produce |
| Caspar + scanner binaries? | **Yes**, if install.sh ran |
| **`~/highascg/config/casparcg.config`** stub? | **Yes** (minimal shell) |
| Full HighAsCG **`src/` / `node_modules`?** | **Yes** when **`HIGHASCG_ISO_EMBED_SERVER=1`** (default); **`dist-web/`** excluded — use Electron launcher |
| Operator media / templates? | **No** in squashfs — **exFAT** |
| GitHub alpha tarball contents? | Same as **exFAT app tree**, not the minimal ISO shell |

---

*Last aligned with WO‑47 modular layout and `build-highascg-egg.sh` / `prepare-eggs-clone-with-exfat.sh`.*
