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

## Disable CSM (UEFI install)

**CSM** (Compatibility Support Module / **Legacy boot**) makes the stick boot in BIOS mode. That often causes **bootloader could not be installed (error 1)** on HighAsCG ISOs.

1. Firmware setup → **disable CSM** (UEFI only).
2. Boot the USB entry labeled **UEFI:** … (not Legacy USB).
3. Confirm: `[ -d /sys/firmware/efi ] && echo UEFI`

Then use **Erase disk** below — no manual **`bios_grub`** needed.

## Easiest path

**Erase disk and install** on the internal drive. Swap: **none**.

## Manual partitioning (when Erase fails)

### UEFI (typical — **CSM off**)

| Size | FS | Mount | Flags |
|------|-----|-------|-------|
| **≥ 300 MiB** | **fat32** | **`/boot/efi`** | **boot** + **esp** |
| rest | ext4 | `/` | — |

GPT partition table. This layout (with CSM disabled) fixed bootloader install on several playout PCs.

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
| **Bootloader could not be installed** (code **1**) | **Disable CSM**, boot USB in **UEFI**, **fat32 `/boot/efi`** (≥300 MiB, **boot**+**esp**) + ext4 `/` |
| **logs-helper** / external command exit **1** at end | Install often **OK** — remove USB and boot internal disk; run `fix-calamares-shellprocess.sh` on stick |
| No disk in Calamares | BIOS **AHCI**; run `probe-internal-storage.sh --check` |

Log: `~/.cache/calamares/session.log`

## Krill?

**Calamares** is on the live ISO. **`eggs krill`** is on the eggs **build host** only, not the stick.
