# Chapter 3: Hardware & OS Hooks

HighAsCG controls Ubuntu OS internals via shell APIs (`sudo`).

## 1. exFAT USB Media Ingest (`routes-exfat-sync.js`)
The `GET /api/system/exfat-sync` and `POST /api/system/exfat-sync/run` endpoints manage cross-volume mtime sync between the bridge disk, USB stick, and the playout host working tree.

**Ingestion Workflow:**
1. Polkit rule `51-highascg-udisks-casparcg-headless.rules` allows `udisks2` to mount inserted USBs automatically.
2. `routes-exfat-sync.js` reads mapping configurations from `/etc/highascg/exfat-sync.json`.
3. To trigger a sync, clients call `POST /api/system/exfat-sync/run`.
   * **Dry Run**: If payload contains `{ "dryRun": true }`, no files are modified.
   * **Execution**: To commit the sync and allow `mtime` overwrites, the exact string `"EXFAT_SYNC"` must be passed in the payload:
     ```json
     { "dryRun": false, "confirm": "EXFAT_SYNC" }
     ```

**Sync map pairs (v2):** configs, state JSON, media ingest, and **`projects/`** directories. Pair ids: `bridge-projects` (bidirectional mtime) and `usb-projects` (boot pull stick → `~/highascg/projects/` only).

## 1b. Project volume sync (`project-volume-sync.js`)

Show files live in `~/highascg/projects/` at runtime. USB and bridge volumes mirror them with different rules:

| Volume | Label | List catalog | Boot | On save |
|--------|-------|--------------|------|---------|
| USB stick | `HIGHASCGEXF` | Primary when mounted | Pull stick → working dir | Push **only saved slug** |
| Bridge disk | `HIGHASCGDAT` | Merged when mounted | Mtime sync via exFAT pair | Push **only saved slug** |
| Local | — | Fallback when no stick | — | Always written first |

Implementation hooks:
- `listProjectsFromVolumes()` — used by `GET /api/project/list`
- `pushProjectSlugToVolumes(slug)` — called after every save/autosave in `project-scenes.js`
- `pullProjectSlugFromUsbIfNewer(slug)` — called before read in `project-store.js`

Seed `projects/` on new volumes:

```bash
sudo bash tools/eggs/live-usb/seed-exfat-operator-layout.sh /home/casparcg/exfat
sudo bash tools/eggs/live-usb/seed-bridge-operator-layout.sh /home/casparcg/bridge
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
