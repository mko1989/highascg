# HighAsCG playout stick — quick start (Windows)

Prepare a **bootable HighAsCG USB stick** on **Windows**: install Ventoy while reserving space at the end of the disk, create the operator **exFAT** partition in that space with Disk Management, copy the ISO onto the Ventoy volume, copy the starter folder layout, then boot the playout machine from the stick.

**Time:** ~25 minutes · **USB size:** **32 GiB is enough** — Ventoy holds the ISOs, the reserved tail holds operator data

**You need:** Windows 10 version 1703 or newer (earlier Windows only exposes the *first* partition of a removable drive, which hides the operator volume).

> **Why Ventoy and not Etcher?** Ventoy keeps the ISO as a *file*, so updating a machine later means dropping a new ISO next to the old one instead of reflashing the whole stick — and the previous build stays as a fallback. The old Etcher flow and its fixed **6 GiB offset** rule are retired; ignore any guide that still mentions them.

---

## What you end up with

Three partitions. Ventoy creates the first two; **you create the third.**

| # | Label | Size | Purpose |
|---|-------|------|---------|
| 1 | `Ventoy` | rest of the disk | exFAT — **the ISO files live here** |
| 2 | `VTOYEFI` | 32 MiB | Ventoy's boot partition — never touch it |
| 3 | **`HIGHASCGEXF`** | the space you reserved | exFAT — configs, media, server updates. Must be **exactly** this label (11 characters) |

On boot, the playout machine mounts **`HIGHASCGEXF`** at `/home/casparcg/exfat`, applies any server drop in `drop-update/`, syncs `configs/`, and starts the operator UI at **`http://<playout-ip>/`** (nginx proxies port 80 → `:4200`; **`http://<playout-ip>:4200/`** also works).

> **Do not put operator data on the Ventoy partition.** While the machine is booted from a stick, Ventoy holds that partition open for the ISO it is streaming, and Linux cannot mount it. Operator data has to be its own partition — that is the whole reason for reserving space in step 2.

---

## 1. Download the latest ISO

Always use the **current** build — filenames change with each release.

