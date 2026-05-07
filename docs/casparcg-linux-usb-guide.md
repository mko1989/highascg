# CasparCG & HighAsCG Linux Bootable USB — Comprehensive Build Guide

A complete guide to building a bootable Ubuntu Server USB drive running HighAsCG with integrated CasparCG, with live boot capability, optional local installation via Calamares, and a dedicated ext4 media partition on the internal drive.

---

## Overview & Architecture

```
[ USB Drive ]                    [ Internal 2TB Drive ]
  Ubuntu Server                    Windows Partition (untouched)
  HighAsCG + CasparCG              ----------------------------
  Penguins' Eggs + Calamares       ext4 Media Partition (1TB)
  NVIDIA DKMS drivers              Logs, media assets, config
        |                                     |
        └──── boots live ──────────────────── reads/writes ──────┘
```

**What this guide covers:**
1. Preparing the media partition in Windows
2. Installing and configuring Ubuntu Server on a reference machine
3. Installing NVIDIA drivers via DKMS
4. Installing and configuring HighAsCG with integrated CasparCG
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
- Create a user account: `casparcg`
- Enable **OpenSSH server** for remote access convenience
- Do **not** install any snaps

### 2.2 Update the system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential curl wget git software-properties-common
```

### 2.3 Set up automatic login on boot (no password prompt)

HighAsCG needs to start without human interaction. Configure auto-login:

```bash
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
sudo nano /etc/systemd/system/getty@tty1.service.d/override.conf
```

Paste this content:
```ini
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin casparcg --noclear %I $TERM
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

## Part 4 — Install and Configure HighAsCG & CasparCG

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
  openjdk-17-jre \
  nodejs \
  npm
```

### 4.2 Install Blackmagic DeckLink drivers

Download the Desktop Video package from the Blackmagic Design website and install it.

```bash
sudo dpkg -i desktopvideo_*.deb
sudo apt --fix-broken install -y
sudo reboot
```

### 4.3 Set up HighAsCG Repository

The system is designed to run from the user's home directory for simplicity and permission management.

```bash
cd /home/casparcg
# Clone the repository (if not already present)
git clone https://github.com/mko1989/highascg.git
cd highascg

# Install Node.js dependencies
npm install
```

### 4.4 Configure CasparCG Paths

Edit `/home/casparcg/highascg/casparcg.config`. Use relative paths so the system is portable.

```xml
<configuration>
    <paths>
        <media-path>media/</media-path>
        <log-path>log/</log-path>
        <data-path>data/</data-path>
        <template-path>template/</template-path>
    </paths>
</configuration>
```

### 4.5 Create a systemd service for HighAsCG autostart

```bash
sudo nano /etc/systemd/system/highascg.service
```

Paste the following:

```ini
[Unit]
Description=HighAsCG & CasparCG Playout Server
After=network.target caspar-data.mount
Requires=caspar-data.mount

[Service]
Type=simple
User=casparcg
Group=casparcg
WorkingDirectory=/home/casparcg/highascg
ExecStart=/usr/bin/node /home/casparcg/highascg/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable highascg.service
```

---

## Part 5 — Prepare the ext4 Data Partition

The data partition stores media, logs, and templates persistently.

### 5.1 Identify and Create Partition (Refer to lsblk/parted steps in Part 5 of the original guide)

1. `lsblk` to find the disk.
2. `sudo parted /dev/sda` to create a partition in the free space.
3. `sudo mkfs.ext4 -L caspar-data /dev/sda4` to format with label `caspar-data`.

### 5.2 Configure Mounting

We mount the data partition into a specific location and then symlink or bind-mount the internal folders of `highascg` to it.

```bash
sudo mkdir -p /mnt/caspar-data
sudo nano /etc/fstab
```

Add:
```
LABEL=caspar-data  /mnt/caspar-data  ext4  defaults,nofail,x-systemd.automount  0  2
```

### 5.3 Link HighAsCG folders to the Data Partition

To keep everything in "one working dir" while persisting data:

```bash
sudo mount /mnt/caspar-data
sudo mkdir -p /mnt/caspar-data/{media,log,data,template}
sudo chown -R casparcg:casparcg /mnt/caspar-data

# Create symlinks in the working directory
cd /home/casparcg/highascg
rm -rf media log data template
ln -s /mnt/caspar-data/media media
ln -s /mnt/caspar-data/log log
ln -s /mnt/caspar-data/data data
ln -s /mnt/caspar-data/template template
```

---

## Part 6 — Install Penguins' Eggs and Build ISO

### 6.1 Install Eggs

```bash
curl -fsSL https://pieroproietti.github.io/penguins-eggs-ppa/KEY.gpg | sudo gpg --dearmor -o /usr/share/keyrings/penguins-eggs.gpg
echo "deb [signed-by=/usr/share/keyrings/penguins-eggs.gpg] https://pieroproietti.github.io/penguins-eggs-ppa ./" | sudo tee /etc/apt/sources.list.d/penguins-eggs.list
sudo apt update && sudo apt install -y eggs
sudo eggs dad -d
```

### 6.2 Configure Exclusions

```bash
sudo nano /etc/penguins-eggs.d/exclude.list
```

Exclude the mount point and the actual data (since they are symlinked):
```
/mnt/caspar-data
/home/casparcg/highascg/media/*
/home/casparcg/highascg/log/*
/home/casparcg/highascg/data/*
/home/casparcg/highascg/template/*
/home/casparcg/highascg/node_modules
```

### 6.3 Build the ISO

```bash
sudo eggs produce --max --basename highascg-live
```

The ISO will be in `/home/eggs/`.

---

## Part 7 — Flash and Boot

Use Balena Etcher or `dd` to flash the ISO to a USB drive.
Boot the target machine from USB.

---

## Quick Reference — Key Paths

| Purpose | Path |
|---|---|
| Working Directory | `/home/casparcg/highascg/` |
| HighAsCG Entry | `/home/casparcg/highascg/index.js` |
| CasparCG Binary | `/home/casparcg/highascg/bin/casparcg` |
| Systemd Service | `/etc/systemd/system/highascg.service` |
| Data Partition | `/mnt/caspar-data/` |
| Persistent Media | `/home/casparcg/highascg/media` (Symlink) |
