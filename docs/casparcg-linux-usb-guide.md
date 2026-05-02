# CasparCG Linux Bootable USB — Comprehensive Build Guide

A complete guide to building a bootable Ubuntu Server USB drive running CasparCG, with live boot capability, optional local installation via Calamares, and a dedicated ext4 media partition on the internal drive.

---

## Overview & Architecture

```
[ USB Drive ]                    [ Internal 2TB Drive ]
  Ubuntu Server                    Windows Partition (untouched)
  CasparCG + services              ----------------------------
  Penguins' Eggs + Calamares       ext4 Media Partition (1TB)
  NVIDIA DKMS drivers              Logs, media assets, config
        |                                     |
        └──── boots live ──────────────────── reads/writes ──────┘
```

**What this guide covers:**
1. Preparing the media partition in Windows
2. Installing and configuring Ubuntu Server on a reference machine
3. Installing NVIDIA drivers via DKMS
4. Installing and configuring CasparCG with autostart
5. Preparing the ext4 data partition for live boot use
6. Configuring Eggs exclusions and building the ISO
7. Flashing to USB and verifying the result

---

## Part 1 — Prepare the Media Partition in Windows

Do this first, before touching Linux. You only need to do it once.

### 1.1 Shrink the Windows NTFS partition

1. Press `Win + X` → select **Disk Management**
2. Right-click your 2TB NTFS partition → **Shrink Volume**
3. In the *"Enter the amount of space to shrink in MB"* field enter:
   ```
   1048576
   ```
   (that is exactly 1TB in MB)
4. Click **Shrink**
5. You will now see **1TB of Unallocated space** at the end of the disk
6. **Do not format it** — leave it as unallocated. Linux will handle the rest.

> ⚠️ If Windows says it cannot shrink by the full amount, it means unmovable files (hibernate file, page file) are blocking it. Disable hibernation first:
> ```
> powershell (run as Administrator): powercfg /h off
> ```
> Then retry the shrink.

---

## Part 2 — Set Up Ubuntu Server on the Reference Machine

This is the machine you will use to build the master image. It should have the same GPU as your target machines (or at minimum the same NVIDIA GPU generation).

### 2.1 Install Ubuntu Server 22.04 LTS

Download Ubuntu Server 22.04 LTS from ubuntu.com and install it normally. During installation:

- Choose **minimal installation** — no desktop environment needed
- Create a user account (e.g. `caspar`)
- Enable **OpenSSH server** for remote access convenience
- Do **not** install any snaps

### 2.2 Update the system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential curl wget git software-properties-common
```

### 2.3 Set up automatic login on boot (no password prompt)

CasparCG needs to start without human interaction. Configure auto-login:

```bash
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
sudo nano /etc/systemd/system/getty@tty1.service.d/override.conf
```

Paste this content:
```ini
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin caspar --noclear %I $TERM
```

---

## Part 3 — Install NVIDIA Drivers via DKMS

Using DKMS ensures the driver kernel module is automatically recompiled when the image is booted on a machine with a different kernel version or minor hardware variation.

### 3.1 Install DKMS and kernel headers

```bash
sudo apt install -y dkms linux-headers-$(uname -r) linux-headers-generic
```

### 3.2 Add the NVIDIA PPA and install the driver

```bash
sudo add-apt-repository ppa:graphics-drivers/ppa -y
sudo apt update
sudo apt install -y nvidia-driver-550 nvidia-dkms-550
```

> Replace `550` with the current recommended driver version for your GPU.
> To check which version is recommended:
> ```bash
> ubuntu-drivers devices
> ```

### 3.3 Verify DKMS registration

After installation, confirm the driver is registered with DKMS:

```bash
dkms status
```

Expected output (version numbers will vary):
```
nvidia/550.xx.xx, 6.x.x-xx-generic, x86_64: installed
```

### 3.4 Reboot and verify

```bash
sudo reboot
# After reboot:
nvidia-smi
```

You should see your GPU listed with driver version confirmed.

---

## Part 4 — Install and Configure CasparCG

### 4.1 Install dependencies

```bash
sudo apt install -y \
  ffmpeg \
  fonts-liberation \
  libgles2 \
  libgles2-mesa \
  libx11-6 \
  libxrandr2 \
  libxinerama1 \
  libxi6 \
  libxcursor1 \
  openjdk-17-jre