| Method | Link |
|--------|------|
| **Browser (recommended)** | [https://highascg.dpdns.org/](https://highascg.dpdns.org/) — click **DOWNLOAD BOOTABLE ISO** |
| **Direct URL (auto-latest)** | Read `download_url` from [release.json](https://highascg.dpdns.org/release.json) |

**PowerShell:**

```powershell
$release = Invoke-RestMethod https://highascg.dpdns.org/release.json
Invoke-WebRequest -Uri $release.download_url -OutFile highascg-latest.iso
```

Current builds are **~3.7 GiB**. Trust **`release.json`**, not a fixed filename.

> **Copying an ISO you built in house?** Wait for `build-highascg-egg.sh` to print **`Done. ISO:`** before copying it anywhere. The file appears minutes earlier — its name carries the *produce* time, not the finish time — and the build keeps re-packing it afterwards. Copying inside that window produces a stick that reaches the GRUB menu and then dies with *"invalid magic number / you need to load the kernel first"*. The build writes `<iso>.sha256` last, so **the sidecar existing is the signal the ISO is finished.**

<!-- SCREENSHOT: download page with DOWNLOAD BOOTABLE ISO highlighted -->

---

## 2. Install Ventoy, reserving space for operator data

Download Ventoy from [https://www.ventoy.net/](https://www.ventoy.net/) and unzip it. No installation needed — run the executable from the folder.

**Installing Ventoy erases the entire stick.** Check the device size and model before you click.

1. Run **`Ventoy2Disk.exe`**.
2. Open the **Option** menu → **Partition Configuration**.
3. Set **"Preserve some space at the end of the disk"** to the size you want for operator data, **in MB**. On a 32 GiB stick, **10000** (≈10 GiB) is a good split — it still leaves room for four or five ISOs at ~3.7 GiB each. **Do not skip this** — the space cannot be reserved afterwards without redoing the stick from scratch.
4. Leave **Secure Boot support** off. The HighAsCG image ships unsigned NVIDIA and DeckLink drivers, so Secure Boot has to be disabled in the machine's BIOS regardless.
5. Select your USB device, click **Install**, and confirm the two warnings.

<!-- SCREENSHOT: Ventoy2Disk main window with the correct USB device selected -->
<!-- SCREENSHOT: Option → Partition Configuration with "Preserve some space at the end of the disk" set to 10000 MB -->

When it finishes, Explorer shows a **`Ventoy`** drive, and Disk Management will show the 32 MiB `VTOYEFI` partition plus **unallocated space at the end** — that last part is what step 3 fills.

---

## 3. Create the exFAT partition (`HIGHASCGEXF`)

Use **Disk Management** — the standard Windows disk utility. Press **Win + X** → **Disk Management** (or run `diskmgmt.msc`).

> Disk Management is safe here, and this is a change from older HighAsCG guides. Those forbade it because a raw-flashed ISO left free space Windows misread, so a new partition landed *inside* the boot image. Ventoy reserves the space itself, at the end of the disk, so the unallocated block you see is the **only** free region and there is no offset to get right.

1. Find your USB stick in the lower pane — identify it by **size**, and by the `Ventoy` and 32 MB partitions next to the unallocated block. **Getting the wrong disk destroys it.**
2. Right-click the **Unallocated** block at the end → **New Simple Volume…**
3. **Size:** accept the default (the whole unallocated block).
4. **Drive letter:** accept the default, or pick any free letter.
5. **Format this volume with the following settings:**
   - **File system:** **exFAT**
   - **Allocation unit size:** Default
   - **Volume label:** **`HIGHASCGEXF`** — exactly this, all capitals, no spaces
   - **Perform a quick format:** ticked
6. **Finish.** The new volume appears in Explorer with gigabytes free.

<!-- SCREENSHOT: Disk Management showing Ventoy + VTOYEFI + the Unallocated block, right-click menu open -->
<!-- SCREENSHOT: New Simple Volume wizard format page — exFAT, label HIGHASCGEXF, quick format ticked -->

> **The label is not cosmetic.** The playout machine looks for a volume labelled exactly `HIGHASCGEXF` (exFAT allows at most 11 characters). Anything else and the stick boots but no operator data is applied. If you mistype it, right-click the volume in Explorer → **Rename**.

---

## 4. Copy the ISO onto the Ventoy partition

Copy the `.iso` to the **root of the `Ventoy` drive** — not into a subfolder, and not onto `HIGHASCGEXF`. Ventoy lists every ISO it finds there, so you can keep the previous build alongside the new one and choose at boot.

**Then eject properly.** Use **Safely Remove Hardware** (or right-click the drive → **Eject**) and wait for the confirmation. A copy that looks finished in Explorer can still be sitting in RAM; pulling the stick early leaves a file of exactly the right size full of stale bytes, and the machine boots to GRUB and then fails on the kernel.

**Verify before you trust it** — matching size proves nothing, only the hash does:

```powershell
Get-FileHash .\highascg-latest.iso -Algorithm SHA256
Get-FileHash E:\highascg-latest.iso -Algorithm SHA256    # E: = the Ventoy drive
```

The two hashes must be identical. If they differ, delete the copy on the stick, copy again, eject properly, and re-check.

<!-- SCREENSHOT: Explorer showing the ISO at the root of the Ventoy drive -->

---

## 5. Copy the starter folder layout onto `HIGHASCGEXF`

Download **[HIGHASCGEXF-starter-layout.zip](guides/stick/HIGHASCGEXF-starter-layout.zip)** from this repo.

Unzip **directly onto the `HIGHASCGEXF` volume root** — not inside an extra folder, and not onto the Ventoy drive. Adjust `F:` to the `HIGHASCGEXF` drive letter:

```powershell
Expand-Archive -Path HIGHASCGEXF-starter-layout.zip -DestinationPath F:\ -Force
```

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

Eject the stick safely when copying finishes.

<!-- SCREENSHOT: Explorer showing the unzipped folder layout at the root of HIGHASCGEXF -->

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
- Confirm the data partition mounted: Settings → exFAT sync, or on the machine run `findmnt /home/casparcg/exfat` — it should show the **third** partition

<!-- SCREENSHOT: Ventoy boot menu listing the HighAsCG ISO -->
<!-- SCREENSHOT: HighAsCG GRUB menu with the Live entry selected -->

---

## Checklist

| Step | Done when |
|------|-----------|
| ISO downloaded | Size matches [release.json](https://highascg.dpdns.org/release.json) |
| Ventoy installed | Explorer shows a `Ventoy` drive; Disk Management shows unallocated space at the end |
| exFAT created | Explorer shows **`HIGHASCGEXF`** with **gigabytes** free |
| ISO copied | `Get-FileHash` matches on both sides, after a safe eject |
| Starter zip copied | `configs/`, `drop-update/`, `media/`, … at the `HIGHASCGEXF` root |
| BIOS | Secure Boot **off**, USB boot **on** |
| Live boot | Ventoy menu → GRUB → playout starts; `:4200` responds |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| **"invalid magic number / you need to load the kernel first"** after the GRUB menu | The ISO on the stick is corrupt — almost always copied while the build was still writing it, or the stick was pulled before the copy flushed. Re-copy, eject safely, and compare `Get-FileHash` (step 4) |
| No unallocated space in Disk Management | You skipped **Preserve some space at the end of the disk**. Re-run the Ventoy installer with it set — this erases the stick |
| Ventoy drive nearly full | Delete the oldest ISO from the `Ventoy` drive — each build is ~3.7 GiB |
| Explorer only shows one USB drive | Windows older than 10 version 1703 exposes only the first partition of a removable drive. Update Windows, or use a newer machine to prepare the stick |
| Ventoy menu appears but no HighAsCG entry | The ISO is not at the **root** of the `Ventoy` drive, or the copy never finished |
| Stick boots but no exFAT sync | The label must be exactly **`HIGHASCGEXF`**, and it must be the **third** partition — not the Ventoy one |
| **New Simple Volume…** greyed out | You right-clicked an existing partition instead of the **Unallocated** block, or you picked the wrong disk |
| Secure Boot error / no NVIDIA | Disable Secure Boot in BIOS |
| Updating to a new build | Copy the new ISO next to the old one and pick it in the Ventoy menu — no reflash, and the previous build stays as a fallback |

---

## More detail

| Topic | Document |
|-------|----------|
| Stick contents / server drops | [../tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md](../tools/eggs/live-usb/MANUAL_STICK_WINDOWS_MACOS.md) |
| exFAT vs ISO contents | [WO47_ISO_VS_EXFAT.md](WO47_ISO_VS_EXFAT.md) |
| Bridge disk + USB roles | [BRIDGE_DISK_AND_USB_EXFAT.md](BRIDGE_DISK_AND_USB_EXFAT.md) |
| Server drops on the stick | [EXFAT_SERVER_UPDATE.md](EXFAT_SERVER_UPDATE.md) |
| Building the ISO in house | [../tools/eggs/live-usb/BUILD_AND_FLASH.md](../tools/eggs/live-usb/BUILD_AND_FLASH.md) |
