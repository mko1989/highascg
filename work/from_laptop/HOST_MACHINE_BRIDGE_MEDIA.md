# Host machine: bridge media bind (WO-52)

Use this on the **build host** that runs `eggs produce` and prepares sticks, and on **playout boxes** when bridge media does not appear under `~/highascg/media/bridge`.

## Symptom

- `LABEL=HIGHASCGDAT` mounts at **`/home/casparcg/bridge`** (internal NVMe / SSD).
- Files exist under **`/home/casparcg/bridge/media/`**.
- **`/home/casparcg/highascg/media/bridge`** is missing or empty; Caspar / HighAsCG only see local files in **`~/highascg/media/`**.

## Expected layout

```
/dev/disk/by-label/HIGHASCGDAT  →  /home/casparcg/bridge
/home/casparcg/bridge/media     →  bind  →  /home/casparcg/highascg/media/bridge
/home/casparcg/highascg/media/  →  local scratch / ingest (not replaced)
```

USB stick (`HIGHASCGEXF`) is separate: configs under **`/home/casparcg/exfat`**, stick media at **`~/exfat/media`** bind-mounted to **`~/highascg/media/exfat`** (was wrongly disabled when bridge owned all of `media/`).

## Root cause (fixed in repo)

The bind mount unit was named **`home-casparcg-highascg-media.mount`** but **`Where=`** was **`/home/casparcg/highascg/media/bridge`**.

systemd requires the unit file name to match the mount path. It refused the unit:

```text
home-casparcg-highascg-media.mount: Where= setting doesn't match unit name. Refusing.
```

Result: bridge volume mounted, bind never started.

**Fix:** unit renamed to **`home-casparcg-highascg-media-bridge.mount`**.

## What to fix on the build host (before `eggs produce`)

On the machine that clones the live image:

1. Pull / sync the repo with the unit-name fix (`install-exfat-systemd-units.sh`, bridge boot/arrive scripts).

2. Install WO-47 + WO-52 into **`/etc`** (baked into the squashfs clone):

   ```bash
   cd ~/highascg
   sudo bash scripts/install-exfat-systemd-units.sh casparcg
   sudo bash tools/eggs/live-usb/install-exfat-sync-map.sh   # if eggs tree present
   sudo bash scripts/write-highascg-systemd-unit.sh casparcg
   ```

   If you use the eggs prep shortcut:

   ```bash
   sudo bash tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh
   ```

3. Confirm the correct unit exists and the old one is gone:

   ```bash
   systemctl cat home-casparcg-highascg-media-bridge.mount | grep -E '^Where='
   # Where=/home/casparcg/highascg/media/bridge
   test ! -f /etc/systemd/system/home-casparcg-highascg-media.mount && echo OK
   ```

4. Rebuild ISO and flash stick as usual (`build-produce-flash-stick.sh` or your pipeline).

5. **Bridge disk on playout hardware** (not the USB stick): format or relabel internal data partition:

   ```bash
   sudo mkfs.exfat -L HIGHASCGDAT /dev/nvme0nXpY   # destructive — pick the right partition
   sudo bash scripts/apply-bridge-label-highascgdat.sh casparcg
   ```

   Copy media into **`/home/casparcg/bridge/media/`** (or seed with `tools/eggs/live-usb/seed-bridge-operator-layout.sh`).

## Fix on an already-deployed stick / playout box (no ISO rebuild)

On the live machine (e.g. test laptop booted from USB):

```bash
cd ~/highascg
sudo bash scripts/install-exfat-systemd-units.sh casparcg
sudo bash scripts/write-highascg-systemd-unit.sh casparcg
sudo systemctl daemon-reload
sudo systemctl restart highascg-bridge-boot.service
sudo systemctl restart highascg-exfat-boot.service
```

If the bridge disk was desktop-auto-mounted before systemd runs:

```bash
sudo udisksctl unmount -b "$(readlink -f /dev/disk/by-label/HIGHASCGDAT)" 2>/dev/null || true
sudo systemctl restart highascg-bridge-boot.service
```

## Verify

```bash
findmnt /home/casparcg/exfat
findmnt /home/casparcg/highascg/media/exfat
findmnt /home/casparcg/bridge
findmnt /home/casparcg/highascg/media/bridge
systemctl status home-casparcg-highascg-media-exfat.mount
systemctl status home-casparcg-highascg-media-bridge.mount
```

Expected:

- **`/home/casparcg/exfat`** ← `HIGHASCGEXF` (stick tail partition)
- **`/home/casparcg/highascg/media/exfat`** ← bind from **`~/exfat/media`**
- **`/home/casparcg/bridge`** ← `HIGHASCGDAT` (internal disk, if present)
- **`/home/casparcg/highascg/media/bridge`** ← bind from **`/home/casparcg/bridge/media`**
- Bind units **active (mounted)**, not `bad-setting`

Logs: **`/var/log/highascg-exfat-boot.log`**, **`/var/log/highascg-bridge-boot.log`**, **`journalctl -u highascg-*-boot.service`**.

## Checklist for stick prepared on another host

| Step | Build host | Playout laptop |
|------|------------|----------------|
| WO-52 units in `/etc` before `eggs produce` | Required | — |
| USB `HIGHASCGEXF` exFAT slot | `finish-operator-stick.sh` | Mounts at `~/exfat` |
| Internal `HIGHASCGDAT` partition | Optional on build host | Format + label on laptop |
| `apply-bridge-label-highascgdat.sh` | Optional test | Run once per machine |
| Media files | — | Under `bridge/media/`, visible via `media/bridge` bind |

## Related files

- `scripts/exfat/install-exfat-systemd-units.sh` — mount + bind units (root stubs forward here)
- `scripts/exfat/highascg-bridge-boot.sh` — boot-time wait + bind chain
- `scripts/exfat/apply-bridge-label-highascgdat.sh` — one-shot playout setup
- `tools/eggs/live-usb/seed-bridge-operator-layout.sh` — empty bridge folder layout
- `config/exfat-sync.json` — `volumes.bridge.mediaMount` → `~/highascg/media/bridge`
