# WO-147 — Flow: Filesystem Mounts

**Parent:** [WO-83 index](../83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `fs:opt-casparcg`, `fs:bridge`, `fs:exfat`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that defines the persistent storage layer and partitions the OS from live production data.

### 1. Initialization (This does that)
During early boot, the `/etc/fstab` file instructs the kernel to mount specific physical partitions into the virtual filesystem tree. The primary OS root partition (`/`) is mounted alongside a dedicated high-throughput NVMe RAID partition at `/mnt/bridge`.

### 2. Execution Mechanism (In that way)
The core CasparCG engine, config files, and libraries are stored statically in `/opt/casparcg`, which is part of the root partition. However, the rapidly changing production data—video media, templates, logs, and project databases—are symlinked or explicitly configured to point into the `/mnt/bridge` NVMe array (or the `casparcg` user's home directory which resides on it). When a temporary USB stick is plugged in, the `highascg-exfat-arrive` service dynamically mounts the `fs:exfat` volume to bridge data securely to the NVMe layer via rsync.

### 3. Final Result (Which results in that reacting this way)
As a result, high-bandwidth video playback and recording operations write directly to the ultra-fast NVMe storage, isolating IO contention from the OS root drive. If the root OS drive corrupts or needs a complete re-image, the `/mnt/bridge` partition remains safely untouched, allowing technicians to rebuild the OS while reacting with zero loss of show templates or media assets.
