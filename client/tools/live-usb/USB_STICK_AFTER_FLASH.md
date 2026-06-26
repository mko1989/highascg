# HighAsCG USB stick — after flashing the ISO

Production playout sticks need **three layers** on the USB:

| Layer | Size (32 GiB stick) | Filesystem | Label | Purpose |
|-------|----------------------|------------|-------|---------|
| Live image | ~5 GiB (from `dd` / Etcher) | ISO9660 / hybrid | `highascg` | Boot — **do not delete or reformat** |
| Live persistence | **2 GiB** (default) | ext4 | **`persistence`** | OS overlay (`/ union`) — drivers, `/etc`, `/var`, home |
| Operator data | **rest of disk** (~24 GiB) | exFAT | **`HIGHASCGEXF`** | Server drop, sim tree, media, config exports |

Scripts on the **ISO / server build host** create **persistence first**, then **exFAT fills the tail**. **MBR slots** (isohybrid) must be:

| MBR slot | Role | Device node (typical) |
|----------|------|------------------------|
| **1** | Hybrid live ISO (from `dd`) — **never format** | often hidden in `lsblk` |
| **2** | EFI system partition (ESP) — **never remove** | may show as empty `sda1` |
| **3** | **persistence** (2 GiB ext4) | `sda3` |
| **4** | **HIGHASCGEXF** (rest of disk) | `sda4` |

Using MBR **slot 1** for persistence **breaks boot** (overwrites the isohybrid entry).

**Do not put operator data on partition 2.** A tiny **sda2** exFAT slice is a common mistake. exFAT and persistence must sit **after the full ISO extent**, not in a 16 MB gap.

---

## Client vs server (what goes on the stick)

| Piece | Where | Release asset |
|--------|--------|----------------|
| **Playout server** (headless API on boot) | `HIGHASCGEXF/drop-update/` | `highascg-server_*.tar.gz` — top-level **`package.json`** in `drop-update/` |
| **Simulation tree** (optional, `--no-caspar`) | `HIGHASCGEXF/sim/highascg/` | Same **server** monolith tarball (must contain **`package.json`**) |
| **Operator UI** | **Not required on the stick** for production | Install **Electron launcher** on the operator Mac/PC (see below) |

This repository (**highascg-client**) is **UI + launcher only**. It does **not** run on the playout machine. The live stick runs **`HIGHASCG_HEADLESS=true`**; operators control playout with the launcher pointing at `http://<playout-host>:4200`.

