# Install HighAsCG to internal disk (Calamares)

Graphical **install-to-disk** from the live USB stick using **Calamares** (eggs integration). Use this for a **permanent playout machine** — not for preparing the USB stick itself.

**Related:** [LIVE_USB_IMAGE.md](LIVE_USB_IMAGE.md) (build/flash stick), [STICK_QUICK_START.md](STICK_QUICK_START.md) (Windows/macOS stick prep), [WO47_ISO_VS_EXFAT.md](WO47_ISO_VS_EXFAT.md) (exFAT operator data after install).

---

## Launch the installer

From the live session (operator display or SSH):

```bash
# Web UI: Settings → Nuclear → Install to disk
# Or:
sudo -n /usr/local/bin/launch-calamares.sh
```

Requires passwordless sudo for `launch-calamares.sh` (baked on factory ISO). Calamares opens on **`:0`**.

**Note:** `eggs krill` (text installer) exists on the **eggs build host**, not on the live ISO (`penguins-eggs` is excluded from squashfs). On the stick, use **Calamares**.

---

## Before partitioning

### 1. Pick the correct disk

```bash
lsblk -o NAME,TYPE,SIZE,MODEL,TRAN,FSTYPE,PARTLABEL
```

| What you see | Install here? |
|--------------|----------------|
| `TRAN=usb`, SanDisk ~57 G, `iso9660` | **No** — live USB stick |
| Internal SSD/HDD/NVMe (Kingston, Samsung, `nvme0n1`, SATA `sdX` without `usb`) | **Yes** |

Device letters (`sda` / `sdb`) **swap** depending on USB port order. Use **MODEL** and **TRAN**, not the letter alone.

**Never** install to the stick’s **exFAT** partition (`HIGHASCGEXF`, often `sda3` on the USB layout). That partition is operator data only.

### 2. Make the internal disk visible

```bash
sudo /usr/local/lib/highascg/probe-internal-storage.sh --check
```

- **NVMe missing, dmesg mentions RST/RAID:** set BIOS storage to **AHCI** (not Intel RST/RAID), reboot from USB, confirm `nvme0n1` in `lsblk`.
- **SATA SSD** (e.g. Kingston SKC600): should appear as `/dev/sda` or `/dev/sdb` without `TRAN=usb`.

### 3. Firmware mode — disable CSM (recommended)

**CSM** (Compatibility Support Module, also **Legacy boot**, **Launch CSM**) lets UEFI PCs boot in old BIOS mode. With CSM **enabled**, the live USB often boots as **Legacy BIOS** even though the machine is UEFI-capable. That leads to **`bios_grub`** layouts, missing **`grub-pc`** on older ISOs, and **“The bootloader could not be installed” (error code 1)**.

**Recommended before Calamares:**

1. Enter firmware setup (`F2`, `Del`, `F12`, or `Esc` at POST).
2. **Disable CSM** / set boot mode to **UEFI only** (wording varies by vendor).
3. **Disable Secure Boot** if the stick does not boot (some boards require this for unsigned live ISOs).
4. Save and reboot; pick the USB entry labeled **UEFI:** … (not plain USB/Legacy).
5. Confirm from the live session:

```bash
[ -d /sys/firmware/efi ] && echo 'Firmware: UEFI — OK for Erase disk' || echo 'Firmware: Legacy BIOS — disable CSM and reboot'
```

With **UEFI** boot, use **Erase disk and install** — Calamares creates **ESP + `/`** automatically. You do **not** need manual **`bios_grub`**.

| Boot mode | Partition table | Boot slice needed |
|-----------|-----------------|-------------------|
| **UEFI** (recommended — **CSM off**) | **GPT** | **EFI System Partition** — FAT32, ~300 MiB+, mount **`/boot/efi`**, flags **boot** + **esp** |
| Legacy BIOS + GPT (CSM on — avoid if possible) | **GPT** | **`bios_grub`** — **1–2 MiB**, **leave unformatted** (no filesystem), flag **`bios_grub`** only |
| Legacy BIOS + MBR | msdos | Often no extra slice; Calamares **Erase disk** is easiest |

If the firmware shows **“missing GPT”** or **“create an EFI partition”** after a failed install, you likely booted **Legacy** (CSM on) while using a **UEFI** layout, or skipped **ESP** / **`bios_grub`** in manual layout.

---

## Recommended: Erase disk

**Prerequisite:** firmware **CSM disabled**, USB booted in **UEFI** mode (see §3).

On the Calamares **partition** page:

1. Select the **internal** disk (e.g. **KINGSTON …**, **nvme0n1** — not the USB stick).
2. Choose **Erase disk and install** (or equivalent).
3. Calamares creates **GPT**, **ESP** (UEFI) or correct layout for firmware, and **ext4** `/`.
4. **Swap:** **none** (matches ISO defaults).

This avoids manual `bios_grub` / ESP mistakes.

---

## Manual partitioning

Use **Manual partitioning** when Windows/other OS partitions must stay, or **Erase** fails.