```

### 4.2 Install Blackmagic DeckLink drivers

Download the Desktop Video package from the Blackmagic Design website:
```
https://www.blackmagicdesign.com/support/family/capture-and-playback
```

Install it:
```bash
sudo dpkg -i desktopvideo_*.deb
sudo apt --fix-broken install -y
sudo reboot
```

After reboot, verify DeckLink is detected:
```bash
BlackmagicFirmwareUpdater status
```

### 4.3 Download and install CasparCG Server

```bash
sudo mkdir -p /opt/casparcg
cd /opt/casparcg

# Download latest CasparCG release (check github.com/CasparCG/server for current version)
wget https://github.com/CasparCG/server/releases/download/v2.3.3/casparcg_server-2.3.3-Linux.tar.gz
tar -xzf casparcg_server-*.tar.gz --strip-components=1
sudo chown -R caspar:caspar /opt/casparcg
```

### 4.4 Configure CasparCG to use the media partition

Edit the CasparCG configuration file:

```bash
nano /opt/casparcg/casparcg.config
```

Set the media and log paths to point to the data partition mount point (which we will set up in Part 5):

```xml
<configuration>
  <paths>
    <media-path>/mnt/caspar-data/media/</media-path>
    <log-path>/mnt/caspar-data/logs/</log-path>
    <data-path>/mnt/caspar-data/data/</data-path>
    <template-path>/mnt/caspar-data/templates/</template-path>
  </paths>

  <!-- Your channel and consumer configuration below -->
  <channels>
    <channel>
      <video-mode>1080i5000</video-mode>
      <consumers>
        <decklink>
          <device>1</device>
          <key-device>2</key-device>
        </decklink>
      </consumers>
    </channel>
  </channels>
</configuration>
```

> Adjust `video-mode` and DeckLink device numbers for your setup.

### 4.5 Create required directories on the data partition

These will be created again in Part 5 when we prepare the partition, but define them here for reference:

```
/mnt/caspar-data/
  media/
  logs/
  data/
  templates/
```

### 4.6 Create a systemd service for CasparCG autostart

```bash
sudo nano /etc/systemd/system/casparcg.service
```

Paste the following:

```ini
[Unit]
Description=CasparCG Playout Server
After=network.target caspar-data.mount
Requires=caspar-data.mount

[Service]
Type=simple
User=caspar
WorkingDirectory=/opt/casparcg
ExecStart=/opt/casparcg/run.sh
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable casparcg.service
```

---

## Part 5 — Prepare the ext4 Data Partition

This is done from the Ubuntu system (either booted from USB or installed). The unallocated space created in Part 1 will now become a formatted, auto-mounting ext4 partition.

### 5.1 Identify the disk

```bash
lsblk
```

Look for your 2TB drive — it will show the Windows NTFS partition and the unallocated space. Identify the device name (e.g. `/dev/sda`) and note the partition number of the unallocated space.

Example output:
```
sda           2TB
├─sda1        100MB   vfat    (Windows EFI)
├─sda2        128MB           (Windows MSR)
├─sda3        931GB   ntfs    (Windows C:)
└─                    free    (your 1TB unallocated space)
```

### 5.2 Create the new partition

```bash
sudo parted /dev/sda
```

Inside parted:
```
(parted) print free          # confirm free space location
(parted) mkpart primary ext4 932GB 2000GB   # adjust start/end to match your free space
(parted) print               # confirm new partition
(parted) quit
```

> Use the exact start and end values shown by `print free` — do not guess them.

### 5.3 Format the new partition as ext4

```bash
# Refresh partition table
sudo partprobe /dev/sda

# Format (replace sda4 with your actual new partition number)
sudo mkfs.ext4 -L caspar-data /dev/sda4
```

The `-L caspar-data` sets a volume label — we'll use this for reliable mounting.

### 5.4 Create the mount point

```bash
sudo mkdir -p /mnt/caspar-data
```

### 5.5 Configure automatic mounting via /etc/fstab

Using the label means the partition mounts correctly regardless of whether it appears as sda4, sdb4, etc. on different machines:

```bash
sudo nano /etc/fstab
```

Add this line at the end:

```
LABEL=caspar-data  /mnt/caspar-data  ext4  defaults,nofail,x-systemd.automount  0  2
```

> `nofail` is critical — it tells the system to boot normally even if this partition is not present (important for live USB scenarios on machines where the internal drive may be different).

### 5.6 Create the directory structure on the partition

```bash
sudo mount /mnt/caspar-data
sudo mkdir -p /mnt/caspar-data/{media,logs,data,templates}
sudo chown -R caspar:caspar /mnt/caspar-data
```

### 5.7 Create a systemd mount unit (belt and suspenders)

This ensures the partition is mounted before CasparCG starts, even if fstab is slow:

```bash
sudo nano /etc/systemd/system/caspar-data.mount
```

```ini
[Unit]
Description=CasparCG Data Partition
Before=casparcg.service

