# Flash the HighAsCG live ISO to USB with persistence

**Default goal:** a stick that **remembers the whole live session** — NVIDIA
drivers, DeckLink-related config, Tailscale, **`/etc`**, **`/var`**, home
directories, and **`/home/casparcg/highascg`**. That requires Ubuntu Live
**`persistence`** + **`persistence.conf`** with **`/ union`**. The ISO must
pass **`persistence`** on the **default** GRUB kernel line (10 s countdown);
there is no separate “persistence” menu item to choose after flash.

**Boot branding:** optional **`tools/eggs/live-usb/branding/splash.png`** (GRUB wallpaper) and Plymouth **`highascg`** theme (dark splash instead of purple Ubuntu). See **`tools/eggs/live-usb/branding/README.md`**.

**ISO GRUB (build host):** `build-highascg-egg.sh` runs **`install-eggs-live-grub-theme.sh`**, then **`eggs produce … --theme …/highascg-eggs-theme`**. Eggs **does not** read `theme:` from `eggs.yaml` unless **`--theme`** is passed — without it you get stock **“Live/Installation”** with **no** `persistence`. The default entry is **“Live”** and its `linux` line includes **`persistence`** (`timeout=10`, `default=0`). Verify before `dd`:

```bash
sudo bash tools/eggs/live-usb/verify-iso-boot-branding.sh /home/eggs/highascg_*.iso
```

You still need the **`persistence`** ext4 slice on the USB (`finish-operator-stick.sh`); without that partition, the kernel param has no effect. Operator JSON on exFAT syncs whenever **`HIGHASCGEXF`** is mounted, independent of union boot.

**WO-47 exFAT data (required on production sticks):** systemd mounts **`LABEL=HIGHASCGEXF`** at **`/home/casparcg/exfat`**, binds **`~/exfat/media` → `~/highascg/media/exfat`**, and runs boot-time sync (**`highascg-exfat-sync.service --boot`**) — on every boot, **`configs/` on the stick overwrites `~/highascg/config/`** (`bootPrefer: exfat` in **`exfat-sync.json`**), then **`highascg.service`** starts. UI saves **push to exFAT immediately** (then a debounced full sync). Installed from **`scripts/install-exfat-systemd-units.sh`**, **`tools/eggs/live-usb/install-exfat-sync-map.sh`**, **`scripts/write-highascg-systemd-unit.sh`**. After `dd`, run **persistence first** (**4 GiB** default), then **exFAT fills the rest** — **`finish-operator-stick.sh`**. Verify: **`bash tools/eggs/live-usb/verify-config-persistence.sh`**. Etcher / macOS / Windows: **[MANUAL_STICK_WINDOWS_MACOS.md](./MANUAL_STICK_WINDOWS_MACOS.md)** (optional local copy: `for_client/USB_STICK_AFTER_FLASH.md`, not in git).

**Automation:** from the HighAsCG repo, after `dd` + `sync` (or **`flash-iso-from-config.sh`**). If **`tools/live-usb/flash-iso.conf`** exists with **`DEVICE=/dev/sdX`**, you can omit the device on the **`add-*`** lines; otherwise pass **`/dev/sdX`** explicitly.

```bash
# Production: persistence first (4 GiB default), then exFAT uses the rest of the disk.
sudo bash tools/live-usb/finish-operator-stick.sh /dev/sdX --iso /path/to.iso
# Or:
# PERSIST_SIZE_MIB=4096 EXFAT_FILL_DISK=1 EXFAT_ISO_PATH=/path/to.iso \
#   sudo bash tools/live-usb/add-union-persistence-partition.sh /dev/sdX
# EXFAT_ISO_PATH=/path/to.iso EXFAT_FILL_DISK=1 \
#   sudo bash tools/live-usb/add-exfat-data-partition.sh /dev/sdX

# Or with explicit device:
# sudo bash tools/live-usb/add-exfat-data-partition.sh /dev/sdX
# sudo bash tools/live-usb/add-union-persistence-partition.sh /dev/sdX

# Persistence only (no exFAT slice):
# sudo bash tools/live-usb/add-union-persistence-partition.sh
```

Use `--dry-run` first if you like. If `parted` cannot infer free space, set
**`START_MIB`** (see script) or follow the manual steps below.

**Narrow alternative:** if you **only** want **`/home/casparcg/highascg`** on a
separate partition (no full OS persistence), see
**`HIGHASCG_FOLDER_USB_PARTITION.md`** — **not** suitable when you need
NVIDIA/Tailscale/DeckLink OS state to survive reboots.

Manual steps below document the **`/ union`** layout if you skip the script.

## Prerequisites

- The ISO at `/home/eggs/highascg-live*.iso` (built by `eggs produce`).
- A USB stick big enough for: ISO size + ≥ 4 GB persistence overlay
  + your driver-install delta (usually < 1 GB).
- The USB device path. Identify with:
  ```bash
  lsblk -dpno NAME,SIZE,MODEL,TRAN | grep usb
  ```
  In this guide we'll use `/dev/sdX` — **replace with your real device,
  and double-check before any `dd`**.

## Step 1 — Flash the ISO

