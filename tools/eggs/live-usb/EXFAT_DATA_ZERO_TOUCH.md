# exFAT data volume — zero–hand-edit workflow (WO-47)

HighAsCG mounts cross-platform data at **`/home/casparcg/exfat`** by **volume label** `HIGHASCGEXF` (no UUID editing). **`mkfs.exfat`** accepts at most **11** characters for `-L`, so the label is kept short on purpose. **`scripts/install-exfat-systemd-units.sh`** writes **`home-casparcg-exfat.mount`**, **`highascg-exfat-media-prep.service`**, **`home-casparcg-highascg-media-exfat.mount`** (bind **`/home/casparcg/exfat/media` → `/home/casparcg/highascg/media/exfat`** when the data volume is present), and **`highascg-exfat-sync.service`** using the **`casparcg`** user’s **uid/gid** at install time. (The old **`install-phase4.sh`** wrapper that ran this installer is deprecated — kept at **`scripts/deprecated/legacy/install-phase4.sh`**.)

**Same label on every operator stick** lets the correct volume attach whether the machine boots from internal disk or from the USB: plug the stick **before** **`local-fs`** if you need it on HDD boots.

Boot order: **`home-casparcg-exfat.mount`** → **`highascg-exfat-media-prep.service`** → **`home-casparcg-highascg-media-exfat.mount`** (bind) → **`highascg-exfat-network-apply.service`** (**`network/network.conf`** → NM/static or DHCP) → **`highascg-exfat-server-update.service`** (**`drop-update/`** → **`~/highascg`**) → **`highascg-exfat-sync.service`** (**`drop-config/`** mtime sync; **skipped** if **`tools/runtime/exfat-sync-cli.js`** missing) → **`highascg.service`** (**`ConditionPathExists=package.json`**). Matrix: **[`docs/WO47_ISO_VS_EXFAT.md`](../../../docs/WO47_ISO_VS_EXFAT.md)**.

---

## 1. One-time on the **build / dev machine** (becomes the eggs `--clone` source)

Before **`sudo eggs produce --clone`** (or **`build-highascg-egg.sh`**), bake WO-47 into **`/`** so the clone snapshots it:

```bash
sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh   # or: npm run eggs:prepare
```

That installs **`exfatprogs`**, **`parted`**, **`python3`**; merges **[`merge-penguins-eggs-exclude-highascg.sh`](merge-penguins-eggs-exclude-highascg.sh)** (once **`/etc/penguins-eggs.d/exclude.list`** exists — see **`docs/LIVE_USB_IMAGE.md`**); creates empty mount stubs; writes **`install-exfat-systemd-units.sh`** outputs + **`/etc/highascg/exfat-sync.json`** when missing; and refreshes **`highascg.service`** ordering (**[`write-highascg-systemd-unit.sh`](../../../scripts/write-highascg-systemd-unit.sh)**).

**Eggs excludes:** merging is marker-idempotent.

If **`penguins-eggs-exclude-highascg-fragment.list`** gained new paths (e.g. **`home/casparcg/exfat/*`**), delete the **`# --- HighAsCG tools/live-usb:` …** block from **`exclude.list`** (that literal is the generated block header; current builds write **`# --- HighAsCG tools/eggs/live-usb: …`** and the merge script recognizes both variants) and re-run **`prepare-eggs-clone-with-exfat.sh`** so the ISO drops builder scratch under **`~/exfat`**.

Or run the granular steps manually:

1. **Install OS packages** used on sticks and for formatting:  
   `sudo apt install -y exfatprogs parted python3` (plus your existing eggs / HighAsCG deps).

2. **Clone / pull HighAsCG** into `/home/casparcg/highascg` (or your deploy path).

3. **`npm ci`** (or `npm install`) in that directory if you rely on a full `node_modules` tree.

4. Install everything else (Caspar deps, WO-38, WO-47, **`highascg.service`**) on the imaging host: **`sudo bash scripts/install.sh`** (recommended once). For **WO-47 + service ordering only** (if the rest is already baked): **`sudo bash scripts/install-exfat-systemd-units.sh casparcg`** then **`sudo bash scripts/write-highascg-systemd-unit.sh casparcg`** — or use **`prepare-eggs-clone-with-exfat.sh`** above instead of repeating these fragments.

