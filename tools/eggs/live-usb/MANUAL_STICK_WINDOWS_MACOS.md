# Manual USB stick — Windows & macOS (Etcher + system partitioning)

ISO flash plus the **exFAT** data volume **`HIGHASCGEXF`** — that is the whole production stick. Union **persistence is legacy** (opt-in `HIGHASCG_LEGACY_UNION_PERSIST=1`, not for production): see [legacy-persistence/FLASH_AND_PERSIST.md](./legacy-persistence/FLASH_AND_PERSIST.md). Linux build host alternative: **`finish-operator-stick.sh`**.

Use this guide when you **prefer GUI tools** instead of automation scripts. Goal: bootable HighAsCG live ISO, plus **exFAT** labelled **`HIGHASCGEXF`** (WO‑47) with **`drop-update/`** server drops and operator folders.

---

## What you end up with

| Item | Purpose |
|------|---------|
| **Hybrid live partition(s)** | Written by Etcher — do **not** shrink or delete these or the stick won’t boot. |
| **exFAT data volume** | Extra space on the stick, **Volume label = `HIGHASCGEXF`** (exactly — 11 characters, all caps). Linux images with WO‑47 mount it at **`/home/casparcg/exfat`**. |
| **Folder layout on exFAT** | So boot sync and binds line up with HighAsCG defaults (see below). |

**Why not “highascg-data”?** exFAT only allows **≤11 characters** for the volume name. The shipped systemd unit looks for **`HIGHASCGEXF`**.

Suggested folders on the **`HIGHASCGEXF`** volume (create them in Explorer / Finder if empty):

| Folder | Use |
|--------|-----|
| **`drop-update/`** (+ **`drop-update/applied/`**) | **The playout drop.** Extract a server release (`highascg-server_*.tar.gz`) here so `drop-update/package.json` exists; on boot **`highascg-exfat-server-update.service`** applies it into **`~/highascg`** and records the applied stamp under `drop-update/applied/`. |
| **`drop-config/`** | Optional: `highascg.config.json` if you use the monolithic config sync pair. |
| **`configs/`** | Site / bundle exports (modular JSON + `casparcg.config`), synced with `~/highascg/config/`. |
| **`media/`** | Large media; on tuned images this tree is **bound** to **`~/highascg/media/exfat`**. |
| **`projects/`** | Project JSON catalog carried between machines. |
| **`network/`** | Operator IP file **`network/network.conf`** (WO‑95) — DHCP/static, editable from any OS. |
| **`templates/`** | Templates you carry between PCs. |
| **`snapshots/rear-panels/`** | Device / rear-panel snapshots (JSON, images, etc.). |
| **`decklink/`** | Optional — create manually if the playout machine has a DeckLink card; drop Blackmagic `desktopvideo_*.deb` here. |

> **Simulation stick (prep workstations only):** a `sim/highascg/` tree (extracted full release, `package.json` at `sim/highascg/package.json`) is used by the **simulation** tooling on Mac/Windows workstations. It is **not** used on playout sticks — playout updates go through `drop-update/`.

To update the server tree on the stick: extract **`highascg-server_*.tar.gz`** into **`drop-update/`** (so `drop-update/package.json` exists). On the next boot (or stick re-plug) **`highascg-exfat-server-update.service`** applies it. `update/server/` is the legacy drop location (still accepted once); prefer `drop-update/`.

> **Copying from Linux? Never `rsync -a` onto exFAT** — exFAT has no ownership, so `chown` fails with `EPERM` and rsync exits **23**, killing scripts. Use `rsync -rLt --modify-window=2` or plain `cp`.

---

## Prerequisites