| GitHub release ([highascg-client](https://github.com/mko1989/highascg-client/releases)) | Use |
|-------------------------------------------------------------------------------------------|-----|
| `HighAsCG-Launcher-<platform>_*.zip` | **Recommended** — prep kit + embedded UI (port **4350**) |
| `highascg-client_*.tar.gz` | `dist-web/` only — dev/extract; bundled inside launcher zips |

Build from source: `npm run launcher:prepare` then `npm run launcher`, or `npm run release:github-launcher` to publish platform zips.

---

## exFAT layout (`HIGHASCGEXF`)

After seeding (manual or script), expect:

```
HIGHASCGEXF/
  drop-update/              ← server release (package.json here)
  drop-update/applied/      ← optional stamp dir after apply
  drop-config/              ← optional site config export
  update/server/            ← optional extra server payloads
  sim/highascg/             ← simulation only (server tree + package.json)
  media/
  templates/
  configs/
  snapshots/rear-panels/
```

**Do not** put the **client** repo alone into `sim/highascg` for simulation — that path expects the **playout server** tree (`package.json` with server `main`). Use the server tarball from your server release pipeline.

---

## Recommended: Electron operator kit (Mac / Windows / Linux)

From a machine with **Node.js ≥ 20** (repo checkout or unpacked launcher zip):

```bash
cd /path/to/highascg-client
npm install
npm run launcher:prepare    # once — builds dist-web into launcher
npm run launcher            # GUI: flash guides, partition guide, sim, API host
```

Or double-click:

| OS | Launcher |
|----|----------|
| macOS / Linux | `client/tools/operator-desktop/HighAsCG-Launcher.command` |
| Windows | `client/tools/operator-desktop/HighAsCG-Launcher.cmd` |

**Prepare USB in one step (macOS):**

```bash
cd /path/to/highascg-client
sudo bash client/tools/live-usb/macos/make-highascg-stick.sh \
  --tar-gz ~/Downloads/highascg-server_YYYY-MM-DD.tar.gz \
  ~/Downloads/highascg_amd64_YYYY-MM-DD.iso
```

**Windows (elevated PowerShell):**

```powershell
cd \path\to\highascg-client
npm run operator-kit -- prepare-stick --iso C:\...\highascg_amd64.iso --tar-gz C:\...\highascg-server.tar.gz
```

The GUI **Partitioning & exFAT** tab mirrors the manual steps below (`client/tools/electron-launcher/index.html`).

---

## Linux build host — after `dd` (ISO integrator / server repo)

Persistence + exFAT scripts live on the **server / eggs** tree (not in this client repo):

```bash
cd /path/to/highascg-server   # ISO build / monolith repo
sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX
# optional: --iso /path/to/highascg_amd64_....iso
```

Or step by step:

```bash
USB=/dev/sda
ISO=/path/to/highascg_amd64_....iso
sudo umount ${USB}?* 2>/dev/null || true
export EXFAT_ISO_PATH="$ISO" PERSIST_ISO_PATH="$ISO" PERSIST_SIZE_MIB=2048 EXFAT_FILL_DISK=1
sudo bash tools/eggs/live-usb/add-union-persistence-partition.sh "$USB"
sudo bash tools/eggs/live-usb/add-exfat-data-partition.sh "$USB"
sudo mount -L HIGHASCGEXF /mnt/exfat
sudo bash tools/eggs/live-usb/seed-exfat-operator-layout.sh /mnt/exfat
# Server drop:
sudo tar -xzf /path/to/highascg-server_*.tar.gz -C /mnt/exfat/drop-update
test -f /mnt/exfat/drop-update/package.json && echo OK
sync && sudo umount /mnt/exfat
```

**Client repo** exFAT helper (hybrid ISO sticks, macOS-oriented MBR math):

```bash
sudo bash client/tools/live-usb/macos/add-highascg-exfat-mbr.sh /dev/rdiskN
```

---

## Linux — manual steps after `dd`

Replace `/dev/sda` with your whole-disk device (`lsblk -dpno NAME,SIZE,MODEL,TRAN`).

### 1. Stop auto-mounts and unmount

```bash
USB=/dev/sda
sudo systemctl stop highascg-exfat-sync.service highascg-exfat-arrive.service \
  home-casparcg-highascg-media-exfat.mount home-casparcg-exfat.mount 2>/dev/null || true
sudo umount ${USB}?* 2>/dev/null || true
```

### 2. Remove stale partitions 2+ (if present)

```bash
sudo parted "$USB" unit MiB print
# Remove leftover partition 2/3 only if you know they are not the ISO/ESP.
# Never delete partition 1 (live image).
```

### 3. Persistence + exFAT (server repo scripts)

Use `finish-operator-stick.sh` or the step-by-step block in **Linux build host** above.

### 4. Boot test

- GRUB → **Live with persistence** (required).
- Check: `lsblk -f`, `findmnt /home/casparcg/exfat`, `ls /home/casparcg/exfat/drop-update/package.json`.
- Playout API default **:4200**; operator UI is **not** served from the stick — use the **Electron launcher** on another machine.

---

## Windows — after Etcher

### A. Flash the ISO

1. [Balena Etcher](https://etcher.balena.io/) → **`.iso`** → USB disk → Flash.
2. Do **not** format the small ISO/boot partitions.

### B. exFAT operator volume

1. `Win + X` → **Disk Management** → select the **USB disk** in the **lower** pane.
2. Delete any **stale** small data partition (not the ISO slice).
3. **New Simple Volume** on trailing unallocated space → **exFAT**, label **`HIGHASCGEXF`**.
4. Create folders:

   ```
   drop-update\
   drop-update\applied\
   drop-config\
   update\server\
   sim\highascg\
   media\
   templates\
   configs\
   snapshots\rear-panels\
   ```

5. Extract **`highascg-server_*.tar.gz`** so **`package.json`** is at `E:\drop-update\package.json`.
6. Optional simulation: extract the **same server** tarball into `E:\sim\highascg\` (not the client-only repo).

### C. Persistence (required for playout sticks)

Create ext4 label **`persistence`** with `/persistence.conf` containing `/ union` — easiest on **Linux**:

```bash
sudo bash tools/eggs/live-usb/add-union-persistence-partition.sh /dev/sdX
```

Or use **`npm run operator-kit -- prepare-stick`** from **highascg-client** after installing Node.

### D. Operator UI on Windows

Download **`HighAsCG-Launcher-win32-x64_*.zip`** from [GitHub releases](https://github.com/mko1989/highascg-client/releases), extract, run **`HighAsCG-Launcher.exe`**. Set playout API host/port → **Open Control UI**.

---

## macOS — after Etcher

### A. Flash

Etcher or `sudo dd if=….iso of=/dev/rdiskN bs=4m` — do not reformat the ISO slice.

### B. exFAT (all-in-one script)

```bash
cd /path/to/highascg-client
sudo bash client/tools/live-usb/macos/make-highascg-stick.sh \
  --tar-gz ~/Downloads/highascg-server.tar.gz \
  ~/Downloads/highascg_amd64.iso
```

### B2. exFAT (manual / hybrid ISO)

If **Disk Utility → Partition** is greyed out:

```bash
sudo bash client/tools/live-usb/macos/add-highascg-exfat-mbr.sh /dev/rdiskN
```

Then seed folders (see **Partitioning** tab in `npm run launcher` or):

```bash
VOL="/Volumes/HIGHASCGEXF"
mkdir -p "$VOL/drop-update" "$VOL/sim/highascg" "$VOL/drop-config" "$VOL/media" \
  "$VOL/templates" "$VOL/configs" "$VOL/snapshots/rear-panels"
tar -xzf ~/Downloads/highascg-server.tar.gz -C "$VOL/drop-update"
tar -xzf ~/Downloads/highascg-server.tar.gz -C "$VOL/sim/highascg"   # optional sim
test -f "$VOL/drop-update/package.json" && echo OK
```

### C. Persistence

On Linux (recommended):

```bash
sudo bash tools/eggs/live-usb/add-union-persistence-partition.sh /dev/sdX
```

### D. Operator UI on macOS

Download **`HighAsCG-Launcher-darwin-arm64_*.zip`** (or x64), open **`HighAsCG-Launcher.app`**, or run from repo: `npm run launcher`.

---

## Checklist (all platforms)

| Step | Done when |
|------|-----------|
| ISO flashed | Stick boots to HighAsCG live menu |
| exFAT **`HIGHASCGEXF`** | Explorer/Finder/`df` shows **gigabytes** free, not ~15 MiB |
| Folders seeded | `drop-update/`, `drop-config/`, `media/`, … |
| **Server** in `drop-update/` | `drop-update/package.json` present |
| Persistence **`persistence`** | ext4 + `persistence.conf` with `/ union` |
| Boot choice | **Live with persistence** every time |
| Operator UI | Launcher installed on desk machine; API host set to playout box |

---

## More detail

| Topic | Location |
|--------|----------|
| Client launcher + releases | [`client/tools/electron-launcher/README.md`](../electron-launcher/README.md), `npm run release:github-launcher` |
| Operator CLI | [`client/tools/operator-desktop/README.md`](../operator-desktop/README.md) |
| macOS stick script | [`client/tools/live-usb/macos/make-highascg-stick.sh`](macos/make-highascg-stick.sh) |
| Stick Studio (Linux GUI) | [`client/tools/stick-tools/README.md`](../stick-tools/README.md) |
| Simulation from stick | [`client/tools/portable-desktop/README.md`](../portable-desktop/README.md) |
| Server persistence / eggs scripts | Server / ISO repo: `tools/eggs/live-usb/` |
| Server handoff (Art-Net, API) | `from_server/` docs on integrator workstation |
