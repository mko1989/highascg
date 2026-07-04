# WO-133 — Flow: USB exFAT Configuration Sync

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Completed  
**Nodes:** `usb:exfat-stick`, `svc:exfat-sync`, `svc:exfat-boot`

---

## Endpoint Flow Documentation

This document explicitly maps out the interaction chain that results in automatic configuration synchronization when an operator plugs in a physical USB drive.

### 1. Initialization (This does that)
An operator physically inserts an exFAT-formatted USB stick labeled `HIGHASCGEXF` into a USB port. The Linux kernel detects the hardware insertion and emits a udev event. This triggers a specific udev rule matching the label, which then invokes the `highascg-exfat-arrive.service` systemd unit.

### 2. Execution Mechanism (In that way)
The systemd service mounts the USB drive to `/home/casparcg/exfat/` and subsequently runs the `tools/runtime/exfat-sync-cli.js` Node script. This script compares the modification times (`mtime`) of project configurations, media, and settings between the USB stick and the persistent NVMe bridge storage. It executes an intelligent bidirectional Rsync transfer based on the newest files.

### 3. Final Result (Which results in that reacting this way)
As a result, any offline work or new media placed on the stick by the operator is seamlessly merged into the system's live storage. The HighAsCG server reacts to these file system changes via watchers, automatically reloading projects, resetting configurations, or updating live templates without requiring manual intervention from the user.
