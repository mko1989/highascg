# CasparCG-only image vs HighAsCG on exFAT (overlay mental model)

**Authoritative matrix** (what the ISO keeps vs what lives on **`HIGHASCGEXF`**, boot order, knobs): **[`WO47_ISO_VS_EXFAT.md`](WO47_ISO_VS_EXFAT.md)**.

This project uses **one directory** on the playout machine: **`/home/casparcg/highascg`** — Caspar’s working tree *and* the Node app when present.

## Caspar + nodm + openbox without the Node app

**Yes.** Phase 3 (`scripts/install-phase3.sh`) starts **CasparCG** + **scanner** from **Openbox** with **`cwd`** under **`/home/casparcg/highascg`** and **`config/casparcg.config`**. That does **not** require **`package.json`**.

Keep on disk (or empty stubs in the squashfs): **`bin/`**, **`config/`** (at least **`casparcg.config`**), **`lib/`**, **`cef-cache/`**, **`data/`**, **`log/`**, **`media/`**, **`template/`** as your config references.

## Eggs excludes + bootstrap (we are not deleting anything at runtime)

The **penguins-eggs** fragment **`tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`** **omits** large Node trees from the **squashfs snapshot** only. On boot, when the stick carries **`sim/highascg/`**:

1. **`highascg-exfat-bootstrap.service`** — **`rsync`** seed if **`~/highascg/package.json`** is missing (protects **`config/casparcg.config`** and **`lib/`** via **`/etc/highascg/bootstrap-rsync-excludes.txt`**).
2. **`highascg-exfat-sync.service`** — node mtime sync; **ConditionPathExists** **`tools/runtime/exfat-sync-cli.js`** so the unit **skips** cleanly if the tree was never seeded (no failed oneshot).
3. **`highascg.service`** — **`ConditionPathExists=package.json`**.

Safeguards: **`/etc/highascg/disable-exfat-bootstrap`**, **`/etc/highascg/force-exfat-bootstrap-once`**, **`HIGHASCG_BOOTSTRAP_DRY_RUN`**. See **`scripts/highascg-exfat-bootstrap.sh`**.

Regression check: **`npm run smoke:wo47-manifest`**.

## Stick Studio

**`npm run stick-studio`** — operator GUI for flash / exFAT / folder seed / portable sim (workstation).

## Summary

| Layer | Caspar-only OK? | Notes |
|--------|------------------|--------|
| nodm + openbox | Yes | `~/.config/openbox` |
| Caspar + scanner | Yes | Needs Caspar shell under **`~/highascg`** |
| Bootstrap + sync | When stick present | **`install-exfat-systemd-units.sh`** |
| **`highascg.service`** | If **`package.json`** exists | Skipped otherwise |