### UEFI + GPT (most new PCs)

| Partition | Size | Filesystem | Mount point | Flags |
|-----------|------|------------|-------------|--------|
| EFI | **≥ 300 MiB** (512 MiB is fine) | **fat32** | **`/boot/efi`** | **boot** and **esp** (set both in Calamares; “EFI System Partition” preset is OK) |
| root | rest (≥ 32 GiB recommended) | **ext4** | **`/`** | (none) |

Partition table: **GPT**. Do **not** use ext4 on the EFI slice — only **fat32** on **`/boot/efi`**.

### Legacy BIOS + GPT

GRUB on GPT without UEFI needs a **`bios_grub`** slice (this is what fixed installs that failed with partition / rsync errors):

| Partition | Size | Filesystem | Mount point | Flags |
|-----------|------|------------|-------------|--------|
| GRUB BIOS | **1–2 MiB** | **unformatted** (do **not** assign ext4/xfs) | *(none)* | **`bios_grub`** |
| root | rest (≥ 32 GiB recommended) | **ext4** | **`/`** | (none) |

Partition table: **GPT**.

In Calamares manual editor:

1. **New partition table** → **GPT** (wipes target disk — confirm correct disk).
2. Add **1–2 MiB** partition → leave filesystem **unformatted** → set flag **`bios_grub`**.
3. Add large **ext4** partition → mount **`/`**.
4. Do **not** mount Windows NTFS partitions; do **not** use stick `sda3` exFAT.

### Alongside Windows

Only if you have **unallocated** space or you shrink Windows deliberately. Prefer **manual** layout: keep Windows partitions, add ESP + `/` (UEFI) or `bios_grub` + `/` (BIOS) in free space. **Do not** install `/` onto an existing NTFS volume.

### Swap

Choose **none** unless you have a specific reason to add swap.

---

## After installation

1. Remove the USB stick when prompted.
2. Boot from internal disk (UEFI boot order: internal SSD/NVMe first).
3. First boot: nodm → Openbox → HighAsCG on `:4200`, Caspar via systemd.
4. Operator exFAT on the **stick** (`HIGHASCGEXF`) is optional for updates; internal playout does not require the stick.

---

## Troubleshooting

### Read the log

```bash
grep -iE 'partition|unpackfs|rsync|fail|error' ~/.cache/calamares/session.log | tail -40
```

### “Failed to create partition on disk …”

- Wrong disk selected, or disk locked (BitLocker).
- **Manual:** missing **`bios_grub`** (BIOS+GPT) or **ESP** (UEFI).
- Try **Erase disk** on the internal drive after backup, or `wipefs` + new GPT (see below).

### `rsync failed with error code 11` / “Failed to unpack filesystem.squashfs”

Rsync **exit 11** = **file I/O error** while copying the ~4 GiB live image to `/`. Common causes:

- **`/`** partition too small (need **≥ ~8 GiB** minimum; **32 GiB+** recommended).
- **`/`** on wrong filesystem (exFAT/NTFS instead of ext4).
- Target is a **USB stick partition** (`sda3` exFAT), not the internal SSD.
- Failing SATA cable / SSD errors — check `dmesg` for I/O errors.

Verify live image on stick:

```bash
ls -lh /run/live/medium/live/filesystem.squashfs
unsquashfs -s /run/live/medium/live/filesystem.squashfs
```

### Wipe internal disk and retry (destructive)

**Double-check MODEL= your internal SSD, not USB:**

```bash
lsblk -o NAME,SIZE,MODEL,TRAN
# Example: /dev/sdb is Kingston, /dev/sda is USB
sudo wipefs -a /dev/sdX
sudo parted /dev/sdX mklabel gpt
```

Then run Calamares again with **Erase disk** on that device.

### Calamares shellprocess / exit 127 at end of install

If install fails at the last step with exit **127**, the stick ISO may need Calamares shellprocess patches — on stick:

```bash
sudo bash ~/highascg/tools/eggs/live-usb/fix-calamares-shellprocess.sh
```

(Rebuild ISO with latest `patch-iso-squashfs-calamares.sh` for a permanent fix.)

### “The bootloader could not be installed” (error code **1**)

Calamares failed running **`grub-install`** on the target disk. Read the exact command:

```bash
grep -iE 'bootloader|grub-install|grub' ~/.cache/calamares/session.log | tail -40
```

Check how the USB stick booted:

```bash
[ -d /sys/firmware/efi ] && echo 'Firmware: UEFI' || echo 'Firmware: Legacy BIOS'
dpkg -l grub-pc grub-efi-amd64 2>/dev/null | grep ^ii
lsblk -o NAME,SIZE,FSTYPE,PARTTYPE,PARTFLAGS,MOUNTPOINT,MODEL,TRAN
```