5. **Squashfs empty mount points** (before `eggs produce`):  
   `sudo bash tools/eggs/live-usb/ensure-empty-live-usb-dirs.sh`

6. **Build the ISO** (your usual eggs flow), e.g.:  
   `sudo bash tools/eggs/live-usb/build-highascg-egg.sh` (or `npm run eggs:build`)  
   (or `eggs produce --clone …` after merge excludes).

---

## 2. **Flash** the ISO to the USB

Use `dd`, Balena Etcher, or the all-in-one **`tools/eggs/live-usb/build-produce-flash-stick.sh`**. (The old **`build-flash-and-persist.sh`** is legacy — kept at **`tools/eggs/live-usb/legacy-persistence/build-flash-and-persist.sh`**.) Replace **`/dev/sdX`** with your whole-disk device (not a partition).

---

## 3. **Partitions on the stick** (still scripted; order matters if you want **both** exFAT and **union persistence**)

| Goal | Commands |
|------|-----------|
| **Production stick (required)** | `sudo bash tools/eggs/live-usb/finish-operator-stick.sh /dev/sdX --iso /path/to.iso` — **exFAT only** on MBR slot 3 (**`HIGHASCGEXF`**, fills disk after ISO). No union **`persistence`** partition. Re-flash: add **`--prune-stale`**. Fix an old persist stick: **`repair-stick-exfat-only.sh`**. |
| **Full dd + exFAT** | `sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX --iso /path/to.iso` |
| **Legacy union persistence** | `HIGHASCG_LEGACY_UNION_PERSIST=1` + **`legacy-persistence/add-union-persistence-partition.sh`** — not for production. |

Optional: **`EXFAT_SIZE_MIB=8192`** before **`add-exfat-data-partition.sh`** to change the reserved exFAT size.

**Safety:** unplug internal disks if unsure; scripts refuse if any partition on the target disk is mounted.

---

## 4. **Boot**

1. Boot from the stick — production sticks boot the plain **Live** entry (**no** union persistence; durable data lives on exFAT). Legacy persistence sticks (opt-in `HIGHASCG_LEGACY_UNION_PERSIST=1`) use the **Live with persistence** entry: see **`legacy-persistence/FLASH_AND_PERSIST.md`**. exFAT mount/sync runs whenever **`HIGHASCGEXF`** is present, on either menu entry.

2. On boot with **`HIGHASCGEXF`** present: **mount → bind → network apply (`network/network.conf`) → server-update (`drop-update/`) → mtime sync (node)** — see **[`docs/WO47_ISO_VS_EXFAT.md`](../../../docs/WO47_ISO_VS_EXFAT.md)** — then **`highascg.service`** if **`package.json`** exists.

### Operator network file (WO-95)

Edit **`network/network.conf`** on the stick from any OS (Windows Notepad, macOS TextEdit, Linux). Plain INI — no shell required:

```ini
# mode: dhcp | static
mode=dhcp

# Optional — auto-detect first wired NIC with carrier
# interface=enp3s0

# Static only:
# address=192.168.1.50
# prefix=24
# gateway=192.168.1.1
# dns=192.168.1.1,8.8.8.8
```

Save → reboot or re-plug USB. **`highascg-exfat-network-apply.service`** runs after mount and before the Web UI. Invalid values are skipped (fail-safe). **`GET /api/system/network`** reports **`source: exfat|ui|default`** — exFAT wins on cold boot; Device View **Apply network** sets **`ui`** until the next boot.

Sample + README are seeded by **`seed-exfat-operator-layout.sh`**.

3. **Settings → media/usb → exFAT sync** shows the map and pair status; **Dry-run sync** is safe to click anytime.

---

## 5. **What you never edit by hand**

- **`/etc/systemd/system/home-casparcg-exfat.mount`** — regenerated by **`install-exfat-systemd-units.sh`**; uses **`What=/dev/disk/by-label/HIGHASCGEXF`** and **`uid=`/`gid=`** for **`casparcg`** — plus **`Documentation=`** targets under **`/usr/share/doc/highascg-wo47/`** (so units stay valid after eggs omit **`~/highascg/tools`**).
- **Partition UUID** — not used for mount; only the fixed label **`HIGHASCGEXF`** (set by **`add-exfat-data-partition.sh`**).

