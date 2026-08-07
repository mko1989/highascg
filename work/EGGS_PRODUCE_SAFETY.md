# Is `run-eggs-produce-from-host.sh` safe?

**Not 100% without preconditions.** It does **not** `rm -rf /usr` directly, but it **does change the running host** while building an ISO.

## Safe if

- [ ] `/etc/highascg/pinned-kernel` exists (e.g. `6.8.0-117-generic`) — **kernel will NOT upgrade to latest HWE**
- [ ] No eggs liveroot bind mounts (`reboot` if a prior produce was interrupted)
- [ ] You ran `sudo bash work/run-eggs-prepare-safe.sh` (check-only — host already configured via setup + `prepare-eggs-clone-with-exfat.sh`)
- [ ] `bridge` / `exfat` / `highascg/media` are **not** mounted with real data (script umounts before clone)

## Will NOT do

| Action | Notes |
|--------|--------|
| `rm -rf /usr` or `/bin` | Only if you manually rm liveroot **while** eggs bind-mounts are active (guarded now) |
| Install `linux-image-generic` when pinned | Fixed: uses `/etc/highascg/pinned-kernel` |
| `prepare-eggs-minimal.sh` | Not called |

## WILL change on this host (temporary or permanent)

| Change | Reversible? |
|--------|-------------|
| **Hostname** → `highascg-nvidia-595` | `hostnamectl set-hostname casparcg` |
| **Network** netplan + systemd-networkd files | Keep or restore from backup |
| **`config/casparcg.config`** | Overwritten with ISO factory default (`reset-iso-operator-config.sh`) — **back up first** |
| **`config/*` + `projects/*` + `.highascg-state.json`** | Factory reset to **New project 1** (empty looks/timelines, one PGM-only screen) — **back up operator projects first** |
| **`casparcg.config`** (repo ROOT — the MEDIA-SCANNER's config, NOT the server's `config/casparcg.config`) | Overwritten with the factory template (WO-162: `write-iso-default-config.js` now always writes a fresh one from `scripts/setup/templates/scanner.config`; the scanner binary reads `./casparcg.config` from its cwd, so ISOs ship a valid media-scanner config) |
| **`~/exfat/configs/*`** | Cleared for ISO snapshot |
| **`/etc/fstab` swap lines** | Stripped during build, **restored** at end (`strip-host-swap restore`) |
| **Initramfs** for pinned kernel | Rebuilt for Plymouth branding |
| **`highascg.service`** | Stopped during squashfs pack, should restart via remount script |
| **`/opt/nvidia-pool`** | Removed if present |
| **ISO build** | `eggs produce --clone` — uses bind mounts under `/home/eggs/liveroot` during run; **do not interrupt** |

## Kernel

With pin file: stays on **6.8.0-117-generic**, purges other `linux-image-*-generic` packages.

Without pin file: **installs latest HWE** — do not run on playout host.

## If produce is interrupted mid-flight

**Reboot immediately.** Never `rm` or `umount` anything under `/home/eggs`. Use `pre-produce-preflight.sh` only after reboot.

## Recommended order

```bash
sudo bash work/run-eggs-prepare-safe.sh
# backup operator config:
cp ~/highascg/config/casparcg.config ~/highascg/config/casparcg.config.bak.$(date +%s)
sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
```
