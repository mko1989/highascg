# HighAsCG playout stick — quick start

Prepare a **bootable HighAsCG USB stick** with **Ventoy**: install Ventoy while reserving space at the end of the disk, create the operator **exFAT** partition in that space, copy the ISO onto the Ventoy volume, copy the starter folder layout, then boot the playout machine from the stick.

**Time:** ~25 minutes · **USB size:** **64 GiB recommended** (Ventoy holds the ISOs, the reserved tail holds operator data; 32 GiB is the practical minimum)

> **Why Ventoy and not Etcher?** Ventoy keeps the ISO as a *file*, so updating the machine later means dropping a new ISO next to the old one instead of reflashing the whole stick — and you can keep the previous build to fall back to. The old Etcher flow and its fixed **6 GiB offset** rule are retired; ignore any guide that still mentions them.

---

## What you end up with

Three partitions. Ventoy creates the first two; **you create the third.**

| # | Label | Size | Purpose |
|---|-------|------|---------|
| 1 | `Ventoy` | rest of the disk | exFAT — **the ISO files live here** |
| 2 | `VTOYEFI` | 32 MiB | Ventoy's boot partition — never touch it |
| 3 | **`HIGHASCGEXF`** | the space you reserved | exFAT — configs, media, server updates. Must be **exactly** this label (11 characters) |

On boot, the playout machine mounts **`HIGHASCGEXF`** at `/home/casparcg/exfat`, applies any server drop in `drop-update/`, syncs `configs/`, and starts the operator UI at **`http://<playout-ip>/`** (nginx proxies port 80 → `:4200`; **`http://<playout-ip>:4200/`** also works).

> **Do not put operator data on the Ventoy partition.** While the machine is booted from a stick, Ventoy holds that partition open for the ISO it is streaming, and Linux cannot mount it — the operator data has to be its own partition. That is the whole reason for reserving space in step 2.

---

## 1. Download the latest ISO

Always use the **current** build — filenames change with each release.

