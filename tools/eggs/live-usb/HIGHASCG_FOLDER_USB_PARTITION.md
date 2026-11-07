# Persist only `/home/casparcg/highascg` on a second USB partition

> **Not a production stick layout.** Production sticks are Ventoy with durable data on **`HIGHASCGEXF`** ([`docs/STICK_QUICK_START.md`](../../../docs/STICK_QUICK_START.md)). Whole-stick union persistence is retired and its scripts are gone.
> This doc is for the **narrow** case: durability for **`~/highascg` only** on a separate ext4 partition.

Most operator-visible **HighAsCG + Caspar *settings*** live under this one tree:

- **`config/`** (modular JSON, generated `casparcg.config`, etc.)
- **`media/`**, **`template/`**, **`web/`**, project/state JSON the UI saves
- Checked-out **Node app** (`package.json`, `src/`, …)

The **CasparCG server binaries** themselves are normally under **`/opt/casparcg`** on the cloned ISO — they stay on the **read‑only squashfs**. You persist **paths and XML HighAsCG writes**, not `/opt`, by keeping **`~/highascg`** on durable storage.

For **live USB**, this layout is simple and small: tiny data partition, less OS state across boots, and one clear **`rsync`** target — when you only need the HighAsCG tree to persist.

**You do *not* get persistence** (unless you add something else) for things **outside** that mount:

- **`/var/lib/highascg/**` (e.g. NVIDIA first-boot picker markers)
- **`apt` / `dkms` overlays**, random **`/etc`** edits, other users’ homes
- **`/opt/casparcg`** contents (unless you reinstall)

Re-run setup after boot if those must be present.

**Upside:** reboot-safe **`~/highascg`** tree (**code + config + Caspar XML paths HighAsCG owns + media/templates/projects**); easy **`rsync`** / partition image backups.

---

## Layout (conceptual)

| USB partition | Role |
|---------------|------|
| First region(s) | Ventoy partitions (ISO as a file) |
| **Last ext4** | Label **`HIGHASCG_PERSIST`** — holds the **contents** of `highascg/` |

The live root still provides `/home/casparcg` (and often an empty or template
`highascg/`). At boot, systemd **mounts the ext4 over** `…/highascg`, replacing
that directory with the partition’s root (normal Linux mount behaviour).

---

## One-time: create and fill the data partition

Do this on a **build machine** or **once** from a running live session that
already has the tree you want.

1. **Leave free space** at the end of the stick (Ventoy2Disk → Option → Partition Configuration → "Preserve some space at the end of the disk"), then `parted … print free`, `mkpart`, `mkfs.ext4`.

2. **Format with a fixed label** (required by the sample unit):

   ```bash
   sudo mkfs.ext4 -L HIGHASCG_PERSIST /dev/sdXN
   ```

3. **Populate** the partition root so it looks like the **inside** of the deploy tree (no extra `highascg/` subdirectory on the partition):

   ```bash
   sudo mkdir -p /mnt/hgdata
   sudo mount /dev/disk/by-label/HIGHASCG_PERSIST /mnt/hgdata
   sudo rsync -aX /home/casparcg/highascg/ /mnt/hgdata/
   sudo chown -R casparcg:casparcg /mnt/hgdata
   sudo umount /mnt/hgdata
   ```

4. **Install the systemd mount unit** from `systemd/home-casparcg-highascg.mount.example` into `/etc/systemd/system/home-casparcg-highascg.mount` **in the squashfs / clone** before imaging, then:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable home-casparcg-highascg.mount
   ```

5. Reboot from USB and verify:

   ```bash
   findmnt /home/casparcg/highascg
   ```

---

## Gotchas

- **`nofail`** in the example allows boot without the data stick (recovery). Drop it if a missing partition should hard-fail.
- **WO-38** stacks: internal disk can still be mounted **on** `/home/casparcg/highascg/media/drive` after this USB tree mount.
- **Empty partition** → empty app tree until you **seed** with `rsync` (above) or restore from backup.

---
