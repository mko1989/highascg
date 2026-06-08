# Chapter 2: Installation & Deployment Guide

This document dissects the production installation sequence managed by `scripts/install.sh`. HighAsCG deploys as a highly specialized Ubuntu environment.

## The Production Installation Flow

Running `sudo ./scripts/install.sh` sequentially sources five phases. It assumes a pristine Ubuntu installation.

### Phase 1: Base Configuration (`install-phase1.sh`)
* Validates `SCRIPT_DIR` ensuring the deploy is running from `/home/casparcg/highascg`.
* Configures base dependencies such as `curl`, `wget`, `rsync`.

### Phase 3: Desktop Environment (`install-phase3.sh`)
* Designed for minimal Ubuntu images running `nodm` and `Openbox`.
* Installs `xserver-xorg-input-all` and `xserver-xorg-input-libinput`. This is critical: without this, USB mice and keyboards will not function on minimal server images when the GUI loads.
* Installs `avahi-daemon` to ensure **mDNS discovery works for NDI** sources.

### Phase 4: HighAsCG & Node (`install-phase4.sh`)
1. **Node.js LTS Validation**: Verifies the active Node version. If below the minimum (v20), it uses NodeSource (`curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -`) to force upgrade `nodejs`.
2. **Networking**: Installs Tailscale for secure LAN/WAN access and Syncthing (exposing its GUI on `0.0.0.0:8384` for the operator).
3. **USB Ingest Prep**: Installs `udisks2` and `policykit-1` to allow the unprivileged `casparcg` user to auto-mount drives (via `/etc/polkit-1/rules.d/51-highascg-udisks-casparcg-headless.rules`).
4. **NVIDIA Pinning**: Reads `HIGHASCG_NVIDIA_DRIVER` (e.g., `595`) and stamps it to `/etc/highascg/nvidia-iso-driver`, disabling multi-branch boot hooks.
5. **Systemd Unit Setup**: Calls `scripts/write-highascg-systemd-unit.sh` and `scripts/install-exfat-systemd-units.sh` (bridge + USB mounts, exFAT sync map from `config/exfat-sync.json`). If running headless, it drops a configuration at `/etc/systemd/system/highascg.service.d/10-headless.conf`:
   ```ini
   [Service]
   Environment=HIGHASCG_HEADLESS=true
   ```
6. **MOTD Injection**: Rewrites `/etc/update-motd.d/99-highascg` to print the Tailscale IP and Web UI link when an operator SSHes into the box.

**Operator stick seeding** (after `finish-operator-stick.sh`):

```bash
sudo bash tools/eggs/live-usb/seed-exfat-operator-layout.sh /home/casparcg/exfat
sudo bash tools/eggs/live-usb/seed-stick-config-from-host.sh /dev/sda   # optional: push configs/
```

Creates `projects/`, `configs/`, `drop-update/`, etc. on `HIGHASCGEXF`. See [`docs/BRIDGE_DISK_AND_USB_EXFAT.md`](../../docs/BRIDGE_DISK_AND_USB_EXFAT.md).

### Dev Deployment (`scripts/dev-push.sh`)
For rapid iteration without rebuilding the ISO, the `npm run deploy:dev` command executes `dev-push.sh`.
* It bundles `src/`, `config/`, and `tools/` into a tarball (excluding `node_modules` and the Web UI `dist-web`).
* Pushes over SSH to `DEPLOY_HOST`.
* `DEPLOY_REMOTE_SUDO=1` can be passed to use `sudo tar` for extraction on hosts where permissions are restricted.
