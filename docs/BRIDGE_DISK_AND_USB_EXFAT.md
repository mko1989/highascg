# Bridge disk (HIGHASCGDAT) and USB stick (HIGHASCGEXF)

WO-52 splits operator storage into two volumes.

## Bridge partition (main — internal disk)

| Item | Value |
|------|--------|
| **Label** | `HIGHASCGDAT` (exFAT, ≤11 characters) |
| **Linux mount** | `/home/casparcg/bridge` |
| **Media library** | `bridge/media/` bind-mounted to **`/home/casparcg/highascg/media`** (sole library) |
| **Configs** | `bridge/configs/` ↔ `~/highascg/config/` + state JSON (bidirectional, boot prefers bridge) |

Create on Windows (Disk Management) or Linux:

```bash
sudo mkfs.exfat -L HIGHASCGDAT /dev/nvme0n1p3

After the partition exists with that label, install units and sync map on the playout host:

```bash
cd ~/highascg && sudo bash scripts/apply-bridge-label-highascgdat.sh
```
sudo bash tools/eggs/live-usb/seed-bridge-operator-layout.sh /mount/point
```

Seed layout only:

```bash
sudo bash tools/eggs/live-usb/seed-bridge-operator-layout.sh /home/casparcg/bridge
```

## USB stick (field kit — live ISO tail)

| Item | Value |
|------|--------|
| **Label** | `HIGHASCGEXF` |
| **Linux mount** | `/home/casparcg/exfat` |
| **Media** | `exfat/media/` → **one-way ingest** into `~/highascg/media` (USB → server only) |
| **Configs** | `exfat/configs/` ↔ project (bidirectional; boot prefers USB when stick present) |
| **Server drops** | `drop-update/` (unchanged) |

Use [`HIGHASCGEXF-starter-layout.zip`](../dist/HIGHASCGEXF-starter-layout.zip) for USB folder stubs.

## Boot order

1. `highascg-bridge-boot.service` — mount `HIGHASCGDAT`, bind media  
2. `highascg-exfat-boot.service` — mount `HIGHASCGEXF`, server-update, sync  
3. `highascg-exfat-sync.service` — bridge configs, then USB configs, then USB media ingest  
4. `highascg.service`

## Sync map

Installed from `config/exfat-sync.json` → `/etc/highascg/exfat-sync.json`.

Legacy **USB `media/exfat` bind** is disabled by default. Enable only for old sticks:

```bash
sudo HIGHASCG_LEGACY_USB_MEDIA_BIND=1 bash scripts/install-exfat-systemd-units.sh
```

## Missing-volume behavior (graceful)

| Scenario | Boot | `highascg.service` | Media library | Config sync | USB media ingest |
|----------|------|-------------------|---------------|-------------|------------------|
| **Both absent** | Continues | Starts if `package.json` exists | Empty local `~/highascg/media/` | Skipped (log only) | Skipped |
| **Bridge only** | Continues | Starts | `bridge/media` → `~/highascg/media` | Bridge pairs | Skipped |
| **USB only** | Continues | Starts | Local `~/highascg/media/` unless legacy bind enabled | USB pairs (boot prefer USB) | USB → `~/highascg/media` |
| **Both present** | Full pipeline | Starts | Bridge bind wins for library | Bridge then USB on boot | USB → library |

- Mount units use **`nofail`** and **`ConditionPathExists`** on the label — no partition → unit does not run, boot does not hang.
- **`highascg.service`** does **not** `Wants` exFAT/bridge mounts (avoids ~90s device timeout).
- **`highascg-exfat-sync.service`** skips pairs whose volume is not mounted; exits **0** when neither volume is present.
- **`highascg-exfat-server-update`** exits **0** if USB not mounted or no `drop-update/package.json`.
- **Hotplug** (`highascg-exfat-arrive`): no-op if stick absent; legacy `media/exfat` bind only with `legacy-usb-media-bind`.

## Next eggs ISO (auto-mount HIGHASCGDAT)

On the **imaging host** before `eggs produce`:

```bash
cd ~/highascg
sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh
sudo bash tools/eggs/live-usb/build-highascg-egg.sh   # or your eggs produce flow
```

That bakes WO-52 units plus:

- **45s** wait for `HIGHASCGDAT` at boot (`HIGHASCG_BRIDGE_BOOT_WAIT_SEC` in `20-live-boot.conf`)
- **udev** `99-highascg-bridge-arrive.rules` — mounts bridge when NVMe appears after USB boot

After flashing the new ISO, verify once:

```bash
findmnt /home/casparcg/bridge
tail /var/log/highascg-bridge-boot.log
```

## Live USB (operator stick)

| Label | On stick? | On live boot |
|-------|-----------|--------------|
| **HIGHASCGEXF** | Yes — MBR **slot 3** after `create-operator-stick-from-dd.sh` | Should mount at **`/home/casparcg/exfat`** |
| **HIGHASCGDAT** | **No** — internal NVMe/SATA bridge disk only | Absent unless you created that partition on the **machine’s internal drive** |

Settings showing `map: /etc/highascg/exfat-sync.json` with **bridge not mounted** is normal on USB-only boots. Bridge pairs in the table stay **volume not mounted** until `HIGHASCGDAT` exists.

**Diagnostics on the live system:**

```bash
sudo bash ~/highascg/tools/eggs/live-usb/diagnose-exfat-volumes.sh
sudo systemctl start highascg-exfat-boot.service
lsblk -f
```

If **`HIGHASCGEXF`** is missing from `lsblk`, the stick has no data partition (plain `dd` without `finish-operator-stick` / `create-operator-stick-from-dd.sh` step 2). Re-flash with the full operator script.

## Related

- [`WO47_ISO_VS_EXFAT.md`](WO47_ISO_VS_EXFAT.md) — ISO vs stick payload  
- [`work/work-orders/52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md`](../work/work-orders/52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md) — full WO