| Situation | Fix |
|-----------|-----|
| **CSM enabled** — live shows `Firmware: Legacy BIOS` | **Disable CSM** in firmware, reboot from **UEFI:** USB entry, **Erase disk** (ESP + `/`). This fixed **bootloader error 1** on several playout PCs. |
| **Legacy BIOS** + GPT manual layout | Need **1–2 MiB unformatted `bios_grub`** + **ext4** `/`. Bootloader target must be the **whole internal disk** (`/dev/sdX`), not a partition. |
| **Legacy BIOS**, log shows `grub-install --target i386-pc` failed | ISO may lack **`grub-pc`** (older sticks). **Preferred:** disable **CSM**, boot USB in **UEFI**, **Erase disk**. **Permanent:** rebuild ISO after `install-grub-for-calamares-iso.sh` + `fix-calamares-shellprocess.sh`. |
| **UEFI** boot | Need **fat32 ESP** mounted **`/boot/efi`** (flags **boot**, **esp**). Do **not** use `bios_grub` only. |
| Bootloader installed to **USB stick** | Wrong disk — pick **Kingston / internal** in Calamares; `TRAN` must not be `usb`. |
| Install fails and the **bridge partition** (`HIGHASCGDAT`) is on the target disk | The kernel refuses to re-read a partition table while any partition on that disk is mounted — even one you left untouched. `launch-calamares.sh` unmounts `~/bridge` and its media bind before starting the installer and remounts them after (**WO-475**). If you started Calamares by hand instead, release it first: `sudo systemctl stop home-casparcg-highascg-media-bridge.mount home-casparcg-bridge.mount`. |
| Files copied but bootloader step failed | See **manual GRUB recovery** below. |

On the live stick, apply Calamares patches (includes BIOS `grub-pc` install step):

```bash
sudo bash ~/highascg/tools/eggs/live-usb/fix-calamares-shellprocess.sh
```

If **`grub-pc` is missing** on the stick (`dpkg -l grub-pc` empty) and you must stay on Legacy BIOS, you need a **rebuilt ISO** — the squashfs image does not include BIOS GRUB on older builds.

#### Manual GRUB recovery (install copied, bootloader failed)

Only if Calamares finished **unpackfs** (system files on internal disk) but failed at bootloader:

```bash
# Replace sdX with internal disk; sdX2 = ext4 / ; sdX1 = ESP (UEFI) or bios_grub slice
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,MODEL,TRAN
sudo mount /dev/sdX2 /mnt
# UEFI only:
sudo mkdir -p /mnt/boot/efi && sudo mount /dev/sdX1 /mnt/boot/efi
sudo mount --bind /dev /mnt/dev
sudo mount --bind /proc /mnt/proc
sudo mount --bind /sys /mnt/sys
sudo chroot /mnt bash -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y grub-pc grub-pc-bin grub-efi-amd64-signed
'
# Legacy BIOS + GPT (bios_grub present):
sudo chroot /mnt grub-install --target=i386-pc /dev/sdX
# UEFI:
sudo chroot /mnt grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
sudo chroot /mnt update-grub
sudo umount -R /mnt
```

Requires **network** in the live session for `apt-get` if `grub-pc` was not baked into the install image.

### “External command finished with errors” / **logs-helper exit 1**

Often appears **at the very end** after partition copy, GRUB, and cleanup — the failing step is usually **`calamares-logs-helper.sh`** (archives session log to `/var/log/installer/` on the target). Eggs’ default helper uses `set -ex` and **aborts** if **`/var/log/syslog`** or **`.disk/info`** is missing on the live session (common on our ISO).

**The install may still have succeeded.** Check:

```bash
grep -iE 'logs-helper|shellprocess@logs|external command' ~/.cache/calamares/session.log | tail -20
lsblk -o NAME,FSTYPE,MOUNTPOINT,MODEL,TRAN
# If Kingston/NVMe has ext4 + fat32 EFI partitions with data, try booting without USB:
sudo reboot
```

If only the logs step failed, internal disk boot often works. Remove USB, set firmware to boot **internal UEFI** first.

**On the stick (before retry or for next machine):**

```bash
sudo bash ~/highascg/tools/eggs/live-usb/fix-calamares-shellprocess.sh
```

That installs an offline-safe `calamares-logs-helper.sh`. Rebuild ISO with `patch-iso-squashfs-calamares.sh` for a permanent fix.

**If earlier steps failed** (not just logs), `session.log` will also show `bootloader`, `unpackfs`, or `mkinitramfs` errors — read the full tail:

```bash
tail -80 ~/.cache/calamares/session.log
```

---

## Quick checklist

- [ ] Firmware: **CSM disabled**, USB booted as **UEFI** (`/sys/firmware/efi` exists)
- [ ] `lsblk` — internal disk visible, USB identified
- [ ] `probe-internal-storage.sh --check` passes (NVMe/AHCI if applicable)
- [ ] Calamares target = **internal disk**, not USB
- [ ] **UEFI (recommended):** **Erase disk** → ESP **fat32** `/boot/efi` + **ext4** `/`
- [ ] **Legacy only (CSM on):** **1–2 MiB unformatted `bios_grub`** + **ext4** `/`
- [ ] Swap **none**
- [ ] Root partition **≥ 32 GiB** recommended
