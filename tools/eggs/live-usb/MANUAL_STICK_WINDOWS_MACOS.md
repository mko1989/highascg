# Operator stick contents — folder layout and server drops

**Making** a stick is one procedure and it lives in **[`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md)**: install **Ventoy** reserving space at the end of the disk, create the **`HIGHASCGEXF`** exFAT partition in that space, copy the ISO onto the Ventoy volume, copy the starter layout.

> **This file used to duplicate that procedure using Balena Etcher and a fixed 6 GiB offset.** Both are retired. Ventoy keeps the ISO as a file on its own partition, so operator data must live on a **separate third partition** — while the machine is booted from the stick, Ventoy holds its own partition open and Linux cannot mount it. Duplicated procedures are how the old offset rule survived in three places at once; this document is now the **contents** reference only.

Union **persistence is legacy** and not for production: see [legacy-persistence/FLASH_AND_PERSIST.md](./legacy-persistence/FLASH_AND_PERSIST.md).

---

## The volume label is not negotiable

exFAT allows **≤11 characters**, and the shipped systemd unit looks for exactly **`HIGHASCGEXF`** (all caps). It must be the label of the **third** partition — the operator data one — never the Ventoy partition.

Linux images with WO-47 mount it at **`/home/casparcg/exfat`**.

---

## Folder layout on `HIGHASCGEXF`

The starter zip (`docs/guides/stick/HIGHASCGEXF-starter-layout.zip`, or `npm run exfat:starter-zip`) creates all of these. Create them by hand only if you are building a stick without the zip.

| Folder | Use |
|--------|-----|
| **`drop-update/`** (+ **`drop-update/applied/`**) | **The playout drop.** Extract a server release (`highascg-server_*.tar.gz`) here so `drop-update/package.json` exists; on boot **`highascg-exfat-server-update.service`** applies it into **`~/highascg`** and records the applied stamp under `drop-update/applied/`. |
| **`drop-config/`** | Optional: `highascg.config.json` if you use the monolithic config sync pair. |
| **`configs/`** | Site / bundle exports (modular JSON + `casparcg.config`), synced with `~/highascg/config/`. |
| **`media/`** | Large media; on tuned images this tree is **bound** to **`~/highascg/media/exfat`**. |
| **`projects/`** | Project JSON catalog carried between machines. |
| **`network/`** | Operator IP file **`network/network.conf`** (WO-95) — DHCP/static, editable from any OS. |
| **`templates/`** | Templates you carry between PCs. |
| **`snapshots/rear-panels/`** | Device / rear-panel snapshots (JSON, images, etc.). |
| **`decklink/`** | Optional — Blackmagic `desktopvideo_*.deb` for machines with a DeckLink card. |
| **`.private/`** | Per-machine pairing data (hidden). |

> **Simulation stick (prep workstations only):** a `sim/highascg/` tree is used by the **simulation** tooling on Mac/Windows workstations. It is **not** used on playout sticks — playout updates go through `drop-update/`.

---

## Updating the server tree on a stick

Extract **`highascg-server_*.tar.gz`** into **`drop-update/`** so that **`package.json`** is a *direct child*:

```bash
mkdir -p "/Volumes/HIGHASCGEXF/drop-update"
tar -xzf ~/Downloads/highascg-server_YYYY-MM-DDTHHMMSSZ.tar.gz -C "/Volumes/HIGHASCGEXF/drop-update"
```

If the archive has a single top-level folder containing the tree, move **that folder's contents** into `drop-update/` — `highascg-exfat-server-update.service` keys on `drop-update/package.json` existing.

`update/server/` is the legacy drop location (still accepted once); prefer `drop-update/`.

---

## Copy hazards

> **Never `rsync -a` onto exFAT** — exFAT has no ownership, so `chown` fails with `EPERM` and rsync exits **23**, killing scripts mid-copy. Use `rsync -rLt --modify-window=2` or plain `cp`.

> **Always `sync` and eject before pulling the stick.** A copy that looks complete in the file manager can still be in RAM. This is not theoretical: it produces a file of exactly the right size full of stale bytes, and for an ISO that means the machine boots to GRUB and then dies with *"invalid magic number"*. Verify ISOs with `verify-stick-iso.sh` (size proves nothing — only the hash does).

---

## Related

| Topic | Document |
|-------|----------|
| **Making a stick (the procedure)** | [`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md) |
| What rides on exFAT vs in the ISO | [`docs/WO47_ISO_VS_EXFAT.md`](../../../docs/WO47_ISO_VS_EXFAT.md) |
| Server drops in detail | [`docs/EXFAT_SERVER_UPDATE.md`](../../../docs/EXFAT_SERVER_UPDATE.md) |
| Building the ISO in house | [`BUILD_AND_FLASH.md`](./BUILD_AND_FLASH.md) |
