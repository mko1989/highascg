# Chapter 3: Hardware & OS Hooks

HighAsCG controls Ubuntu OS internals via shell APIs (`sudo`).

## 1. exFAT USB Media Ingest (`routes-exfat-sync.js`)
The `GET /api/system/exfat-sync` and `POST /api/system/exfat-sync/run` endpoints manage transferring files from USB drives directly to CasparCG's `/media` directory.

**Ingestion Workflow:**
1. Polkit rule `51-highascg-udisks-casparcg-headless.rules` allows `udisks2` to mount inserted USBs automatically.
2. `routes-exfat-sync.js` reads mapping configurations from `/etc/highascg/exfat-sync.json`.
3. To trigger a sync, clients call `POST /api/system/exfat-sync/run`.
   * **Dry Run**: If payload contains `{ "dryRun": true }`, no files are modified.
   * **Execution**: To commit the sync and allow `mtime` overwrites, the exact string `"EXFAT_SYNC"` must be passed in the payload:
     ```json
     { "dryRun": false, "confirm": "EXFAT_SYNC" }
     ```

## 2. GPU & Topologies (`system-hardware-*`)
HighAsCG dynamically rewrites OS display layouts based on Operator UI configurations.

* **NVIDIA Hooks**: `system-hardware-nvidia.js` reads `nvidia-settings` and configures proprietary Mosaic or simple Multi-GPU setups. It also specifically manipulates VBlank sync settings (`Sync to VBlank off`) for Screen consumers to prevent rendering stalls.
* **xrandr Parsing**: `system-hardware-gpu-layout.js` calls `xrandr` to list physical connectors (e.g., `DP-1`, `HDMI-A-0`) and maps them to logical screens or multiviewers, persisting state.

## 3. Staged Caspar Startup (`tools/runtime/casparcg-staged-start.sh`)
In complex installations, the bridge server boots first. CasparCG is "staged" (paused) until configuration generation finishes.

* **Status**: `GET /api/system/caspar-arm`
* **Arming**: `POST /api/system/caspar-arm` creates a `caspar-armed` lockfile located at `/home/casparcg/highascg/data/caspar-armed`.
* **Execution**: The systemd script loops until the lockfile appears, then launches `casparcg-server`.
* **Disarming**: `DELETE /api/system/caspar-arm` deletes the file.
