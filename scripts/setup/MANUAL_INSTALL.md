# HighAsCG playout host — manual installation guide

This guide follows the **ordered scripts** in `scripts/setup/`. Each step is idempotent where possible. Run from a clone of the repo as a user with `sudo`.

**Target platform:** Ubuntu 24.04 x86_64 playout box with:

- Kernel **`6.8.0-117-generic`** (pinned — not `linux-image-generic`)
- NVIDIA **open** modules **595** (Blackwell / RTX PRO 4000)
- Playout tree at **`/home/casparcg/highascg`**
- Caspar + HighAsCG on **nodm + Openbox** (`:0`)

Legacy monolith `scripts/install.sh` (phases 1–5) still works; prefer this path for fresh hosts and recovery.

---

## Before you start

| Requirement | Notes |
|-------------|--------|
| Root/sudo | All setup scripts require `sudo` |
| Repo | `git clone` → `cd ~/highascg` (or restore `~/highascg` from backup) |
| Caspar binary | `~/highascg/bin/casparcg` must exist before playout (not downloaded by setup) |
| Network | Steps 3–4 download NVIDIA repo, NDI SDK, NodeSource, CEF |
| Eggs ISO build | Separate — only after host is stable and `/etc/highascg/pinned-kernel` exists |

**Do not** on a playout host:

- `apt install linux-image-generic` (pulls kernel 124+)
- Install closed `cuda-drivers` / Ubuntu `nvidia-driver-595` on Blackwell (needs **open** modules)
- `rm` under `/home/eggs` during or after interrupted `eggs produce`

---

## Quick path (copy-paste)

```bash
cd ~/highascg

# 1 — Kernel pin
sudo bash scripts/setup/01-kernel-117.sh && sudo reboot

# 2 — After reboot
sudo bash scripts/setup/02-verify-kernel-117.sh

# 3 — NVIDIA open 595
sudo bash scripts/setup/03-nvidia-open-595.sh && sudo reboot

# 4 — After reboot
nvidia-smi
sudo bash scripts/setup/04-ndi.sh
sudo bash scripts/setup/05-caspar-deps.sh

# 6 — DeckLink only if you have a card (see 06-decklink-manual.md)

sudo bash scripts/setup/07-node-highascg.sh
sudo bash scripts/setup/08-caspar-cef-scanner.sh
sudo bash scripts/setup/09-openbox-autostart.sh

# 11 — Optional host boot branding
sudo bash scripts/setup/11-boot-branding.sh && sudo reboot
sudo bash scripts/setup/verify-boot-branding.sh
```

**Fresh host shortcut** (Caspar libs + GRUB only, after restore):

```bash
sudo bash scripts/setup/fix-caspar-and-grub.sh
```

---

## Step 1 — Kernel `6.8.0-117-generic`

**Script:** `01-kernel-117.sh`  
**Reboot:** yes

**What it does:**

- APT pin blocks `linux-image-generic`, `linux-headers-generic`, `linux-generic`
- Installs full **117** stack: image, headers, modules, **modules-extra**, tools
- Purges **6.8.0-124** packages and generic kernel metas
- Holds 117 packages (`apt-mark hold`)
- Writes `/etc/highascg/pinned-kernel`
- Sets GRUB `GRUB_DEFAULT=saved`, `GRUB_SAVEDEFAULT=true`, `grub-set-default 0`
- Rebuilds initramfs for 117

```bash
sudo bash scripts/setup/01-kernel-117.sh
sudo reboot
```

---

## Step 2 — Verify kernel

**Script:** `02-verify-kernel-117.sh`  
**Reboot:** no (must run **after** step 1 reboot)

**Checks:**

- `uname -r` == `6.8.0-117-generic`
- Pin file, APT pin, vmlinuz, no 124 boot artifacts
- GRUB not stuck on “Advanced options” submenu
- 117 packages installed and held
- `igc` driver (Intel I226-V NIC)
- At least one ethernet interface UP

```bash
sudo bash scripts/setup/02-verify-kernel-117.sh
```

Exit **0** → continue to step 3. Exit **1** → fix and reboot if still on wrong kernel.

---

## Step 3 — NVIDIA open driver 595

**Script:** `03-nvidia-open-595.sh`  
**Reboot:** yes  
**Requires:** running kernel 117 (step 2 pass)

**What it does:**

- Adds NVIDIA CUDA apt repo via `cuda-keyring` deb
- Installs `nvidia-driver-pinning-595`
- Removes closed stack (`cuda-drivers`, `nvidia-dkms`, etc.)
- Installs **`nvidia-open`** + `nvidia-settings`
- Stamps `/etc/highascg/nvidia-kernel-module-type` = `open`
- Stamps `/etc/highascg/nvidia-iso-driver` = `595`

```bash
sudo bash scripts/setup/03-nvidia-open-595.sh
sudo reboot
```

**After reboot:**

```bash
cat /proc/driver/nvidia/version    # expect Open Kernel Module
nvidia-smi
ls /dev/dri/card0
```

Override driver branch: `HIGHASCG_NVIDIA_DRIVER=595` (default).

---