[Mount]
What=LABEL=caspar-data
Where=/mnt/caspar-data
Type=ext4
Options=defaults,nofail

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable caspar-data.mount
```

### 5.8 Handle the case where the partition is absent (live boot on unknown hardware)

Add a startup check script so CasparCG falls back gracefully if the data partition isn't found:

```bash
sudo nano /opt/casparcg/run.sh
```

```bash
#!/bin/bash

MOUNT=/mnt/caspar-data

# Wait up to 10 seconds for the data partition to mount
for i in $(seq 1 10); do
  if mountpoint -q "$MOUNT"; then
    echo "Data partition mounted at $MOUNT"
    break
  fi
  echo "Waiting for data partition... ($i/10)"
  sleep 1
done

# If partition never mounted, use local fallback paths
if ! mountpoint -q "$MOUNT"; then
  echo "WARNING: Data partition not found. Using local fallback paths."
  mkdir -p /opt/casparcg/fallback/{media,logs,data,templates}
  export CASPAR_MEDIA=/opt/casparcg/fallback/media
else
  export CASPAR_MEDIA=$MOUNT/media
fi

exec /opt/casparcg/casparcg
```

```bash
chmod +x /opt/casparcg/run.sh
```

---

## Part 6 — Install Penguins' Eggs and Configure Exclusions

### 6.1 Install Penguins' Eggs

```bash
# Add the Penguins' Eggs repository
curl -fsSL https://pieroproietti.github.io/penguins-eggs-ppa/KEY.gpg | sudo gpg --dearmor -o /usr/share/keyrings/penguins-eggs.gpg

echo "deb [signed-by=/usr/share/keyrings/penguins-eggs.gpg] https://pieroproietti.github.io/penguins-eggs-ppa ./" | \
  sudo tee /etc/apt/sources.list.d/penguins-eggs.list

sudo apt update
sudo apt install -y eggs
```

### 6.2 Initialise Eggs

```bash
sudo eggs dad -d
```

This creates the Eggs configuration directory at `/etc/penguins-eggs.d/` and sets up defaults.

### 6.3 Configure exclusions

Eggs uses an exclusion file to skip directories when building the ISO. This is how you keep the image lean and avoid including unwanted content.

Edit the exclusions file:

```bash
sudo nano /etc/penguins-eggs.d/exclude.list
```

Add the following — each line is a path that will be **excluded from the ISO**:

```
# System runtime directories (always exclude)
/proc
/sys
/dev
/run
/tmp

# Swap
/swapfile
*.swap

# CasparCG data partition mount point
# (this is on the internal drive, not the USB — exclude entirely)
/mnt/caspar-data

# CasparCG media, logs, and data (exclude from image)
# These live on the data partition, not the OS
/opt/casparcg/media
/opt/casparcg/logs
/opt/casparcg/data
/opt/casparcg/fallback

# Large or machine-specific files
/var/log
/var/cache/apt/archives
/var/tmp
/home/caspar/.cache
/home/caspar/Downloads
/root/.cache

# NVIDIA compiled module cache (will recompile via DKMS on target hardware)
/var/lib/dkms/*/build
/usr/src/nvidia-*/*/dkms.conf.orig

