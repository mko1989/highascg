# Flash the HighAsCG live ISO to USB with persistence

**Default goal:** a stick that **remembers the whole live session** — NVIDIA
drivers, DeckLink-related config, Tailscale, **`/etc`**, **`/var`**, home
directories, and **`/home/casparcg/highascg`**. That requires Ubuntu Live
**`persistence`** + **`persistence.conf`** with **`/ union`**, and booting
**Live with persistence** every time.

**WO-47 exFAT data (required on production sticks):** systemd mounts **`LABEL=HIGHASCGEXF`** at **`/home/casparcg/exfat`**, binds **`~/exfat/media` → `~/highascg/media/exfat`**, and runs boot-time sync (**`highascg-exfat-sync.service`**) — installed from **`scripts/install-exfat-systemd-units.sh`**, **`scripts/write-highascg-systemd-unit.sh`**, and **`scripts/install-phase4.sh`**; **Eggs `--clone`** images bake the same logic if you ran **`tools/live-usb/prepare-eggs-clone-with-exfat.sh`** (or **`build-highascg-egg.sh`**) on the build host. After `dd`, run **persistence first** (**2 GiB**), then **exFAT fills the rest** — **`finish-operator-stick.sh`** or **`EXFAT_DATA_ZERO_TOUCH.md`**. Etcher / macOS / Windows steps: **[MANUAL_STICK_WINDOWS_MACOS.md](./MANUAL_STICK_WINDOWS_MACOS.md)** (optional local copy: `for_client/USB_STICK_AFTER_FLASH.md`, not in git).

**Automation:** from the HighAsCG repo, after `dd` + `sync` (or **`flash-iso-from-config.sh`**). If **`tools/live-usb/flash-iso.conf`** exists with **`DEVICE=/dev/sdX`**, you can omit the device on the **`add-*`** lines; otherwise pass **`/dev/sdX`** explicitly.

```bash
# Production: persistence first (2 GiB default), then exFAT uses the rest of the disk.
sudo bash tools/live-usb/finish-operator-stick.sh /dev/sdX --iso /path/to.iso
# Or:
# PERSIST_SIZE_MIB=2048 EXFAT_FILL_DISK=1 EXFAT_ISO_PATH=/path/to.iso \
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

# Create a fixed-size persistence slice (example: 2 GiB after START_MIB), not the whole tail.
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

## Step 4 — Boot and pick the persistence entry

Insert the USB into a target machine, boot from it, and at the GRUB menu
choose **"Live with persistence"** (or the equivalent entry; eggs labels it
explicitly). Subsequent boots remember everything — including the NVIDIA
driver installed by the first-boot picker.

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
3. (If a reboot happened) Second boot: marker exists, picker is a no-op, `highascg.service` starts.

## Common gotchas

- **No "with persistence" entry in the boot menu.** Some eggs builds hide
  it; press `e` at the default entry and append `persistence` to the
  kernel cmdline, then `Ctrl-X` to boot. To make it permanent, edit the
  ISO's grub config before flashing or pass it via the eggs theme.
- **Picker loops forever.** Marker isn't persisting — you booted without
  `persistence`, or the partition isn't labelled exactly `persistence`,
  or the file isn't named exactly `persistence.conf`.
- **`apt-get install` in the picker fails with "no candidate".** Offline
  cache is missing the dependency tree. Re-run `fetch-debs.sh` with all
  the branches you need; verify with `ls /opt/nvidia-pool | wc -l`.
- **Driver installs but `nvidia-smi` errors after reboot.** DKMS hasn't
  finished building against the live kernel. Wait 30s and retry, or
  `sudo dkms autoinstall && sudo modprobe nvidia`.