```bash
ISO=/home/eggs/highascg-live*.iso
sudo umount /dev/sdX?* 2>/dev/null || true
sudo dd if=$ISO of=/dev/sdX bs=4M status=progress oflag=sync conv=fsync
sudo sync
sudo partprobe /dev/sdX
lsblk /dev/sdX
```

After flashing, the USB has 1–2 read-only partitions used by the live image.
The remaining free space at the end of the device is where we'll add the
persistence partition.

## Step 2 — Add a `persistence` partition

```bash
# Find the end of the last existing partition
sudo parted /dev/sdX unit MiB print free

# Create a fixed-size persistence slice (default 4 GiB after START_MIB), not the whole tail.
# Replace START_MIB and END_MIB from parted print free / finish-operator-stick dry-run.
sudo parted -s /dev/sdX -- mkpart primary ext4 START_MIB END_MIB

# Format and label it. The label MUST be exactly `persistence`.
sudo mkfs.ext4 -L persistence /dev/sdX3   # or sdX4 if there are 3 existing partitions
```

## Step 3 — Write the persistence config

The kernel looks for `/persistence.conf` at the root of the labelled
partition. `/ union` means "make every path in the live root writable via
an overlay backed by this partition".

```bash
sudo mkdir -p /mnt/persist
sudo mount /dev/disk/by-label/persistence /mnt/persist
echo '/ union' | sudo tee /mnt/persist/persistence.conf
sudo umount /mnt/persist
```

## Step 4 — Boot (persistence is the default menu entry)

Insert the USB into a target machine and boot from it. With the HighAsCG
eggs theme installed, the **first GRUB entry** already includes **`persistence`**.
Use **“Live (no persistence)”** only for debugging. Subsequent persistence boots
remember NVIDIA drivers, `/etc`, and overlay state from the picker.

## Verifying the picker on a target machine

After the first boot completes (which may include one automatic reboot):

```bash
cat /var/log/highascg-pick-nvidia.log
ls -la /var/lib/highascg/nvidia-installed
nvidia-smi
systemctl status highascg
```

Expected sequence:

1. Boot from USB → systemd reaches `multi-user.target`.
2. `highascg-pick-nvidia.service` runs:
   - If the recommended branch already matches the loaded one → marker stamped, no reboot, `highascg.service` starts immediately.
   - Otherwise → swap drivers, reboot.
3. (If a reboot happened) Second boot: marker exists for **this GPU + branch**, picker is a no-op, `highascg.service` starts.

## Union persistence size (`/ union`)

The overlay stores **every change under `/`** (apt/NVIDIA, `/var`, `/etc`, not just HighAsCG config). **Default stick scripts use `PERSIST_SIZE_MIB=4096` (4 GiB).** Smaller slices fill quickly; operator **show config** should live on **exFAT `configs/`**, not in the 4 GiB slice alone.

## Moving the same USB between machines (NVIDIA)

With **`persistence`** active, **`/var/lib/highascg/nvidia-installed`** lives on the **persistence overlay** (not exFAT). The picker records **`gpu_pci=`** and **`branch=`** in that file.

| Situation | Behaviour |
|-----------|-----------|
| Same machine, same GPU, driver already correct | Marker matches → picker exits; no reinstall. |
| **Different machine** (different PCI id) | Marker is **stale** → removed → `ubuntu-drivers` picks the **recommended** branch for the new GPU → purge/install from **`/opt/nvidia-pool`** if needed → new marker → reboot if swapped. |
| Same GPU, recommendation changed | Marker branch mismatch → re-pick. |

**What accumulates on the persistence partition:** installed `.deb` payloads, DKMS build trees under **`/var/lib/dkms`**, apt cache, logs — **not** a full ISO copy, but it can exceed 4 GiB on heavy setups. **Show settings** sync to **`HIGHASCGEXF`** via **`configs/`** (survives machine changes without relying on the overlay).

To force a re-pick on one machine: `sudo rm /var/lib/highascg/nvidia-installed` and reboot (with persistence boot).

## Common gotchas

- **No persistence after reboot.** Confirm you booted the default entry (or
  re-ran **`install-eggs-live-grub-theme.sh`** before **`eggs produce`**). Check
  **`cat /proc/cmdline`** contains **`persistence`**. Without the labelled
  **`persistence`** partition, the param does nothing.
- **Picker loops forever.** Marker isn't persisting — you booted without
  `persistence`, or the partition isn't labelled exactly `persistence`,
  or the file isn't named exactly `persistence.conf`.
- **Wrong NVIDIA driver after moving stick to another PC.** Delete
  **`/var/lib/highascg/nvidia-installed`** on the stick session (or boot once
  with persistence so the picker sees a new **`gpu_pci`** and re-runs).
- **`apt-get install` in the picker fails with "no candidate".** Offline
  cache is missing the dependency tree. Re-run `fetch-debs.sh` with all
  the branches you need; verify with `ls /opt/nvidia-pool | wc -l`.
- **Driver installs but `nvidia-smi` errors after reboot.** DKMS hasn't
  finished building against the live kernel. Wait 30s and retry, or
  `sudo dkms autoinstall && sudo modprobe nvidia`.