## Step 4 — NDI SDK v6

**Script:** `04-ndi.sh`  
**Reboot:** no

**What it does:**

- Downloads NDI SDK v6 (or uses `HIGHASCG_NDI_SDK_TAR=/path/to/tar.gz`)
- Installs `libndi.so.6` system-wide
- Copies libs into `~/highascg/lib/`

```bash
sudo bash scripts/setup/04-ndi.sh
```

Offline:

```bash
export HIGHASCG_NDI_SDK_TAR=/path/to/Install_NDI_SDK_v6_Linux.tar.gz
sudo bash scripts/setup/04-ndi.sh
```

---

## Step 5 — Caspar runtime dependencies

**Script:** `05-caspar-deps.sh`  
**Reboot:** no

**What it does:**

- Installs FFmpeg, OpenGL/EGL, GLEW, SFML, TBB, Boost, NSS, X11, **PortAudio** (`libportaudio2`, `portaudio19-dev`), ALSA
- Enables **avahi-daemon** (NDI mDNS)
- Installs **nodm**, **openbox**, unclutter, xterm, X input drivers
- Creates system user **`casparcg`** (groups: video, audio, render, plugdev, dialout, input)
- Creates playout dirs: `bin`, `media`, `log`, `template`, `data`, `cef-cache`, `config`, `lib`
- Configures nodm → openbox for `casparcg`
- Runs `ldd` on `bin/casparcg` if present

```bash
sudo bash scripts/setup/05-caspar-deps.sh
```

Override playout root: `CASPAR_PLAYOUT_ROOT=/home/casparcg/highascg`

---

## Step 6 — DeckLink (manual)

**Doc:** `06-decklink-manual.md`  
**Reboot:** no

Blackmagic **Desktop Video** is not auto-downloaded. Install from `.tar.gz` when `lspci` shows a DeckLink card.

**GUI setup mode** (Caspar not started):

```bash
sudo highascg-display-mode x11-only    # after step 9
sudo systemctl restart nodm
```

**Check status:**

```bash
bash scripts/setup/check-decklink.sh
```

**Resume playout:**

```bash
echo normal | sudo tee /etc/highascg/display-mode
sudo systemctl restart nodm
```

---

## Step 7 — Node.js + HighAsCG app + systemd

**Script:** `07-node-highascg.sh`  
**Reboot:** no

**What it does:**

- Installs Node.js LTS (≥20) via NodeSource if needed
- `rsync` repo → `~/highascg` (excludes `node_modules`, `media`, `bin`, `lib`, …)
- `npm install --omit=dev` as `casparcg`
- Installs/enables **`highascg.service`** via `write-highascg-systemd-unit.sh`

```bash
sudo bash scripts/setup/07-node-highascg.sh
```

**Headless API** (no CEF test pattern on boot): ensure drop-in matches `highascg-headless.env.conf`:

```ini
# /etc/systemd/system/highascg.service.d/10-headless.conf
Environment=HIGHASCG_HEADLESS=true
Environment=HIGHASCG_NO_STARTUP_LED_TEST=1
```

---

## Step 8 — CEF + media scanner + Caspar launcher

**Script:** `08-caspar-cef-scanner.sh`  
**Reboot:** no  
**Requires:** `~/highascg/bin/casparcg` (custom build with PortAudio for production audio)

**What it does:**

- Ensures `run.sh` launcher
- Overlays **pinned CEF** from GitHub into `~/highascg/lib/` (keeps `libndi`, etc.)
- Installs **casparcg-scanner** deb
- Disables stock `casparcg-server` systemd unit
- Copies NDI libs into `lib/`

```bash
sudo bash scripts/setup/08-caspar-cef-scanner.sh
```

Skip CEF download: `HIGHASCG_SKIP_CEF=1 sudo bash scripts/setup/08-caspar-cef-scanner.sh`

Pins/URLs: `scripts/lib/install-config.sh` (`URL_CEF_BINARY_TAR`, `URL_SCANNER_DEB`).

---

## Step 9 — Openbox autostart (Caspar on :0)

**Script:** `09-openbox-autostart.sh`  
**Reboot:** restart nodm (or reboot)

**What it does:**

- NVIDIA GL env (`__GL_SYNC_TO_VBLANK=0`, PowerMizer max)
- `highascg-nvidia-x-apply.sh` on X session start
- `highascg-display-mode` helper (`normal` | `x11-only`)
- Openbox autostart: **casparcg-scanner** + **`run.sh`** with `CASPAR_RESPAWN=1`
- flock guard (single Caspar instance)
- Enables/restarts **nodm**

```bash
sudo bash scripts/setup/09-openbox-autostart.sh
sudo systemctl restart nodm
```

**Logs:** `/tmp/caspar.log`

**DeckLink GUI:** `sudo highascg-display-mode x11-only`

---

## Step 11 — Host boot branding (optional)

**Script:** `11-boot-branding.sh` → `scripts/install-host-boot-branding.sh`  
**Reboot:** yes to see GRUB + boot animation

**Default host mode:** GRUB wallpaper + kernel dmesg + framebuffer corner throbber (Plymouth **masked** on host).

