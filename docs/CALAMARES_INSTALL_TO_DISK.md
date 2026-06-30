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

### 3. Firmware mode

| Boot mode | Partition table | Boot slice needed |
|-----------|-----------------|-------------------|
| **UEFI** (typical 2015+) | **GPT** | **EFI System Partition** — FAT32, ~300 MiB+, mount **`/boot/efi`**, flags **boot** + **esp** |
| **Legacy BIOS** + GPT | **GPT** | **`bios_grub`** — **1–2 MiB**, **leave unformatted** (no filesystem), flag **`bios_grub`** only |
| Legacy BIOS + MBR | msdos | Often no extra slice; Calamares **Erase disk** is easiest |

If the firmware shows **“missing GPT”** or **“create an EFI partition”** after a failed install, you likely skipped the **ESP** (UEFI) or **`bios_grub`** (BIOS+GPT) slice in manual layout.

---

## Recommended: Erase disk

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
| EFI | ≥ 300 MiB | **fat32** | **`/boot/efi`** | **boot**, **esp** |
| root | rest (≥ 32 GiB recommended) | **ext4** | **`/`** | (none) |

Partition table: **GPT**.

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

---

## Quick checklist

- [ ] `lsblk` — internal disk visible, USB identified
- [ ] `probe-internal-storage.sh --check` passes (NVMe/AHCI if applicable)
- [ ] Calamares target = **internal disk**, not USB
- [ ] **UEFI:** ESP **fat32** `/boot/efi` + **ext4** `/`
- [ ] **BIOS + GPT:** **1–2 MiB unformatted `bios_grub`** + **ext4** `/`
- [ ] Swap **none**
- [ ] Root partition **≥ 32 GiB** recommended
