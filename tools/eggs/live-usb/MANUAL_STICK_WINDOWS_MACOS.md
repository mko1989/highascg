# Manual USB stick — Windows & macOS (Etcher + system partitioning)

ISO flash, **exFAT**, and **persistence** (required for production sticks). Linux build host: **`finish-operator-stick.sh`** — see [FLASH_AND_PERSIST.md](./FLASH_AND_PERSIST.md).

Use this guide when you **prefer GUI tools** instead of automation scripts. Goal: bootable HighAsCG live ISO, plus **exFAT** labelled **`HIGHASCGEXF`** (WO‑47) with **`drop-update/`** server drops and operator folders, plus **ext4 persistence** (usually finished on Linux).

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
| **`sim/highascg/`** | Put the **extracted** release here (repository root sits *inside* `sim/highascg` — **`package.json`** at `sim/highascg/package.json`). **Typical GitHub prerelease:** `tar -xzf highascg_*.tar.gz` with `-C` set to **`sim/highascg`** (see checklist). Boot-time sync (WO‑47) copies **newer** files from here ↔ **`~/highascg`** (with safe excludes like `node_modules`, `.git`, `media`). |
| **`drop-config/`** | Optional: `highascg.config.json` if you use the monolithic config sync pair. |
| **`media/`** | Large media; on tuned images this tree is **bound** to **`~/highascg/media/exfat`**. |
| **`templates/`** | Templates you carry between PCs. |
| **`configs/`** | Site / bundle exports. |
| **`snapshots/rear-panels/`** | Device / rear-panel snapshots (JSON, images, etc.). |

After dropping a new release tree under **`sim/highascg`**, reboot the live system (or run exFAT sync from Settings/API and **restart** **`highascg`** if dependencies in **`package.json`** changed: run **`npm ci`** in **`~/highascg`** on the machine).

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

If the stick is only slightly larger than the ISO, you may have **no usable free space** for exFAT. Use a **bigger** stick or prepare the stick on **Linux** with **`tools/live-usb/add-exfat-data-partition.sh`** (handles hybrid layouts more predictably).

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

   `sim\highascg`  
   `drop-config`  
   `media`  
   `templates`  
   `configs`  
   `snapshots\rear-panels`

8. Unzip a HighAsCG release so that **`package.json`** ends up at:

   `E:\sim\highascg\package.json`

   (If the zip contains a single top folder, move its **contents** into **`sim\highascg`**, not an extra nested folder unless you prefer that layout on exFAT only.)

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

   `sim/highascg`  
   `drop-config`  
   `media`  
   `templates`  
   `configs`  
   `snapshots/rear-panels`

8. Extract the release tarball so **`package.json`** is at:

   `/Volumes/HIGHASCGEXF/sim/highascg/package.json`

   Example (adjust filename):

   ```bash
   mkdir -p "/Volumes/HIGHASCGEXF/sim/highascg"
   tar -xzf ~/Downloads/highascg_YYYY-MM-DDTHHMMSSZ.tar.gz -C "/Volumes/HIGHASCGEXF/sim/highascg"
   ```

   If the archive has a single top-level folder containing the repo, move **that folder’s contents** into **`sim/highascg`** so **`package.json`** is direct children of **`sim/highascg`** (same as unzip flow).

**Troubleshooting**

- **Partition / Add** greyed out or errors after a hybrid ISO: macOS is strict about partition maps. Try **Terminal** `diskutil list` to inspect; if there is no clear free region, use a **Linux** host with **`add-exfat-data-partition.sh`**, or the repo script **`tools/live-usb/macos/make-highascg-stick.sh`** which attempts an automated remainder partition.
- **Always** select the **physical** USB device before partitioning, not “Macintosh HD”.

---

## Part D — Boot the stick (operator check)

1. Boot from USB (UEFI/BIOS boot menu).
2. Choose **Live with persistence** if your image uses **`/ union`** persistence (recommended for drivers/state); see **[FLASH_AND_PERSIST.md](./FLASH_AND_PERSIST.md)**.
3. When the exFAT volume is present and labelled **`HIGHASCGEXF`**, it should appear as **`/home/casparcg/exfat`** on the live system (WO‑47). **`sim/highascg`** is the path the default boot sync uses for portable app updates.

---

## Related automation (optional)

| Script | When |
|--------|------|
| **`operator-desktop/highascg-operator.js`** | Mac/Win CLI: **`prepare-stick`** → platform script; **`sim`** → **`portable-desktop`** launcher (see **`tools/operator-desktop/README.md`**). |
| **[`windows/make-highascg-stick.ps1`](windows/make-highascg-stick.ps1)** | Windows: raw ISO write + `diskpart` exFAT + folders; optional tarball / tree into **`sim\highascg`**. |
| **[`macos/make-highascg-stick.sh`](macos/make-highascg-stick.sh)** | macOS: **`dd`** + exFAT remainder + folders; optional **`--tar-gz`** / **`--app-dir`**. |
| **[`EXFAT_DATA_ZERO_TOUCH.md`](EXFAT_DATA_ZERO_TOUCH.md)** | Full WO‑47 workflow, boot order, troubleshooting. |

---

## Checklist summary

1. Etcher flash **`.iso`** to the correct USB (**verify size/name**).
2. **Unallocated tail** → new volume **ExFAT**, label **`HIGHASCGEXF`**.
3. Create **`sim/highascg`** (and sibling folders above).
4. Extract release tarball (or unzip) into **`sim/highascg`** so **`package.json`** is present.
5. Boot live + persistence; reboot after updates so sync runs **before** **`highascg.service`** (or sync + **`npm ci`** + service restart).