| Method | Link / command |
|--------|----------------|
| **Browser (recommended)** | [https://highascg.dpdns.org/](https://highascg.dpdns.org/) — click **DOWNLOAD BOOTABLE ISO** |
| **Direct URL (auto-latest)** | Read `download_url` from [release.json](https://highascg.dpdns.org/release.json) |

**Resume a large download (Linux / macOS Terminal):**

```bash
ISO_URL=$(python3 -c "import json,urllib.request; print(json.load(urllib.request.urlopen('https://highascg.dpdns.org/release.json'))['download_url'])")
wget -c "$ISO_URL" -O highascg-latest.iso
```

**Windows PowerShell:**

```powershell
$release = Invoke-RestMethod https://highascg.dpdns.org/release.json
Invoke-WebRequest -Uri $release.download_url -OutFile highascg-latest.iso
```

Current builds are **~3.7 GiB**. Trust **`release.json`**, not a fixed filename.

> **Building in house?** Wait for `build-highascg-egg.sh` to print **`Done. ISO:`** before you copy anything. The ISO file appears minutes earlier — its name carries the *produce* time, not the finish time — and the build keeps re-packing it after that. Copying during that window produces a stick that boots to the GRUB menu and then dies with *"invalid magic number / you need to load the kernel first"*. The build writes `<iso>.sha256` as its very last action, so **the sidecar existing is the signal that the ISO is finished.**

---

## 2. Install Ventoy, reserving space for operator data

Download Ventoy from [https://www.ventoy.net/](https://www.ventoy.net/). It ships installers for **Windows** and **Linux**.

> **macOS:** Ventoy has no official macOS installer. Prepare the stick once on a Windows or Linux machine; afterwards a Mac can copy ISOs and operator files onto it normally.

**Installing Ventoy erases the entire stick.** Check the device size and model before you click.

1. Run **`Ventoy2Disk.exe`** (Windows) or **`Ventoy2Disk.sh` / `VentoyGUI`** (Linux).
2. Open the **Option** menu → **Partition Configuration**.
3. Set **"Preserve some space at the end of the disk"** to the size you want for operator data, **in MB**. On a 64 GiB stick, **20000** (≈20 GiB) leaves plenty for several ISOs. Do not skip this — the space cannot be reserved after installation without redoing the stick.
4. Leave **Secure Boot support** off. The HighAsCG image ships unsigned NVIDIA and DeckLink drivers, so Secure Boot has to be disabled in the machine's BIOS regardless.
5. Select your USB device and click **Install**.

When it finishes you have the `Ventoy` partition, the 32 MiB `VTOYEFI` partition, and **unallocated space at the end** — that last part is what step 3 fills.

---

## 3. Create the exFAT partition (`HIGHASCGEXF`)

Use **only the unallocated space at the end** of the disk. Never resize or reformat the two partitions Ventoy created.

### Windows — Command Prompt (run as Administrator)

Replace `2` with your USB disk number from `list disk` — check the size column, picking the wrong disk destroys it.

```text
diskpart
list disk
select disk 2
create partition primary
assign letter=E
exit
```

With Ventoy's reserved space there is exactly one free region, at the end, so **`create partition primary` with no offset now does the right thing** — the old `offset=6291456` rule existed only because a flashed ISO left free space Windows misread, and it no longer applies.

Then format **outside** diskpart — diskpart's own `format` often fails on a freshly partitioned stick with *"The system cannot find the file specified"*:

```text
format E: /FS:exFAT /V:HIGHASCGEXF /Q
```

### Linux

Replace `/dev/sdX` with your stick — confirm with `lsblk` first.

```bash
lsblk -o NAME,SIZE,LABEL,MODEL            # identify the stick — check size and model
sudo parted /dev/sdX unit MiB print free  # find the trailing "Free Space" row
```

Take the **Start** and **End** of that trailing free region and create the partition inside it, then format:

```bash
sudo parted /dev/sdX --script mkpart primary <START>MiB <END>MiB
sudo mkfs.exfat -L HIGHASCGEXF /dev/sdX3
```

> `mkfs.exfat` on Ubuntu 24.04 comes from **exfatprogs** and takes **`-L`** for the label. The `-n` flag belongs to the older `exfat-utils` and fails here.

### macOS

Ventoy cannot install from macOS, but a Mac can add the third partition to an already-Ventoy'd stick. Replace `disk2` with your USB id from `diskutil list external physical` — **never `disk0` or `disk1`**.

```bash
diskutil list external physical
diskutil unmountDisk disk2
sudo fdisk -e /dev/rdisk2
```

In `fdisk`, one line at a time: `print` (note the free slot and where the Ventoy partitions end), `edit <free slot>`, type `07`, choose **sector** offsets, start at the first free sector after `VTOYEFI`, end at total sectors minus 1, then `print` to confirm the Ventoy slices are unchanged, `write`, `exit`. Then:

```bash
sudo newfs_exfat -v HIGHASCGEXF /dev/rdisk2s3
```

---

## 4. Copy the ISO onto the Ventoy partition

Copy the `.iso` to the **root of the `Ventoy` volume** (partition 1). Ventoy lists every ISO it finds there, so you can keep the previous build alongside the new one and pick at boot.

Then **flush and verify** — this is not optional, and it is where sticks most often go wrong:

```bash
cp highascg-latest.iso /media/<you>/Ventoy/ && sync
```

**Always eject/unmount properly.** A copy that looks complete in the file manager can still be sitting in RAM; pulling the stick leaves a file of the correct size full of stale bytes, and the machine boots to GRUB and then fails on the kernel.

Verify before you trust it — same size proves nothing, only the hash does:

```bash
# Linux, in the repo:
bash tools/eggs/live-usb/verify-stick-iso.sh /media/<you>/Ventoy/highascg-latest.iso
```

```powershell
# Windows: compare the two hashes by eye
Get-FileHash .\highascg-latest.iso -Algorithm SHA256
Get-FileHash E:\highascg-latest.iso -Algorithm SHA256
```

---

## 5. Copy the starter folder layout onto `HIGHASCGEXF`

Download **[HIGHASCGEXF-starter-layout.zip](guides/stick/HIGHASCGEXF-starter-layout.zip)** from this repo (or build it with `npm run exfat:starter-zip`).

> **Note:** `npm run exfat:starter-zip` writes a fresh zip to **`dist/HIGHASCGEXF-starter-layout.zip`**; the checked-in copy under `docs/guides/stick/` is a **snapshot** and can lag behind.

Unzip **directly onto the `HIGHASCGEXF` volume root** — not inside an extra folder, and **not** onto the Ventoy partition.

**Expected top-level folders after unzip:**

```
HIGHASCGEXF/
  configs/              ← factory settings + starter show
  drop-config/
  drop-update/          ← put highascg-server_*.tar.gz here later
  drop-update/applied/
  media/
  network/              ← operator IP file network.conf
  projects/
  snapshots/rear-panels/
  templates/
  .private/             ← per-machine pairing data (hidden folder)
  decklink/             ← optional DeckLink vendor debs
  README.txt
```

**Windows (PowerShell)** — adjust `E:` to the `HIGHASCGEXF` drive letter:

```powershell
Expand-Archive -Path HIGHASCGEXF-starter-layout.zip -DestinationPath E:\ -Force
```

**macOS / Linux:**

```bash
unzip -o HIGHASCGEXF-starter-layout.zip -d /Volumes/HIGHASCGEXF
```

> **Copying from Linux? Never `rsync -a` onto exFAT** — exFAT has no ownership, so `chown` fails with `EPERM` and rsync exits **23**, killing scripts mid-copy. Use `rsync -rLt --modify-window=2` or plain `cp`.

Eject the stick safely when copying finishes.

> **Optional later:** extract a [GitHub server release](https://github.com/mko1989/highascg/releases) (`highascg-server_*.tar.gz`) into `drop-update/` so `drop-update/package.json` exists. The starter zip alone is enough for a first boot test with the embedded ISO server tree.

### DeckLink drivers (optional — operator-supplied)

The public ISO does **not** ship Blackmagic Desktop Video. If the playout machine has a DeckLink card, copy vendor packages into **`decklink/`** on `HIGHASCGEXF`:

```
HIGHASCGEXF/decklink/
  desktopvideo_<version>_amd64.deb          ← required for Caspar decklink I/O
  desktopvideo-gui_<version>_amd64.deb      ← optional (Setup / Updater GUI)
```

Download [Desktop Video for Linux](https://www.blackmagicdesign.com/support/family/capture-and-playback), extract the tarball, and copy from `deb/x86_64/`. **`desktopvideo` alone is enough** for playout; without the GUI package, Settings → Desktop Video Setup / Updater simply report *GUI not installed*. On boot, HighAsCG installs from `decklink/` when needed (`highascg-decklink-install.service`).

---

## 6. Boot from the stick

1. Insert the USB into the **playout machine**
2. Power on and open **UEFI/BIOS setup** (common keys: `F2`, `F12`, `Del`, `Esc` at the manufacturer logo)
3. **Disable Secure Boot** — the NVIDIA and DeckLink drivers on the live image are not signed
4. Set **USB** as the first boot device, or use the one-time boot menu (`F12` on many boards)
5. Save and exit — the **Ventoy menu** appears first, listing the ISOs on the stick
6. Select the HighAsCG ISO → the **HighAsCG GRUB** menu appears → choose the default **Live** entry

After boot:

- Operator UI: **`http://127.0.0.1/`** on the machine, or **`http://<playout-ip>/`** from the LAN
- Confirm the data partition mounted: `findmnt /home/casparcg/exfat` should show your **third** partition, or check Settings → exFAT sync

---

## Checklist

| Step | Done when |
|------|-----------|
| ISO downloaded / built | Size matches [release.json](https://highascg.dpdns.org/release.json); in-house builds have printed `Done. ISO:` |
| Ventoy installed | Stick shows `Ventoy` + `VTOYEFI` **and** unallocated space at the end |
| exFAT created | Explorer/Finder shows **`HIGHASCGEXF`** with **gigabytes** free |
| ISO copied | Hash on the stick matches the source, after `sync` / safe eject |
| Starter zip copied | `configs/`, `drop-update/`, `media/`, … at the `HIGHASCGEXF` root |
| BIOS | Secure Boot **off**, USB boot **on** |
| Live boot | Ventoy menu → GRUB → playout starts; `:4200` responds |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **"invalid magic number / you need to load the kernel first"** after the GRUB menu | The ISO on the stick is corrupt — almost always copied while the build was still writing it, or pulled before the copy flushed. Re-copy, `sync`, and verify the hash (step 4) |
| No unallocated space after installing Ventoy | You skipped **Preserve some space at the end of the disk**. Re-run the Ventoy installer with it set — this erases the stick |
| Ventoy menu appears but no HighAsCG entry | The ISO is not at the **root** of the `Ventoy` partition, or the copy never finished |
| Stick boots but no exFAT sync | The label must be exactly **`HIGHASCGEXF`**, and it must be the **third** partition — not the Ventoy one |
| `diskpart`: *"The system cannot find the file specified"* | The partition is usually created anyway — replug, `assign letter` in diskpart, then `format E: /FS:exFAT /V:HIGHASCGEXF /Q` **outside** diskpart |
| Secure Boot error / no NVIDIA | Disable Secure Boot in BIOS |
| Updating to a new build | Copy the new ISO next to the old one and pick it in the Ventoy menu — no reflash, and the previous build stays as a fallback |

---

## More detail

| Topic | Document |
|-------|----------|
| exFAT vs ISO contents | [WO47_ISO_VS_EXFAT.md](WO47_ISO_VS_EXFAT.md) |
| Bridge disk + USB roles | [BRIDGE_DISK_AND_USB_EXFAT.md](BRIDGE_DISK_AND_USB_EXFAT.md) |
| Server drops on the stick | [EXFAT_SERVER_UPDATE.md](EXFAT_SERVER_UPDATE.md) |
| Building the ISO in house | [../tools/eggs/live-usb/BUILD_AND_FLASH.md](../tools/eggs/live-usb/BUILD_AND_FLASH.md) |