**Plymouth splash on host** (hides dmesg):

```bash
sudo HIGHASCG_HOST_BOOT_MODE=plymouth bash scripts/setup/11-boot-branding.sh
sudo reboot
```

**Verify:**

```bash
sudo bash scripts/setup/verify-boot-branding.sh
```

GRUB font uses **Rewir** from `template/fonts/Rewir-Light.ttf` (via `grub-mkfont`).

ISO/USB branding is separate: `tools/eggs/live-usb/branding/README.md`

---

## Bridge disk + USB exFAT (WO-47 / WO-52)

Not part of the numbered 01–09 steps. Install when you use internal **HIGHASCGDAT** bridge partition or USB operator stick **HIGHASCGEXF**:

| Label | Mount | Media bind |
|-------|-------|------------|
| `HIGHASCGDAT` | `/home/casparcg/bridge` | `bridge/media` → `~/highascg/media/bridge` |
| `HIGHASCGEXF` | `/home/casparcg/exfat` | `exfat/media` → `~/highascg/media/exfat` |

```bash
sudo bash scripts/install-exfat-systemd-units.sh casparcg
```

Eggs imaging host (one-shot):

```bash
sudo bash work/install-eggs-host-prereqs.sh
sudo bash work/run-eggs-prepare-safe.sh    # check-only
```

Produce ISO (after prepare passes):

```bash
cp ~/highascg/config/casparcg.config ~/highascg/config/casparcg.config.bak.$(date +%s)
sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
```

Safety: `work/EGGS_PRODUCE_SAFETY.md` — never `rm` under `/home/eggs`.

---

## Verification checklist

After steps 1–9:

```bash
# Kernel
uname -r                                    # 6.8.0-117-generic
cat /etc/highascg/pinned-kernel

# GPU
nvidia-smi
cat /proc/driver/nvidia/version

# Caspar libs
LD_LIBRARY_PATH=~/highascg/lib ldd ~/highascg/bin/casparcg | grep 'not found' || echo OK

# Services
systemctl is-active highascg nodm avahi-daemon

# API
curl -s http://127.0.0.1:4200/api/system/exfat-sync | jq . 2>/dev/null || true

# Caspar AMCP (when running)
ss -ltn | grep 5250
```

---

## Environment variables

| Variable | Used in | Purpose |
|----------|---------|---------|
| `USER_CASPAR` | all setup scripts | Default `casparcg` |
| `CASPAR_PLAYOUT_ROOT` | 05, 07, 08, 09 | Default `/home/casparcg/highascg` |
| `HIGHASCG_NVIDIA_DRIVER` | 03, eggs produce | Default `595` |
| `HIGHASCG_NDI_SDK_TAR` | 04 | Offline NDI tarball path |
| `HIGHASCG_SKIP_CEF` | 08 | Skip CEF download |
| `HIGHASCG_HOST_BOOT_MODE` | 11 | `dmesg` (default) or `plymouth` |

---

## Troubleshooting

| Symptom | Action |
|---------|--------|
| Wrong kernel after reboot | Re-run `01-kernel-117.sh`, check GRUB default, boot top-level Ubuntu entry |
| `nvidia-smi` fails / NVRM open modules | Re-run `03-nvidia-open-595.sh`; remove `cuda-drivers` |
| `dpkg -l` shows `iU nvidia-*` / firmware conflict on `gsp_ga10x.bin` | Re-run `03-nvidia-open-595.sh` (drops Ubuntu `nvidia-firmware-595-*`, finishes DKMS); then reboot |
| `xrandr` shows `None-1`, DRM only `Unknown-1` | NVIDIA module not loaded — fix driver install first; RTX 2080 SUPER works with **open** |
| `ldd casparcg` missing libs | Re-run `05-caspar-deps.sh` or `fix-caspar-and-grub.sh` |
| No keyboard/mouse on :0 | `apt install xserver-xorg-input-all xserver-xorg-input-libinput`; restart nodm |
| NDI LIST empty | `systemctl status avahi-daemon`; firewall mDNS |
| PortAudio consumer ignored | Caspar must be **custom_live** build; enable in Device View |
| Duplicate Caspar | Check flock in autostart; `pkill -f bin/casparcg` only main process |
| Eggs produce blocked | `sudo bash tools/eggs/live-usb/pre-produce-preflight.sh`; umount bridge/exfat |

---

## Related docs

| Path | Topic |
|------|--------|
| [README.md](README.md) | Script index |
| [06-decklink-manual.md](06-decklink-manual.md) | DeckLink install |
| [../deprecated/README.md](../deprecated/README.md) | Old one-off scripts |
| [../../docs/BRIDGE_DISK_AND_USB_EXFAT.md](../../docs/BRIDGE_DISK_AND_USB_EXFAT.md) | WO-47 / WO-52 |
| [../../work/EGGS_PRODUCE_SAFETY.md](../../work/EGGS_PRODUCE_SAFETY.md) | ISO build safety |
| [../../docs/MANUAL_INSTALL.md](../../docs/MANUAL_INSTALL.md) | Legacy `/opt/casparcg` phase guide |