You **may** edit **`/etc/highascg/exfat-sync.json`** (or **`config/exfat-sync.json`** in the repo) to change which folders sync — that is normal configuration, not “mount plumbing.”

---

## 6. **Troubleshooting**

| Symptom | Check |
|--------|--------|
| exFAT not mounted | `lsblk -f`, `blkid` — partition must show **`LABEL="HIGHASCGEXF"`** (or `HIGHASCGEXF` per `blkid`). |
| Boot from HDD, **`/home/casparcg/exfat`** empty — not a stick mountpoint | **`HIGHASCGEXF`** wasn’t plugged in soon enough **or** no volume with that label exists. Re-plug USB; **`sudo systemctl start home-casparcg-exfat.mount`**. WO-47 does **not** use partition UUID — only that label identifies the operators’ data volume across machines. |
| **`media/exfat`** not wired | **`journalctl -b -u home-casparcg-highascg-media-exfat.mount`**, **`journalctl -b -u highascg-exfat-media-prep.service`** — **`home-casparcg-exfat.mount`** must be active (`findmnt`). Re-run **`install-exfat-systemd-units.sh`**. |
| Mount fails at boot | `journalctl -b -u home-casparcg-exfat.mount`; install **`exfatprogs`** / kernel exfat on the image. |
| Wrong owner on exFAT | Re-run **`sudo bash scripts/install-exfat-systemd-units.sh casparcg`** on the **cloned** system, then `daemon-reload`. |
| Network not applied from stick | Check **`/home/casparcg/exfat/network/network.conf`**; **`journalctl -b -u highascg-exfat-network-apply.service`**; ensure **`scripts/runtime/install-network-apply.sh`** ran (NM helper + sudoers). |
| Stick won't boot after **`add-exfat-data-partition.sh`** | Usually exFAT was placed **inside the hybrid ISO** because **`parted`** showed a too-small end for partition 1 (e.g. only the ESP). The script now uses **max(`parted`, `/sys/block/.../start`+`size`)** and re-applies **`boot`/`esp`/`lba`** flags after **`mkpart`**. If the stick was already damaged, **re-`dd` the ISO** and run the updated script. |

### **Portable newer app than the boot partition**

Boot sync (**`highascg-exfat-sync.service`**) applies **`configs/` ↔ `~/highascg/config/`** (modular JSON + `casparcg.config`), **`drop-config/highascg.config.json`**, and state JSON under **`configs/`** (mtime-wins). **After UI saves**, debounced sync pushes to exFAT when mounted (**`HIGHASCG_EXFAT_SYNC_ON_SAVE=1`**). **Server tree updates** use **`drop-update/`** ( **`highascg-exfat-server-update`** ), not whole-tree mtime sync. Manual sync: **`sudo systemctl start highascg-exfat-sync.service`** or `node tools/runtime/exfat-sync-cli.js`. After a server drop with new lockfile, **`npm ci`** runs automatically when enabled.

---

## Related files

| Path | Role |
|------|------|
| `scripts/exfat/highascg-exfat-network-apply.sh` | Parses **`network/network.conf`** on exFAT; calls NM apply helper. |
| `scripts/install-exfat-systemd-units.sh` | Writes mount, media bind chain, sync units (label + uid/gid). |
| `tools/eggs/live-usb/add-exfat-data-partition.sh` | Creates exFAT partition (**`mkpart … ntfs`** for MBR type **0x07**) + **`mkfs.exfat -L HIGHASCGEXF`**; placement uses **max(parted, sysfs)** so the slice starts after the real ISO extent. |
| `tools/eggs/live-usb/legacy-persistence/add-union-persistence-partition.sh` | Legacy: ext4 persistence to end of disk (opt-in only, not production). |
| `config/exfat-sync.json` | Default sync map (shipped / copied to **`/etc`** once). |
| `tools/eggs/live-usb/systemd/*.example` | Reference only; **installed units** come from **`install-exfat-systemd-units.sh`**. |
