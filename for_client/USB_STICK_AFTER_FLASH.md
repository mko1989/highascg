# HighAsCG USB stick — after flashing the ISO

Production playout sticks need **three layers** on the USB:

| Layer | Size (32 GiB stick) | Filesystem | Label | Purpose |
|-------|----------------------|------------|-------|---------|
| Live image | ~5 GiB (from `dd` / Etcher) | ISO9660 / hybrid | `highascg` | Boot — **do not delete or reformat** |
| Live persistence | **2 GiB** (default) | ext4 | **`persistence`** | OS overlay (`/ union`) — drivers, `/etc`, `/var`, home |
| Operator data | **rest of disk** (~24 GiB) | exFAT | **`HIGHASCGEXF`** | `drop-update/`, `drop-config/`, `media/`, … |

Scripts create **persistence first**, then **exFAT fills the tail**. **MBR slots** (isohybrid) must be:

| MBR slot | Role | Device node (typical) |
|----------|------|------------------------|
| **1** | Hybrid live ISO (from `dd`) — **never format** | often hidden in `lsblk` |
| **2** | EFI system partition (ESP) — **never remove** | may show as empty `sda1` |
| **3** | **persistence** (2 GiB ext4) | `sda3` |
| **4** | **HIGHASCGEXF** (rest of disk) | `sda4` |

Using MBR **slot 1** for persistence **breaks boot** (overwrites the isohybrid entry). Older scripts did that by mistake.

**Do not put operator data on partition 2.** A tiny **sda2** exFAT slice is a common mistake (leftover partition table or wrong placement). Use the steps below so exFAT and persistence sit **after the full ISO extent**, not in a 16 MB gap.

---

## Linux build host — one script from `dd`

```bash
cd /path/to/highascg
sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX
# optional: --iso /home/eggs/mnt/highascg_amd64_YYYY-MM-DD_HHMM.iso
```

Layout on a **32 GiB** stick: hybrid ISO (~5 GiB) · **persistence** (2 GiB) · **exFAT** (remainder, ~17+ GiB).

## What you need

- USB **larger than the ISO** (recommended **≥ 32 GB** for ~5 GiB ISO + 2 GiB persistence + large exFAT).
- HighAsCG **`.iso`** already written to the stick (Etcher, `dd`, or Stick Studio).
- For **persistence**, Linux is the most reliable option (`add-union-persistence-partition.sh`). macOS/Windows can add exFAT; persistence is documented here with limitations.

---

## Linux build host (recommended) — you just finished `dd`

Replace `/dev/sda` with your whole-disk device (`lsblk -dpno NAME,SIZE,MODEL,TRAN`).

### 1. Stop auto-mounts and unmount the stick

```bash
USB=/dev/sda
sudo systemctl stop highascg-exfat-sync.service highascg-exfat-arrive.service \
  home-casparcg-highascg-media-exfat.mount home-casparcg-exfat.mount 2>/dev/null || true
sudo umount ${USB}?* 2>/dev/null || true
```

### 2. Remove stale partitions 2+ (if present)

After `dd`, an **old** stick may still show **partition 2** (tiny exFAT or empty). That slot must **not** be used for operator data.

```bash
sudo parted "$USB" unit MiB print
# If partition 2 (and 3) exist from a previous attempt — not required for a brand-new dd-only layout — remove them:
# sudo parted "$USB" rm 3
# sudo parted "$USB" rm 2
```

Only remove partitions **you know** are leftovers. **Never** delete partition **1** (the live image).

### 3. One-shot finish (persistence + exFAT + folders)

From the HighAsCG repo:

```bash
cd /path/to/highascg
ISO=/home/eggs/mnt/highascg_amd64_YYYY-MM-DD_HHMM.iso   # same ISO you flashed
sudo bash tools/eggs/live-usb/finish-operator-stick.sh "$USB" --iso "$ISO"
```

Or step by step (order matters):

```bash
export EXFAT_ISO_PATH="$ISO"
export PERSIST_ISO_PATH="$ISO"
export PERSIST_SIZE_MIB=2048
export EXFAT_FILL_DISK=1
sudo bash tools/eggs/live-usb/add-union-persistence-partition.sh "$USB"
sudo bash tools/eggs/live-usb/add-exfat-data-partition.sh "$USB"
sudo mkdir -p /mnt/exfat
sudo mount -L HIGHASCGEXF /mnt/exfat
df -h /mnt/exfat    # expect most of the stick free (e.g. ~20+ GiB on 32 GiB), not ~4 GiB or ~15 MiB
sudo bash tools/eggs/live-usb/seed-exfat-operator-layout.sh /mnt/exfat
sync
sudo umount /mnt/exfat
```

### 4. Sync map on the build host (required once)

Older images copied **`~/highascg` → `sim/highascg` on the stick** via a legacy **`sim-highascg`** sync pair. **`finish-operator-stick.sh`** now installs the repo map (**`drop-config` only**). Manual fix:

```bash
sudo bash /path/to/highascg/tools/eggs/live-usb/install-exfat-sync-map.sh
```

If **`sim/`** already exists on the stick, delete it after upgrading the map (optional: `sudo rm -rf /mnt/exfat/sim` while the volume is mounted).

### 5. Boot test

- GRUB → **Live with persistence** (required).
- Check: `lsblk -f`, `findmnt /home/casparcg/exfat`, `ls /home/casparcg/exfat/drop-update`.

Optional: copy a server release into `drop-update/` on the stick (`highascg-server_*.tar.gz` contents, with top-level `package.json`).

---

## Windows — after Etcher

### A. Flash the ISO

1. [Balena Etcher](https://etcher.balena.io/) → select **`.iso`** → select the **USB disk** → Flash.
2. Do **not** format the small ISO/boot partitions Etcher created.

### B. exFAT operator volume (required)

1. `Win + X` → **Disk Management** (`diskmgmt.msc`).
2. Select the **USB disk** in the **lower** pane (check **Removable** + capacity — **not** internal Disk 0).
3. If there is a **second partition** that is **not** the ISO (e.g. old 16 MB exFAT from a previous attempt): right-click → **Delete volume** (only that stale slice — **not** the boot/ISO partition).
4. Right-click **unallocated** space at the **end** → **New Simple Volume** → use space for exFAT, leave room at the end if you will add persistence on Linux later (or use all but ~8 GiB for exFAT and leave tail unallocated).
5. Format **exFAT**, volume label exactly: **`HIGHASCGEXF`**.
6. Create folders on `E:` (or your drive letter):

   ```
   drop-update\
   drop-update\applied\
   drop-config\
   media\
   templates\
   configs\
   snapshots\rear-panels\
   ```

7. Server updates: extract **`highascg-server_*.tar.gz`** so **`package.json`** is at `E:\drop-update\package.json` (not under `sim\`).

### C. Persistence partition (required for playout sticks)

Windows Disk Management can create a **second** partition, but Debian Live expects:

- Filesystem **ext4**
- Volume label exactly **`persistence`**
- File **`/persistence.conf`** on that volume containing one line: `/ union`

That is awkward to do correctly in Windows without third-party tools. **Recommended:** finish the stick on a **Linux** machine once:

```bash
sudo bash tools/eggs/live-usb/add-union-persistence-partition.sh /dev/sdX
```

(After exFAT exists and stale partitions are removed — see Linux section.)

---

## macOS — after Etcher

### A. Flash the ISO

Etcher (or `sudo dd if=… of=/dev/rdiskN bs=4m`) — same rules as Windows: do not reformat the ISO partition.

### B. exFAT operator volume (required)

1. **Disk Utility** → **View → Show All Devices**.
2. Select the **top-level** USB device (not “Macintosh HD”).
3. **Partition**:
   - If an old **small** data partition exists from a previous stick, remove it in Disk Utility (do **not** remove the Etcher/ISO slice).
   - Add a partition from **free space** at the end: format **ExFAT**, name **`HIGHASCGEXF`** (this becomes the volume label).
4. In Finder under **`/Volumes/HIGHASCGEXF`**, create:

   ```
   drop-update/
   drop-update/applied/
   drop-config/
   media/
   templates/
   configs/
   snapshots/rear-panels/
   ```

5. Server drop: extract release into **`drop-update/`** with **`package.json`** at the top of that folder.

If **Partition** is greyed out (common with hybrid ISOs), use a **Linux** host and `add-exfat-data-partition.sh`, or the repo’s macOS automation when available under `tools/eggs/live-usb/macos/`.

### C. Persistence partition (required for playout sticks)

macOS Disk Utility does not reliably create the **`persistence`** + **`persistence.conf`** layout Live expects. On a Linux machine:

```bash
sudo bash tools/eggs/live-usb/add-union-persistence-partition.sh /dev/sdX
```

Run **after** exFAT is in place. Always boot **Live with persistence**.

---

## Checklist (all platforms)

| Step | Done when |
|------|-----------|
| ISO flashed | Stick boots to HighAsCG live menu |
| exFAT **`HIGHASCGEXF`** | `df` / Explorer shows **gigabytes** free, not ~15 MiB |
| Folders seeded | `drop-update/`, `drop-config/`, `media/`, … |
| Persistence **`persistence`** | ext4 + `persistence.conf` with `/ union` |
| Boot choice | **Live with persistence** every time |
| Server drop (optional) | `drop-update/package.json` present |

---

## More detail

- Linux scripts: `tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md`, `tools/eggs/live-usb/FLASH_AND_PERSIST.md`
- Build host flash flow: `tools/eggs/live-usb/BUILD_AND_FLASH.md`
- exFAT vs persistence roles: ask your integrator or see `docs/WO47_ISO_VS_EXFAT.md` in the server repo