- HighAsCG **`.iso`** file (from your build pipeline or release artifacts).
- USB stick **larger than the ISO** — you need **unallocated space at the end** after flashing for the data partition.
- **Balena Etcher** — [https://etcher.balena.io/](https://etcher.balena.io/) (or another raw ISO writer you trust).

---

## Part A — Flash the ISO (both OSes)

1. Install and open **Balena Etcher**.
2. **Flash from file** → choose your **`.iso`**.
3. **Select target** → pick your **USB drive** (check size and model; Etcher shows the device).
4. **Flash** and wait until verification finishes.
5. **Do not** format the small FAT/ISO partitions Etcher created — those are the boot image.

If the stick is only slightly larger than the ISO, you may have **no usable free space** for exFAT. Use a **bigger** stick or prepare the stick on **Linux** with **`tools/eggs/live-usb/add-exfat-data-partition.sh`** (handles hybrid layouts more predictably).

---

## Part B — Windows (Disk Management)

1. Open **Disk Management**: `Win + X` → **Disk Management** (or `diskmgmt.msc`).
2. Find your **USB disk** in the lower pane (e.g. **Disk 2** — **Removable**). Confirm by **capacity** and **model**; **not** your internal **Disk 0** NVMe/SSD.
3. After the Etcher partitions, you should see **unallocated** space at the **end** of that disk (black bar).
4. Right‑click the **unallocated** region → **New Simple Volume…**
5. Wizard:
   - Use **all** or part of the free space (leave room only if you want another partition later).
   - **Format**: **exFAT**.
   - **Volume label**: type exactly **`HIGHASCGEXF`** (no spaces).
6. Finish. Note the new drive letter (e.g. **`E:`**).
7. In **File Explorer**, open that drive and create:

   `drop-update`  
   `drop-update\applied`  
   `drop-config`  
   `configs`  
   `media`  
   `projects`  
   `network`  
   `templates`  
   `snapshots\rear-panels`

8. Extract a server release so that **`package.json`** ends up at:

   `E:\drop-update\package.json`

   (Extract `highascg-server_*.tar.gz` — e.g. with 7-Zip or `tar` in PowerShell — so the archive **contents**, not an extra nested folder, land in `drop-update\`. On boot, `highascg-exfat-server-update.service` applies it into `~/highascg`.)

**Troubleshooting**

- **No unallocated space**: stick too small, or Windows doesn’t show tail free space for this hybrid layout — use a larger USB or Linux **`add-exfat-data-partition.sh`**.
- **Wrong disk**: if you touched the internal disk, stop and seek recovery help — always identify **Removable** + correct size.

---

## Part C — macOS (Disk Utility)

1. Open **Disk Utility** (Cmd+Space → “Disk Utility”).
2. **View** → **Show All Devices**.
3. Select the **top-level** USB device (e.g. **Vendor USB 3.0 Media**), **not** only the first sub-volume under it.
4. Click **Partition** (or **+** / **Partition** depending on macOS version).
5. If the UI offers **free space** after the Etcher layout:
   - Add a **new** partition.
   - **Format**: **ExFAT**.
   - **Name**: **`HIGHASCGEXF`** (must match — this becomes the volume label).
6. Apply and wait for the operation to finish.
7. The volume should mount under **`/Volumes/HIGHASCGEXF`**. In Finder, create:

   `drop-update/applied`  
   `drop-config`  
   `configs`  
   `media`  
   `projects`  
   `network`  
   `templates`  
   `snapshots/rear-panels`

8. Extract the server release tarball so **`package.json`** is at:

   `/Volumes/HIGHASCGEXF/drop-update/package.json`

   Example (adjust filename):

   ```bash
   mkdir -p "/Volumes/HIGHASCGEXF/drop-update"
   tar -xzf ~/Downloads/highascg-server_YYYY-MM-DDTHHMMSSZ.tar.gz -C "/Volumes/HIGHASCGEXF/drop-update"
   ```

   If the archive has a single top-level folder containing the tree, move **that folder’s contents** into **`drop-update`** so **`package.json`** is a direct child of **`drop-update`**. On boot, **`highascg-exfat-server-update.service`** applies the drop into `~/highascg`.

**Troubleshooting**

- **Partition / Add** greyed out or errors after a hybrid ISO: macOS is strict about partition maps. Try **Terminal** `diskutil list` to inspect; if there is no clear free region, use a **Linux** host with **`add-exfat-data-partition.sh`**, or the repo script **`client/tools/live-usb/macos/make-highascg-stick.sh`** which attempts an automated remainder partition.
- **Always** select the **physical** USB device before partitioning, not “Macintosh HD”.

---

## Part D — Boot the stick (operator check)

1. Boot from USB (UEFI/BIOS boot menu).
2. Choose the default **Live** entry. Production sticks run **without** union persistence — durable operator data lives on exFAT. (Union persistence is legacy opt-in only: **[legacy-persistence/FLASH_AND_PERSIST.md](./legacy-persistence/FLASH_AND_PERSIST.md)**.)
3. When the exFAT volume is present and labelled **`HIGHASCGEXF`**, it should appear as **`/home/casparcg/exfat`** on the live system (WO‑47). **`drop-update/`** is where the boot-time server update looks for a new server tree.

---

## Related automation (optional)

| Script | When |
|--------|------|
| **`client/tools/operator-desktop/highascg-operator.js`** | Mac/Win CLI: **`prepare-stick`** → platform script; **`sim`** → **`portable-desktop`** launcher (see **`client/tools/operator-desktop/README.md`**). |
| [`make-highascg-stick.ps1`](../../../client/tools/live-usb/windows/make-highascg-stick.ps1) | Windows: raw ISO write + `diskpart` exFAT + folders; optional tarball / tree copy. |
| [`make-highascg-stick.sh`](../../../client/tools/live-usb/macos/make-highascg-stick.sh) | macOS: **`dd`** + exFAT remainder + folders; optional **`--tar-gz`** / **`--app-dir`**. |
| **[`EXFAT_DATA_ZERO_TOUCH.md`](EXFAT_DATA_ZERO_TOUCH.md)** | Full WO‑47 workflow, boot order, troubleshooting. |

Desktop launcher hub: **`npm run launcher`** (Electron). Direct simulation launch on a workstation: `node client/tools/portable-desktop/launch-sim-from-exfat.cjs`.

---

## Checklist summary

1. Etcher flash **`.iso`** to the correct USB (**verify size/name**).
2. **Unallocated tail** → new volume **ExFAT**, label **`HIGHASCGEXF`**.
3. Create **`drop-update/`** (and sibling folders above).
4. Extract the server release tarball into **`drop-update/`** so **`package.json`** is present.
5. Boot the default **Live** entry; the boot-time server update applies the drop (dependency changes: `npm ci` runs when enabled, or run it in `~/highascg` on the machine).
