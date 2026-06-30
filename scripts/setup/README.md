# HighAsCG host setup (ordered steps)

Use these scripts for a **clean playout host rebuild**. Run in order; reboot when a step says so.

**Full manual guide:** [MANUAL_INSTALL.md](MANUAL_INSTALL.md) — step-by-step instructions, verification, troubleshooting, and optional eggs/bridge setup.

Old one-off scripts under `scripts/` are **deprecated** — see [../deprecated/README.md](../deprecated/README.md).

## Order

| Step | Script | Reboot? |
|------|--------|---------|
| 1 | `01-kernel-117.sh` | **yes** |
| 2 | `02-verify-kernel-117.sh` | no |
| 3 | `03-nvidia-open-595.sh` | **yes** |
| 4 | `04-ndi.sh` | no |
| 5 | `05-caspar-deps.sh` | no |
| 6 | `06-decklink-manual.md` | manual |
| 7 | `07-node-highascg.sh` | no |
| 8 | `08-caspar-cef-scanner.sh` | no |
| 9 | `09-openbox-autostart.sh` | restart nodm |
| 15 | `15-licenses-install.sh` | no — installs `licenses/` → `/usr/share/doc/highascg/licenses` |

**Chrome window on boot?** HighAsCG paints an HTML test template via CEF. Playout uses `HIGHASCG_NO_STARTUP_LED_TEST=1` in `highascg.service.d/10-headless.conf` (see `highascg-headless.env.conf`).

| 11 | `11-boot-branding.sh` | **reboot** to see GRUB + boot animation |

```bash
sudo bash scripts/setup/11-boot-branding.sh
sudo reboot
sudo bash scripts/setup/verify-boot-branding.sh
```

**Host boot (default):** GRUB wallpaper + kernel dmesg + corner throbber. **Not** Plymouth splash (avoids blanking nodm outputs).

**Eggs ISO/USB:** also needs `work/setup-boot-branding-phase1.sh` + eggs produce — see `tools/eggs/live-usb/branding/README.md`.

**Eggs prepare (check-only):** `sudo bash work/run-eggs-prepare-safe.sh` — verifies host readiness; **does not install** anything. Install missing pieces via `scripts/setup/` and `prepare-eggs-clone-with-exfat.sh` first.

**Eggs produce preflight:** `sudo bash tools/eggs/live-usb/pre-produce-preflight.sh` (WO-47 umount + bind-mount guard only).

**Caspar libs / GRUB fix (fresh host):** `sudo bash scripts/setup/fix-caspar-and-grub.sh`

```bash
cd ~/highascg

sudo bash scripts/setup/01-kernel-117.sh && sudo reboot
# after reboot:
sudo bash scripts/setup/02-verify-kernel-117.sh
sudo bash scripts/setup/03-nvidia-open-595.sh && sudo reboot
# after reboot:
nvidia-smi
sudo bash scripts/setup/04-ndi.sh
sudo bash scripts/setup/05-caspar-deps.sh
# DeckLink: follow scripts/setup/06-decklink-manual.md
sudo bash scripts/setup/07-node-highascg.sh
sudo bash scripts/setup/08-caspar-cef-scanner.sh
sudo bash scripts/setup/09-openbox-autostart.sh
```

## Rules

- **Kernel:** stay on `6.8.0-117-generic` — never `apt install linux-image-generic`
- **GPU:** Blackwell = **open** `nvidia-open` from CUDA repo — not closed `cuda-drivers` or `pin-kernel-6.8.0-117.sh`
- **Eggs/USB clone:** only after pin file exists: `/etc/highascg/pinned-kernel`

## Still useful (not deprecated)

| Path | Purpose |
|------|---------|
| `scripts/apt-block-service-starts.sh` | apt policy-rc.d during driver install |
| `scripts/exfat/write-highascg-systemd-unit.sh` | highascg.service |
| `scripts/lib/install-helpers.sh` | CEF, scanner, version helpers |
| `scripts/lib/install-config.sh` | URLs and pins |
| `scripts/exfat/install-exfat-systemd-units.sh` | WO-47/WO-52 mounts |
| `tools/eggs/` | USB clone pipeline (after host is stable) |

## Legacy monolith

`scripts/install.sh` (phases 1–5) still works but mixes kernel/GPU/NDI/DeckLink. Prefer `scripts/setup/` for recovery and new hosts.
