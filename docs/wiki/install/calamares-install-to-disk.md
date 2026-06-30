# Calamares install to disk

Install HighAsCG from the **live USB stick** onto an **internal SSD/HDD/NVMe** using the graphical Calamares wizard.

**Full guide (partition layouts, `bios_grub`, UEFI ESP, troubleshooting):** [CALAMARES_INSTALL_TO_DISK.md](../../CALAMARES_INSTALL_TO_DISK.md)

## Launch

- **Web UI:** Settings → Nuclear → **Install to disk**
- **Terminal:** `sudo -n /usr/local/bin/launch-calamares.sh`

## Pick the right disk

```bash
lsblk -o NAME,TYPE,SIZE,MODEL,TRAN,FSTYPE
```

Install on the **internal** drive (Kingston, NVMe, …). **Do not** install on the **USB stick** or its **exFAT** partition (`HIGHASCGEXF`, often `sda3`).

## Easiest path

**Erase disk and install** on the internal drive. Swap: **none**.

## Manual partitioning (when Erase fails)

### UEFI (typical)

| Size | FS | Mount | Flags |
|------|-----|-------|-------|
| ≥ 300 MiB | fat32 | `/boot/efi` | boot, esp |
| rest | ext4 | `/` | — |

GPT partition table.

### Legacy BIOS + GPT

| Size | FS | Mount | Flags |
|------|-----|-------|-------|
| **1–2 MiB** | **unformatted** | — | **`bios_grub`** |
| rest | ext4 | `/` | — |

The **`bios_grub`** slice must stay **unformatted** — no ext4 on that 1–2 MiB partition. Without it, GRUB/partition steps often fail on BIOS machines.

## Common errors

| Message | Likely fix |
|---------|------------|
| Failed to create partition | Wrong disk; add **ESP** or **`bios_grub`**; try Erase |
| rsync error **11** / unpackfs failed | `/` too small or wrong FS; not internal ext4; check `dmesg` |
| No disk in Calamares | BIOS **AHCI**; run `probe-internal-storage.sh --check` |

Log: `~/.cache/calamares/session.log`

## Krill?

**Calamares** is on the live ISO. **`eggs krill`** is on the eggs **build host** only, not the stick.