# Any test media you may have had locally during setup
/opt/casparcg/test-media
```

> **Important:** The `/mnt/caspar-data` exclusion is critical. Without it, Eggs would try to include whatever is currently mounted there (your internal drive's media partition) into the ISO — potentially gigabytes of media files.

### 6.4 Verify the exclusions file is being picked up

```bash
sudo eggs produce --dry-run 2>&1 | grep -i exclud
```

You should see your excluded paths listed in the output.

---

## Part 7 — Build the ISO with Penguins' Eggs

### 7.1 Run a preflight check

```bash
sudo eggs dad --help
sudo eggs status
```

Confirm everything looks correct — partition layout, user accounts, services.

### 7.2 Produce the ISO

```bash
sudo eggs produce --max --basename casparcg-live
```

Flags explained:
- `--max` — maximum compression (slower build, smaller ISO)
- `--basename` — sets the output filename

The build will take 10–30 minutes depending on CPU speed. The ISO will be saved to:
```
/home/eggs/
```

### 7.3 Check the ISO size

```bash
ls -lh /home/eggs/*.iso
```

For a lean CasparCG + Ubuntu Server setup you should see somewhere between **3GB and 6GB**.

---

## Part 8 — Flash the ISO to USB

### On Linux (from the build machine or any Linux machine):

```bash
# Identify your USB drive - BE CAREFUL to select the right device
lsblk

# Flash (replace sdX with your USB device - NOT a partition, the whole device)
sudo dd if=/home/eggs/casparcg-live.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

### On Windows:

Use **Balena Etcher** (free, from etcher.balena.io):
1. Select the `.iso` file
2. Select the USB drive
3. Click Flash

### On macOS:

```bash
sudo dd if=casparcg-live.iso of=/dev/rdiskX bs=4m
```

---

## Part 9 — Boot and Verify

### 9.1 Boot from USB

1. Insert the USB drive into the target machine
2. Power on and enter the BIOS boot menu (usually `F12`, `F8`, or `Del` at POST)
3. Select the USB drive
4. Ubuntu boots — CasparCG starts automatically via systemd

### 9.2 Verify services on first boot

```bash
# Check CasparCG service status
systemctl status casparcg.service

# Check data partition is mounted
mountpoint /mnt/caspar-data
df -h /mnt/caspar-data

# Check NVIDIA driver loaded correctly on this hardware
nvidia-smi

# Check DeckLink detected
BlackmagicFirmwareUpdater status
```

### 9.3 DKMS recompilation (first boot on new hardware)

On first boot with different hardware, DKMS will automatically recompile the NVIDIA kernel module. This happens in the background and may take 1–3 minutes. You can monitor it:

```bash
journalctl -f -u dkms
# or
dkms status
```

CasparCG's systemd service will wait for the system to be ready before starting.

---

## Part 10 — Installing to the Local Partition (Optional)

If the user wants to install the system permanently to the local machine (faster than USB, no USB required to boot):

### 10.1 Launch Calamares (the graphical installer)

Calamares is included in the Eggs-built ISO:

```bash
sudo calamares
```

Or if a desktop environment is available, it may appear as an "Install System" icon.

### 10.2 In the Calamares installer

1. Select **language and timezone**
2. At the **partitioning step** — choose **Manual partitioning**
3. Select the free space or the ext4 partition you want to install the OS onto
   - **Do not touch the Windows NTFS partition**
   - **Do not touch the caspar-data ext4 partition** (that's your media storage)
   - If you have a separate unallocated area for the OS, create a new ext4 partition there and set it as `/` (root)
4. Set the bootloader to install to the **internal drive** (e.g. `/dev/sda`)
5. Create the user account (keep `caspar` for consistency)
6. Complete the installation

### 10.3 After installation reboot

Remove the USB drive. The machine will boot from the internal drive. CasparCG will autostart, and the caspar-data partition will mount automatically via fstab.

---

## Quick Reference — Key Paths

| Purpose | Path |
|---|---|
| CasparCG installation | `/opt/casparcg/` |
| CasparCG config | `/opt/casparcg/casparcg.config` |
| CasparCG startup script | `/opt/casparcg/run.sh` |
| Systemd service | `/etc/systemd/system/casparcg.service` |
| Data partition mount | `/mnt/caspar-data/` |
| Media files | `/mnt/caspar-data/media/` |
| Logs | `/mnt/caspar-data/logs/` |
| Templates | `/mnt/caspar-data/templates/` |
| Eggs ISO output | `/home/eggs/` |
| Eggs exclusions | `/etc/penguins-eggs.d/exclude.list` |
| fstab | `/etc/fstab` |

---

## Troubleshooting

**CasparCG doesn't start on boot**
```bash
journalctl -u casparcg.service -n 50
```

**Data partition not mounting**
```bash
journalctl -u caspar-data.mount
lsblk -f   # check if partition is visible and has correct label
```

**NVIDIA driver not loaded after boot on new hardware**
```bash
dkms status
journalctl -b | grep -i nvidia
# If missing, trigger recompile manually:
sudo dkms autoinstall
```

**Eggs ISO too large**
```bash
# Check what is taking up space before building:
sudo du -sh /* | sort -rh | head -20
# Add any large unexpected directories to exclude.list
```

**DeckLink not detected**
```bash
# Check kernel module is loaded
lsmod | grep blackmagic
# Reload if needed
sudo modprobe blackmagic
BlackmagicFirmwareUpdater status
```

---

*Guide covers Ubuntu Server 22.04 LTS, CasparCG 2.3.x, Penguins' Eggs latest, NVIDIA driver 550 series. Adjust version numbers as needed for current releases.*
