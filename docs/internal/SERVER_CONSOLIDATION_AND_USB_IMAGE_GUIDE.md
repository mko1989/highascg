# Server Consolidation & USB Image Guide

This document outlines the strategy for merging **HighAsCG** and **CasparCG** into a unified, portable folder structure and preparing a bootable "Golden Image" USB for rapid deployment.

---

## 1. Unified Directory Structure

To make the system portable and easy to back up, we will move away from system-wide `/opt` installs and consolidate everything under the primary user's home directory (`/home/casparcg`).

### Proposed Layout:
```text
/home/casparcg/
├── highascg/             # The HighAsCG Node.js application
│   ├── config/           # App configuration files
│   ├── src/              # Server source code
│   └── web/              # Web UI assets
├── casparcg-server/      # CasparCG Server binaries & scanner
│   ├── casparcg.config   # The main CasparCG config (managed by HighAsCG)
│   ├── media/            # Symlink to the media partition
│   └── template/         # Symlink to the templates partition
└── scripts/              # Utility scripts (start, stop, update)
```

### Consolidation Steps:
1.  **Move Application**: Clone/Move HighAsCG to `/home/casparcg/highascg`.
2.  **Move CasparCG**: Extract CasparCG Server to `/home/casparcg/casparcg-server`.
3.  **Update Paths**: Update `highascg.config.json` to reflect the new relative paths for CasparCG and media.

---

## 2. Managing the Media Partition

For a broadcast server, keeping the OS image small while allowing for large media storage is critical.

### The Strategy:
- **OS Partition**: Small (approx. 20-40GB), containing the OS, HighAsCG, and CasparCG binaries.
- **Media Partition**: The remainder of the drive (HDD/SSD), formatted as EXT4 or XFS.

### Implementation:
1.  **Mounting**: Configure `/etc/fstab` to mount the media partition to `/mnt/media` or `/data/media`.
2.  **Symlinking**: Create a symbolic link from the CasparCG folder to the mount point:
    ```bash
    ln -s /mnt/media /home/casparcg/casparcg-server/media
    ```
3.  **Benefit**: When you "re-image" the OS partition from your USB drive, the media partition remains untouched, preserving your library.

---

## 3. Creating the Bootable USB "Golden Image"

The goal is a USB drive that acts as a "Live Demo" but can also "Install" to a machine.

### Recommended Tools:
- **Cubic (Custom Ubuntu ISO Creator)**: Allows you to "chroot" into a live ISO, install HighAsCG/CasparCG/Drivers, and then repack it into a bootable `.iso`.
- **Clonezilla**: Best for creating a bit-for-bit image of an already configured SSD.
- **Respin / Linux Respin**: Tools specifically designed to turn a running system into an ISO.

### Workflow with Cubic (Recommended):
1.  Start with a clean Ubuntu 24.04 ISO.
2.  In the Cubic terminal:
    - Install Node.js, NVIDIA drivers, and DeckLink drivers.
    - Copy the `casparcg` home folder content.
    - Set up `nodm` and `openbox` autostart.
3.  Generate the ISO.
4.  Flash to USB using **Rufus** (on Windows) or `dd` (on Linux).

---

## 4. "Windows Installer" Possibilities

Can we run an installer in Windows for this?

### Option A: The "USB Preparer" (Most Realistic)
You can create a simple Windows `.bat` or `.ps1` script (or a small Electron app) that:
1.  Downloads the "Golden ISO".
2.  Uses a CLI tool (like `rufus-cmd`) to flash it to a selected USB drive.
3.  This isn't a "HighAsCG Installer for Windows", but rather a "HighAsCG Deployment Tool".

### Option B: WSL2 (Windows Subsystem for Linux)
HighAsCG *can* run on Windows via WSL2, but direct hardware access (DeckLink/NVIDIA GPU) for CasparCG is extremely complex and not recommended for production.

### Option C: Porting to Windows
If you specifically want a Windows installer (`.exe`/`.msi`) to run HighAsCG + CasparCG on a Windows Server:
- Use **Inno Setup** or **NSIS**.
- The installer would bundle Node.js, CasparCG binaries, and the HighAsCG source.
- It would setup Windows Services (NSSM) instead of systemd units.

---

## 5. Summary: The "Live USB" Vision

1.  **Boot**: Operator plugs in USB and selects "Try HighAsCG".
2.  **Run**: The system boots into `nodm`, starts X11, launches CasparCG, and starts the HighAsCG Web UI.
3.  **Discover**: The operator can see the local media if the internal HDD is mounted.
4.  **Install**: If they like it, they click "Install HighAsCG" (the standard Ubuntu installer), which copies the pre-configured environment to the internal drive.

---
*Created: 2026-04-30 | Related: WO-11, WO-12*
