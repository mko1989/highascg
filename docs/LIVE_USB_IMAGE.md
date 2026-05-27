# Creating a Live USB Image from a Running HighAsCG / CasparCG Server

> **Goal:** Capture the entire running production server — Ubuntu 24.04 LTS, NVIDIA
> drivers, DeckLink, NDI, CasparCG (custom CEF build), HighAsCG, autostart
> configuration — into a bootable ISO that can:
>
> 1. **Boot live from USB** (test / emergency playout — durable data on **exFAT** `HIGHASCGEXF`, see **§7**)
> 2. **Install to an internal drive** (permanent deployment on new hardware)

---

## Table of Contents

1. [Overview & Strategy](#1-overview--strategy)
2. [Prerequisites](#2-prerequisites)
3. [Pre-Image Cleanup](#3-pre-image-cleanup)
4. [Method A — penguins-eggs (Recommended)](#4-method-a--penguins-eggs-recommended)
5. [Method B — Manual SquashFS + GRUB ISO](#5-method-b--manual-squashfs--grub-iso)
6. [Writing the ISO to USB](#6-writing-the-iso-to-usb)
7. [Booting the Live USB](#7-booting-the-live-usb) — **§7 durable data on exFAT** (not union persistence)
8. [Installing to a Drive from Live USB](#8-installing-to-a-drive-from-live-usb)
9. [Post-Install Steps on New Hardware](#9-post-install-steps-on-new-hardware)
10. [Troubleshooting](#10-troubleshooting)
11. [Reference: What's on the Server](#11-reference-whats-on-the-server)

---

## 1. Overview & Strategy

The server is a **headless Ubuntu 24.04 LTS** box running a minimal X11 stack
(nodm + Openbox) with CasparCG, CasparCG Scanner, HighAsCG, and professional
broadcast I/O (DeckLink, NDI). There is no full desktop environment.

**penguins-eggs** is the recommended tool because it was purpose-built to
snapshot a *running* Linux system into a redistributable live ISO. It handles
the kernel, initramfs, squashfs compression, GRUB/EFI boot, and bundles a
text-based installer (Krill) — all in one command.

The **manual method** (Section 5) is a fallback for environments where
penguins-eggs cannot be installed or when you need full control over the ISO
layout.

> [!IMPORTANT]
> **Hardware-specific drivers** (NVIDIA, DeckLink DKMS modules) are compiled for
> the running kernel. The live image will work best on identical or similar
> hardware. On different hardware, generic VESA/nouveau will be used for video
> output, and DeckLink modules may need to be rebuilt (see §9).

---

## 2. Prerequisites

All commands run on the **live production server** (the source machine) as
`root` or via `sudo`.

### 2.1 Disk Space

You need roughly **2× the used space** on the system partition available
somewhere for the build:

```bash
# Check used space
df -h /
du -sh /opt/casparcg /opt/highascg

# Typical: ~8–15 GB used → need ~16–30 GB free for build
# If / is too small, mount external storage at e.g. /mnt/build
```

### 2.2 Kernel Headers (for DKMS modules in the image)

```bash
apt install -y linux-headers-$(uname -r)
```

### 2.3 Required Packages

```bash
apt update
apt install -y git rsync xorriso squashfs-tools dosfstools mtools grub-efi-amd64-bin grub-pc-bin
```

---

## 3. Pre-Image Cleanup

Before creating the image, clean up ephemeral data to keep the ISO small and
avoid leaking secrets.

```bash
# Stop CasparCG (gracefully)
pkill -f '/usr/bin/casparcg-server-2.5' || true
sleep 3

# Clear CasparCG logs and CEF cache
rm -rf /opt/casparcg/log/*
rm -rf /opt/casparcg/cef-cache/*
rm -f /tmp/caspar.log

# Clear HighAsCG logs (if any)
rm -rf /opt/highascg/logs/* 2>/dev/null || true

# Clear apt cache
apt clean

# Clear temp files
rm -rf /tmp/* /var/tmp/*

# Clear bash history (optional — remove if you want to keep it)
> /root/.bash_history
> /home/casparcg/.bash_history 2>/dev/null || true

# Clear journal logs older than 1 day
journalctl --vacuum-time=1d

# Remove SSH host keys (regenerated on first boot of the new install)
# SKIP THIS if you want to keep them for live use
# rm -f /etc/ssh/ssh_host_*

# Remove Tailscale state if you don't want it cloned (optional)
# systemctl stop tailscaled
# rm -rf /var/lib/tailscale

# Remove Syncthing state if you don't want it cloned (optional)
# systemctl --user -M casparcg@ stop syncthing 2>/dev/null || true
# rm -rf /home/casparcg/.config/syncthing

# Optional: remove large media you do not need in the image
# (full playout media tree is often huge — exclude via §4.2.1 or clear selectively)
# rm -rf /opt/casparcg/media/*
# or only heavy files: rm -f /opt/casparcg/media/clip_xyz.mp4

# Optional: another local user's home — large project or CI artifacts
# rm -rf /home/otheruser/your-build-dir
```

> [!TIP]
> Keep `/opt/casparcg/media/` if you want a "ready to playout" image that
> includes all media files. For a system-only or thin image, remove media, clear
> other users’ build trees (see §4.2.1), and use penguins-eggs excludes for
> paths you cannot delete.

---

## 4. Method A — penguins-eggs (Recommended)

### 4.0 Node.js 22+ (required before install)

Current **penguins-eggs** packages declare `Depends: nodejs (>= 22)` on the
**Debian `nodejs` package** — not merely a `node` binary on `PATH`. If you use
nvm, a manual tarball, or another copy of Node, `node -v` can show 22 while
`apt` still has Ubuntu’s `nodejs` **18.x**, and the eggs `.deb` will keep failing
until the **apt** package is upgraded.

Check what apt will use:

```bash
apt-cache policy nodejs
```

If the only install candidate is `18.x` from `archive.ubuntu.com`, continue below.

**Install Node 22 as a system package** — for example with
[NodeSource](https://github.com/nodesource/distributions):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Verify the package, not only the CLI** (all should show 22+ from NodeSource or
equivalent, not 18 from Ubuntu):

```bash
dpkg -l nodejs
apt-cache policy nodejs
node -v
```

**If the NodeSource script errors with `Failed to run 'apt update'`** (or any
`apt update` failure), a broken or obsolete third-party repo is often the cause
— for example a PPA with no *Release* for your Ubuntu version (HTTP 404). The
script cannot add its repo until `apt update` is clean. Find and fix the bad
source (remove the PPA, or delete/comment the `.list` under
`/etc/apt/sources.list.d/`), then:

```bash
sudo apt update
```

Re-run the `curl … setup_22.x` line and `sudo apt-get install -y nodejs` again.

If you already have `nodejs` 18 from Ubuntu and only need eggs for this one-off
ISO build, replacing it with 22+ is usually fine. **HighAsCG** itself expects a
current Node (≥ 20; see the project README) — re-test `systemctl status highascg`
after changing the system `node` if the service is installed.

### 4.1 Install penguins-eggs

```bash
cd /tmp
git clone https://github.com/pieroproietti/fresh-eggs
cd fresh-eggs
sudo ./fresh-eggs.sh
```

This installs `eggs` and all dependencies (including `calamares` components if a
GUI is available, and `krill` for TUI install).

Verify:

```bash
sudo eggs --version
```

### 4.2 Configure eggs

Run the interactive configuration wizard:

```bash
sudo eggs dad -d
```

This sets defaults for the ISO name, compression, and output directory. You can
accept all defaults — ISOs will be stored in `/home/eggs/`.

Alternatively, edit `/etc/penguins-eggs.d/eggs.yaml` directly:

```yaml
# Key settings to verify/adjust:
snapshot_basename: highascg-server
snapshot_prefix: ""
compression: zstd           # fast compression, good ratio
```

### 4.2.1 HighAsCG: empty mount points in the squashfs (`casparcg`)

This repository ships a **mksquashfs exclude fragment** and helper scripts in
`tools/eggs/live-usb/`. The goal: **runtime trees under `/home/casparcg/highascg` are
empty in the live image** (media, logs, cache, etc.), while **WO‑47**
mount point **`/home/casparcg/exfat`** still exists as an **empty directory** so
systemd can mount the operator exFAT volume after boot.

penguins-eggs calls `mksquashfs` with **`-wildcards`**. The patterns use
**`/*`** where needed so **only the contents** of each directory are excluded;
**parent** directory nodes remain in the squash when they were created on the
build host. Paths in the fragment are **relative to the imaged root, no leading
slash** (see upstream `penguins-eggs` `conf/exclude.list.d/master.list` for the
same style).

**Produced files (copy or clone the repo on the build host):**

| File | Role |
|------|------|
| `tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list` | Paths under `home/casparcg/highascg/…` (and caches) to omit from squashfs — merge into eggs |
| `tools/eggs/live-usb/ensure-empty-live-usb-dirs.sh` | `mkdir` + optional `chown` for **`casparcg`** on **`/home/casparcg/exfat`** before imaging |
| `tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh` | Appends the fragment to `/etc/penguins-eggs.d/exclude.list` (idempotent) |
| `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh` | **Preferred one-shot:** WO-47 systemd units, **`exfat-sync`**, **`highascg.service`** deps, **`exfatprogs`**, empty mount stubs, merge excludes (**[`EXFAT_DATA_ZERO_TOUCH.md`](../tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md)**) |

**Shortcut (recommended):** run **`sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh`** once **`/etc/penguins-eggs.d/exclude.list`** exists; it performs steps 1–2 below (`ensure-empty-live-usb-dirs` + merge fragment) and bakes WO-47 into **`/etc`**. **`tools/eggs/live-usb/build-highascg-egg.sh`** invokes it automatically.

Alternatively, do the steps manually:

**On the source host (as root), before the final `eggs produce`:**

1. **Empty mount points on disk** (so the squash has those folder nodes). On a
   machine that already has **`casparcg`**:

   ```bash
   cd /path/to/highascg   # this repo checkout
   sudo ./tools/eggs/live-usb/ensure-empty-live-usb-dirs.sh
   ```

   If **`casparcg`** does not exist yet, the script still creates the
   directories (owned by root); fix ownership after user creation if needed.

2. **Merge the fragment** into the eggs config file. This requires
   `/etc/penguins-eggs.d/exclude.list` to **already exist** — on most installs,
   the first `eggs produce` without `--excludes static` (or a documented
   config pass) creates it. If the merge script errors with “file not found”,
   run a first normal `eggs produce` once, *then* merge, *then* the final
   produce in step 3.

   ```bash
   sudo ./tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh
   ```

3. **Build the live image** with **`--excludes static`** so eggs does **not**
   overwrite `exclude.list` and remove the HighAsCG block:

   ```bash
   sudo eggs produce --clone --excludes static --basename "highascg-server"
   ```

   After you adopt this workflow, use **`--excludes static` whenever you** run
   `eggs produce` and want to keep the fragment.

**Optional / notes**

- The stock flags **`--excludes homes`** / **`--excludes home`** add eggs’
  own templates; they are **not** a replacement for the HighAsCG fragment.
- **Revert:** in `/etc/penguins-eggs.d/exclude.list`, delete the block that
  starts with the marker line
  `# --- HighAsCG tools/eggs/live-usb: merge-penguins-eggs-exclude-highascg.sh ---`.
- **Other large paths** can still be cleared in §3, or you can append more
  lines to `exclude.list` (same format) before a `--excludes static` run.
- On a **very old mksquashfs**, if `/*` does not do what you expect, delete
  everything *under* those dirs on the source (§3) and keep only the empty
  directories, then run `eggs produce` without changing the list.

### 4.3 Produce the ISO

```bash
# --clone  : include all user accounts and data (see §4.2.1 for the HighAsCG
#             fragment + ensure-empty dirs so casparcg mount points stay empty)
# --excludes static : do not rebuild exclude.list (required after merge script)
# --basename : name for the ISO file
# --prefix : prefix (empty = cleaner name)

sudo eggs produce --clone --excludes static --basename "highascg-server"
```

> [!WARNING]
> **`--clone` copies the whole system and user tree** by default, including
> every user under `/home/*` and all of `/opt/casparcg` and `/opt/highascg`.
> Use §4.2.1 (merge the HighAsCG fragment, then use **`--excludes static`**) so
> **`casparcg`** HighAsCG runtime dirs and mount parents are present but empty
> in the image. If you
> want a "clean" image without *any* user data (only packages and system
> config), omit `--clone` instead and do not rely on the fragment.

This process:
1. Creates a squashfs of the entire filesystem
2. Builds an initramfs with casper/live hooks
3. Generates GRUB config for BIOS + UEFI boot
4. Packages everything into an ISO

**Expected output:** `/home/eggs/highascg-server-amd64.iso`

**Time:** 10–30 minutes depending on disk size and CPU.

### 4.4 Verify the ISO

```bash
ls -lh /home/eggs/*.iso

# Quick sanity check — mount and inspect
mkdir -p /mnt/iso
mount -o loop /home/eggs/highascg-server-*.iso /mnt/iso
ls /mnt/iso/
# Should see: boot/ casper/ EFI/ (or live/) etc.
ls /mnt/iso/casper/
# Should see: filesystem.squashfs, vmlinuz, initrd
umount /mnt/iso
```

---

## 5. Method B — Manual SquashFS + GRUB ISO

Use this if penguins-eggs is not available or you want full control.

### 5.1 Create Working Directories

```bash
export WORK=/mnt/build/live-build    # adjust to a location with enough space
mkdir -p $WORK/{staging/{EFI/boot,boot/grub/x86_64-efi,isolinux,live},tmp}
```

### 5.2 Create the SquashFS

This compresses the entire root filesystem into a single file:

```bash
mksquashfs / $WORK/staging/live/filesystem.squashfs \
  -comp zstd \
  -Xcompression-level 15 \
  -e /boot \
  -e /proc \
  -e /sys \
  -e /dev \
  -e /run \
  -e /tmp \
  -e /mnt \
  -e /media \
  -e /lost+found \
  -e /swapfile \
  -e /home/eggs \
  -e $WORK \
  -wildcards -e '*.log' \
  -no-recovery \
  -info
```

> [!NOTE]
> `-e` excludes pseudo-filesystems and the build directory itself. Add more
> exclusions as needed (e.g., `-e /opt/casparcg/media` to exclude media files).

### 5.3 Copy Kernel and Initramfs

```bash
# Copy the currently running kernel and initramfs
cp /boot/vmlinuz-$(uname -r) $WORK/staging/live/vmlinuz
cp /boot/initrd.img-$(uname -r) $WORK/staging/live/initrd

# Also need the kernel for the boot directory
cp /boot/vmlinuz-$(uname -r) $WORK/staging/boot/vmlinuz
cp /boot/initrd.img-$(uname -r) $WORK/staging/boot/initrd
```

### 5.4 Install casper (Live Boot Support)

The system needs `casper` to boot as a live system. If not already installed:

```bash
apt install -y casper lupin-casper
```

Regenerate the initramfs with casper support:

```bash
update-initramfs -u -k $(uname -r)
# Re-copy the updated initramfs
cp /boot/initrd.img-$(uname -r) $WORK/staging/live/initrd
cp /boot/initrd.img-$(uname -r) $WORK/staging/boot/initrd
```

### 5.5 Create GRUB Configuration

```bash
cat > $WORK/staging/boot/grub/grub.cfg << 'GRUB_EOF'
insmod all_video

set default="0"
set timeout=10

menuentry "HighAsCG Server — Live (RAM)" {
    linux /live/vmlinuz boot=casper quiet splash ---
    initrd /live/initrd
}

menuentry "HighAsCG Server — Live (toram — full copy to RAM)" {
    linux /live/vmlinuz boot=casper toram quiet splash ---
    initrd /live/initrd
}

menuentry "HighAsCG Server — Live (nomodeset — safe graphics)" {
    linux /live/vmlinuz boot=casper nomodeset quiet splash ---
    initrd /live/initrd
}
GRUB_EOF
```

### 5.6 Create EFI Boot Image

```bash
cat > $WORK/tmp/grub-standalone.cfg << 'EOF'
search --set=root --file /live/vmlinuz
set prefix=($root)/boot/grub/
configfile /boot/grub/grub.cfg
EOF

grub-mkstandalone \
  --format=x86_64-efi \
  --output=$WORK/tmp/bootx64.efi \
  --locales="" \
  --fonts="" \
  "boot/grub/grub.cfg=$WORK/tmp/grub-standalone.cfg"

# Create a FAT12 EFI system partition image
dd if=/dev/zero of=$WORK/staging/EFI/boot/efiboot.img bs=1M count=20
mkfs.vfat $WORK/staging/EFI/boot/efiboot.img
mmd -i $WORK/staging/EFI/boot/efiboot.img EFI EFI/BOOT
mcopy -i $WORK/staging/EFI/boot/efiboot.img \
  $WORK/tmp/bootx64.efi ::EFI/BOOT/BOOTX64.EFI
```

### 5.7 Create BIOS Boot Image (Legacy)

```bash
grub-mkstandalone \
  --format=i386-pc \
  --output=$WORK/tmp/core.img \
  --install-modules="linux normal iso9660 biosdisk memdisk search tar ls" \
  --modules="linux normal iso9660 biosdisk search" \
  --locales="" \
  --fonts="" \
  "boot/grub/grub.cfg=$WORK/tmp/grub-standalone.cfg"

cat /usr/lib/grub/i386-pc/cdboot.img $WORK/tmp/core.img > \
  $WORK/staging/boot/grub/bios.img
```

### 5.8 Build the ISO

```bash
xorriso \
  -as mkisofs \
  -iso-level 3 \
  -o $WORK/highascg-server-live.iso \
  -full-iso9660-filenames \
  -volid "HIGHASCG_LIVE" \
  --grub2-mbr /usr/lib/grub/i386-pc/boot_hybrid.img \
  -partition_offset 16 \
  --mbr-force-bootable \
  -append_partition 2 28732ac11ff8d211ba4b00a0c93ec93b \
    $WORK/staging/EFI/boot/efiboot.img \
  -appended_part_as_gpt \
  -iso_mbr_part_type a2a0d0ebe5b9334487c068b6b72699c7 \
  -eltorito-boot boot/grub/bios.img \
    -no-emul-boot -boot-load-size 4 -boot-info-table --grub2-boot-info \
  -eltorito-catalog boot/grub/boot.cat \
  -eltorito-alt-boot \
  -e '--interval:appended_partition_2:::' \
    -no-emul-boot \
  $WORK/staging

echo "ISO created: $WORK/highascg-server-live.iso"
ls -lh $WORK/highascg-server-live.iso
```

---

## 6. Writing the ISO to USB

### From the Server (or any Linux machine)

```bash
# Identify your USB device (BE CAREFUL — wrong device = data loss!)
lsblk

# Write (replace /dev/sdX with your USB device — NOT a partition like /dev/sdX1)
sudo dd if=/path/to/highascg-server-*.iso of=/dev/sdX bs=4M status=progress oflag=sync

# Or use a safer alternative:
sudo cp /path/to/highascg-server-*.iso /dev/sdX
sync
sudo partprobe /dev/sdX
```

**HighAsCG — after `dd`, add the exFAT data partition** (label **`HIGHASCGEXF`**) for configs, media, and server drops — see **`docs/WO47_ISO_VS_EXFAT.md`**, **`tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md`**. Boot plain **Live** (no union **`/ union`** persistence partition).

### From macOS

```bash
# List disks
diskutil list

# Unmount the USB disk (replace diskN)
diskutil unmountDisk /dev/diskN

# Write (use rdiskN for faster raw writes)
sudo dd if=/path/to/highascg-server-*.iso of=/dev/rdiskN bs=4m status=progress

# Eject
diskutil eject /dev/diskN
```

### From Windows

Use **[balenaEtcher](https://etcher.balena.io/)** or **Rufus** (select "DD Image
mode" in Rufus).

---

## 7. Booting the Live USB

1. Plug the USB into the target machine.
2. Enter BIOS/UEFI (usually `F2`, `F12`, `Del`, or `Esc` at POST).
3. **Disable Secure Boot** (NVIDIA and DeckLink DKMS modules are unsigned).
4. Set USB as first boot device, or use the boot menu (`F12` on most boards).
5. In GRUB, pick the default **Live** entry (disposable RAM overlay is fine for the OS root; operator data lives on exFAT).

### What Happens on Boot

The live system will:

1. Load the kernel and initramfs from the USB.
2. Mount `filesystem.squashfs` as a read-only root via overlayfs.
3. Start `nodm` → Openbox → CasparCG autostart (if display-mode is `normal`).
4. Start the `highascg.service` (HighAsCG web GUI on port 8080).

> [!TIP]
> If using **penguins-eggs**, the default live credentials are:
> - **User:** `live` / **Password:** `evolution`
> - **Root:** `root` / **Password:** `evolution`
>
> If you used `--clone`, your original `casparcg` user and SSH keys are also
> present.

### 7.1 Why data vanishes on a plain Live session

A normal **live session** stacks a **writable layer** on top of the read-only **`filesystem.squashfs`**. That layer is usually **RAM** (`tmpfs`), so **reboot clears** anything written only under **`/home`**, **`/etc`**, or **`~/highascg`** during the session.

**Operator rule:** keep anything that must survive on the **exFAT volume** (`HIGHASCGEXF` → **`/home/casparcg/exfat`**), not on the live overlay.

### 7.2 Durable storage (exFAT only — current product)

| What | Where |
|------|--------|
| Modular config + Caspar XML | exFAT **`configs/`** ↔ **`~/highascg/config/`** (boot sync) |
| Optional monolithic config | **`drop-config/highascg.config.json`** |
| UI/state JSON | **`configs/.highascg-state.json`**, **`.module-state.json`** |
| Media / templates | exFAT **`media/`**, **`templates/`** (bind under playout tree when prepared) |
| Server code drops | **`drop-update/`** → applied by **`highascg-exfat-server-update.service`** |

See **`docs/WO47_ISO_VS_EXFAT.md`**, **`docs/EXFAT_SERVER_UPDATE.md`**, **`config/exfat-sync.json`**.

**Removed (do not use on new sticks):**

- Union **`/ union`** ext4 **`persistence`** partition + GRUB **Live with persistence**
- WO-38 **`media/drive`** internal partition mount + Settings **Mount** UI

HighAsCG **no longer waits** on partition mount at startup — **`systemctl restart highascg`** should complete in seconds.

### 7.3 Install to internal disk (optional)

For a permanent machine, use §8 (Calamares / `eggs calamares`) instead of relying on live overlay or exFAT.

---

## 8. Installing to a Drive from Live USB

Once booted into the live environment, you can install the system permanently.

### 8.1 Using Krill (Text Installer — penguins-eggs)

```bash
sudo eggs krill
```

Krill provides a text-based wizard:
1. Select target disk (e.g., `/dev/sda`, `/dev/nvme0n1`)
2. Choose partitioning (auto or manual)
3. Set hostname, timezone, user accounts
4. Install — copies the live filesystem to the target disk
5. Install GRUB bootloader
6. Reboot

### 8.2 Using Calamares (Graphical — if available)

```bash
sudo eggs calamares
```

### 8.3 Manual Installation (for the manual ISO method)

If your ISO was built manually (Method B), there is no bundled installer. Use
this procedure:

```bash
# 1. Partition the target disk
#    Example: /dev/sda with GPT, 512MB EFI + rest ext4
parted /dev/sda -- mklabel gpt
parted /dev/sda -- mkpart ESP fat32 1MiB 513MiB
parted /dev/sda -- set 1 esp on
parted /dev/sda -- mkpart primary ext4 513MiB 100%

mkfs.fat -F32 /dev/sda1
mkfs.ext4 /dev/sda2

# 2. Mount target
mount /dev/sda2 /mnt
mkdir -p /mnt/boot/efi
mount /dev/sda1 /mnt/boot/efi

# 3. Extract the squashfs to the target
unsquashfs -f -d /mnt /path/to/live/filesystem.squashfs

# 4. Bind-mount for chroot
mount --bind /dev /mnt/dev
mount --bind /dev/pts /mnt/dev/pts
mount --bind /proc /mnt/proc
mount --bind /sys /mnt/sys

# 5. Chroot and install bootloader
chroot /mnt /bin/bash

# Inside chroot:
# Update fstab with the new disk UUIDs
blkid   # note the UUIDs
cat > /etc/fstab << EOF
UUID=<root-uuid>  /          ext4  errors=remount-ro  0 1
UUID=<efi-uuid>   /boot/efi  vfat  umask=0077         0 1
EOF

# Install GRUB
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
update-grub

# Regenerate initramfs
update-initramfs -u -k all

# Remove casper (not needed for installed system)
apt remove -y casper lupin-casper

# Regenerate SSH host keys
dpkg-reconfigure openssh-server

exit  # exit chroot

# 6. Unmount and reboot
umount -R /mnt
reboot
```

---

## 9. Post-Install Steps on New Hardware

After installing on a new machine, run these checks:

### 9.1 GPU Drivers

Each live ISO is built with **one** NVIDIA branch (**535**, **580**, or **595**). Set **`HIGHASCG_NVIDIA_DRIVER`** on the build host before **`install.sh`** and **`eggs produce`** — see **`work/work-orders/WO_single-nvidia-driver-per-iso.md`**. **`GET /api/system/gpu-nvidia`** shows the baked branch and a GPU recommendation guide; driver switching in Settings was removed.

```bash
# Check NVIDIA
nvidia-smi

# If NVIDIA drivers are missing (different GPU), reinstall:
apt install -y ubuntu-drivers-common
ubuntu-drivers autoinstall
reboot
```

### 9.2 DeckLink Drivers

```bash
# Check DeckLink
lsmod | grep blackmagic

# If module missing (different kernel), rebuild DKMS:
dpkg-reconfigure desktopvideo
# or reinstall:
dpkg -i /path/to/desktopvideo_*.deb
apt install -f -y
sudo modprobe blackmagic_io
```

### 9.3 CasparCG & CEF Verification

```bash
# Verify CasparCG binary
/usr/bin/casparcg-server-2.5 --version 2>/dev/null || echo "Check caspar install"

# Verify CEF libraries are correctly linked
ldd /usr/bin/casparcg-server-2.5 | grep -i cef

# Verify ld.so config
cat /etc/ld.so.conf.d/casparcg.conf
ldconfig -v 2>/dev/null | grep -i cef
```

### 9.4 HighAsCG Service

```bash
systemctl status highascg
journalctl -u highascg --no-pager -n 20

# If not installed as service:
cd /opt/highascg && node index.js
```

### 9.5 Network & Firewall

```bash
# Check UFW rules
ufw status

# Re-apply if needed
ufw allow 5250/tcp comment "CasparCG AMCP"
ufw allow 8000/tcp comment "CasparCG Scanner"
ufw allow 8080/tcp comment "HighAsCG Web GUI"
ufw allow 6250/udp comment "CasparCG OSC"
```

### 9.6 Regenerate Machine-Specific Config

```bash
# Generate new SSH host keys (if removed during cleanup)
sudo dpkg-reconfigure openssh-server

# Re-join Tailscale (if applicable)
sudo tailscale up

# Reconfigure Syncthing (if applicable)
# Each machine needs its own Syncthing identity
```

---

## 10. Troubleshooting

### ISO doesn't boot (black screen / hangs)

- Try the **"nomodeset"** GRUB entry — bypasses GPU driver issues
- Check BIOS: disable Secure Boot, enable Legacy/CSM if UEFI-only fails
- Verify the USB was written correctly: `dd` checksum vs ISO checksum

### CasparCG won't start on live boot

```bash
# Check logs
cat /tmp/caspar.log
journalctl -b | grep -i caspar

# Common causes:
# - GPU driver mismatch → use nomodeset or reinstall drivers
# - CEF cache corruption → already cleaned if you followed §3
# - Port 5250 already in use → check for duplicate processes
pgrep -af casparcg
```

### SquashFS too large / out of memory

- Shrink the source tree: remove or exclude `/opt/casparcg/media`, large dirs
  under other users’ homes, etc. (§4.2.1, §3).
- Use `toram` GRUB option only if the machine has enough RAM (≥ squashfs size × 2)
- Use `zstd` compression (default) for the best size/speed ratio

### penguins-eggs `produce` fails

```bash
# Check disk space
df -h /home/eggs

# Try with verbose output
sudo eggs produce --clone --basename "highascg-server" --verbose

# Alternative: use the simpler "love" command
sudo eggs love
```

### `penguins-eggs` will not install: `Depends: nodejs (>= 22) but 18... is to be installed`

The `.deb` from `fresh-eggs` needs the **`nodejs` apt package** ≥ 22. Ubuntu’s
default `nodejs` is 18, so you must install Node 22+ via apt (§4.0). If
`node -v` already shows 22 but the error persists, you only upgraded a
non-Debian `node` (e.g. nvm) — `apt-cache policy nodejs` will still show 18; fix
that first.

If the NodeSource script failed (often because **`apt update` hit a 404** on an
old PPA), `apt` never picked up NodeSource, so `apt install` still points at
18.x. Remove or fix the broken repository, run `sudo apt update`, then repeat
the NodeSource steps in §4.0, then re-run `sudo ./fresh-eggs.sh`.

### No network after live boot

```bash
# Check interfaces
ip link show
ip addr show

# If using DHCP
dhclient eth0   # or your interface name

# Check NetworkManager / systemd-networkd
systemctl status NetworkManager
systemctl status systemd-networkd
```

---

## 11. Reference: What's on the Server

This section documents the full software stack that the image captures.

### Operating System

| Component | Details |
|-----------|---------|
| OS | Ubuntu 24.04 LTS (Noble Numbat) |
| Kernel | linux-generic (amd64) |
| Display | nodm → Openbox (minimal X11, no DE) |
| Init | systemd |

### CasparCG Stack

| Component | Location | Notes |
|-----------|----------|-------|
| CasparCG Server 2.5 | `/usr/bin/casparcg-server-2.5` | Custom build (PRs #1718–#1720) |
| CasparCG CEF | `/usr/lib/casparcg-cef-*` | Patched Chromium Embedded Framework |
| CasparCG Scanner | `/usr/bin/casparcg-scanner` | Media scanner (port 8000) |
| Config | `/opt/casparcg/config/casparcg.config` | Generated by HighAsCG |
| Media | `/opt/casparcg/media/` | Playout media |
| Templates | `/opt/casparcg/template/` | HTML templates |
| CEF cache | `/opt/casparcg/cef-cache/` | Cleared on each restart |
| Logs | `/opt/casparcg/log/` | Server logs |

### HighAsCG

| Component | Location | Notes |
|-----------|----------|-------|
| Application | `/opt/highascg/` | Node.js playout control |
| Config | `/opt/highascg/highascg.config.json` | Application config |
| Service | `highascg.service` | systemd unit |
| Web GUI | `http://<IP>:8080` | Browser-based control |

### Drivers & Libraries

| Component | Notes |
|-----------|-------|
| NVIDIA driver | `nvidia-driver-550+` via `ubuntu-drivers` |
| nvidia-persistenced | Enabled, persistence mode on |
| DeckLink Desktop Video | `desktopvideo` + `desktopvideo-gui` (DKMS: `blackmagic_io`) |
| NDI SDK v6 | `/usr/lib/x86_64-linux-gnu/libndi.so.6` + symlinks |
| FFmpeg | System package (x11grab, kmsgrab) |

### Autostart Chain

```
systemd → nodm → X11 (:0) → Openbox
  └─ ~/.config/openbox/autostart
       ├─ xset (disable screensaver/DPMS)
       ├─ unclutter (hide cursor)
       ├─ highascg-nvidia-x-apply.sh (GPU perf settings)
       ├─ /usr/bin/casparcg-scanner &
       └─ while true; do
            casparcg-server-2.5 /opt/casparcg/config/casparcg.config
            # respawn on exit
          done &

systemd → highascg.service
  └─ node /opt/highascg/index.js (port 8080)
```

### System Hardening

| Setting | How |
|---------|-----|
| No screen blanking | `xset s off; xset -dpms` in autostart |
| No sleep/suspend | `systemctl mask sleep.target suspend.target hibernate.target` |
| GRUB quiet | `GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"` |
| UFW firewall | Ports 5250, 6250, 8000, 8080 open |
| Single CasparCG instance | `flock` in autostart (prevents duplicate starts) |

### Key User

| User | Shell | Home | Groups |
|------|-------|------|--------|
| `casparcg` | nologin | `/home/casparcg` | video, audio, render, plugdev, dialout, input |

### Key Paths

```
/opt/casparcg/               # CasparCG working directory (media, config, logs)
/opt/highascg/               # HighAsCG application
/etc/default/nodm            # nodm configuration (NODM_USER=casparcg)
/etc/highascg/display-mode   # "normal" or "x11-only"
/home/casparcg/.config/openbox/autostart  # CasparCG launch script
/home/casparcg/.xsession     # exec openbox-session
/etc/ld.so.conf.d/casparcg.conf  # CEF library path
/etc/highascg/nvidia-iso-driver  # Baked driver branch (535|580|595) for this ISO
/etc/sudoers.d/highascg-asound   # optional: system ALSA via tee (install with HIGHASCG_INSTALL_ASOUND_SUDOERS=1)
/usr/local/bin/highascg-display-mode      # normal/x11-only switcher
/usr/local/bin/highascg-nvidia-x-apply.sh # GPU perf on X start
```

---

## Quick Reference: One-Liner Workflow

```bash
# 1. Clean up
sudo bash -c 'rm -rf /opt/casparcg/{log/*,cef-cache/*} /tmp/caspar.log && apt clean'

# 2. Install eggs
cd /tmp && git clone https://github.com/pieroproietti/fresh-eggs && cd fresh-eggs && sudo ./fresh-eggs.sh

# 3. Produce ISO
sudo eggs produce --clone --basename "highascg-server"

# 4. Write to USB (on the server or copy ISO to another machine first)
sudo dd if=/home/eggs/highascg-server-amd64.iso of=/dev/sdX bs=4M status=progress oflag=sync

# 5. Boot USB on target → GRUB → Live
# 6. Install: sudo eggs krill
```

---

*Document created: 2026-04-22 | Related: [MANUAL_INSTALL.md](./MANUAL_INSTALL.md), [WO-12](../12_WO_PRODUCTION_INSTALLER.md), [openbox_autostart.md](../openbox_autostart.md)*
