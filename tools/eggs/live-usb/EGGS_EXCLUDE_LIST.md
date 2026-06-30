# penguins-eggs `exclude.list` (complete, concise)

Single file to replace **`/etc/penguins-eggs.d/exclude.list`** on the eggs build host.

| File | Purpose |
|------|---------|
| **[`exclude.list`](exclude.list)** | Ready to install (eggs master + one HighAsCG block) |
| [`penguins-eggs-exclude-highascg-fragment.list`](penguins-eggs-exclude-highascg-fragment.list) | HighAsCG-only lines (for merge script) |

## Safety: will prepare / produce erase `/usr`, `/bin`, …?

**`prepare-eggs-clone-with-exfat.sh` is safe** — it only installs systemd units, merges `exclude.list`, creates empty mount stubs under `~/highascg/media` and `~/exfat`, tweaks swap **fstab** (restored after produce), and runs `apt install` for stick tooling. It does **not** delete or replace `/usr`, `/bin`, `/lib`, etc.

**The danger is `eggs produce --clone` staging (`/home/eggs/liveroot`):** while produce runs (or after a **crashed/interrupted** produce), eggs **bind-mounts your live** `/usr`, `/opt`, `/home`, … **into** `/home/eggs/liveroot/`. If you then run `rm -rf /home/eggs/liveroot` or `umount -R /home/eggs/liveroot`, you destroy the **real** system tree.

| Action | Safe on running host? |
|--------|------------------------|
| `prepare-eggs-clone-with-exfat.sh` | Yes |
| `build-highascg-egg.sh` (normal completion) | Yes |
| `stop-and-unmount-wo47-for-eggs-produce.sh` **before** produce | Yes (guarded — refuses if bind mounts exist) |
| `rm -rf /home/eggs/liveroot` during/after interrupted produce | **NO — can wipe `/usr`** |
| `HIGHASCG_FORCE_SQUASHFS_REFRESH=1` while bind mounts active | **NO** |
| `inject-iso-boot-branding.sh` (default: skip squashfs refresh) | Yes |

**If a build was interrupted:** **reboot** (clears liveroot bind mounts), then rerun the build script. Do **not** delete anything under `/home/eggs`. Audit before produce:

```bash
sudo bash tools/eggs/live-usb/audit-eggs-clone-host.sh
```

## Install (overwrite `/etc`)

```bash
cd ~/highascg
sudo cp tools/eggs/live-usb/exclude.list /etc/penguins-eggs.d/exclude.list
```

Optional before `eggs produce` (avoids Tailscale log noise during squashfs):

```bash
sudo systemctl stop snap.tailscale.tailscaled.service 2>/dev/null || true
```

Then:

```bash
sudo npm run eggs:build
```

## Volatile IDE paths (eggs produce)

Exclude **`home/casparcg/.antigravity-ide-server/*`** (and `.cursor*`, `.vscode-server`) so mksquashfs does not scan live log files that change during the snapshot (“changed size while reading”). After adding lines to the fragment, re-merge:

```bash
sudo bash tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh --replace
grep antigravity /etc/penguins-eggs.d/exclude.list
```

## What HighAsCG excludes (summary)

**Default (`HIGHASCG_ISO_EMBED_SERVER=1` on prepare):** use **`penguins-eggs-exclude-highascg-embed-server.list`** — server runtime + **`dist-web/`** (built UI) stay on ISO; **`client/`** sources and dev trees omitted. exFAT holds **operator configs/media** and optional **`drop-update/`** hotfixes — not required for first boot UI.

**WO‑47 only (`HIGHASCG_ISO_EMBED_SERVER=0`):**

| Omitted from ISO squashfs | Provided via |
|-------------------------|----------------|
| `src/`, `scripts/`, `index.js`, `package.json`, `tools/`, … | exFAT **`drop-update/`** (`highascg-server_*.tar.gz` incl. **`dist-web/`**) |
| `client/` (sources) | Build host only — deploy **`dist-web/`** via drop |
| `node_modules/`, `work/`, `deprecated/`, `audio_testing/`, `for_client/`, `From_client/` | Build / dev only |
| `media/*`, `log/`, `cef-cache/`, `data/` | Runtime on machine |
| `home/casparcg/exfat/*` | Mounted at boot (WO-47) |
| Tailscale state (`var/snap`, `snap/`, `root/snap/`, `var/lib`) | Not cloned (avoid stealing builder node) |
| Blackmagic Desktop Video (`usr/lib/blackmagic`, DKMS modules, …) | **Not cloned** — build host may keep `desktopvideo`; operator installs from exFAT `decklink/` (WO-92) |

**Stays on ISO:** Factory **`config/*.json`** (from `defaults.js` at build time), **`config/casparcg.config`** (from `casparcg.config.iso`), `lib/`, empty `media/` / `template/` stubs, drivers, systemd, etc. **Not** the build host’s operator JSON or **`.env`**. **Not** DeckLink/BMD when `HIGHASCG_ISO_FORBID_DECKLINK=1` (default).

See [`docs/WO47_ISO_VS_EXFAT.md`](../../../docs/WO47_ISO_VS_EXFAT.md).

## Alternative: merge without replacing whole file

If you only want to refresh the HighAsCG block and keep a customized eggs header:

```bash
sudo bash tools/eggs/live-usb/merge-penguins-eggs-exclude-highascg.sh --replace
```

## Swap and cache — are they excluded?

| Path on build host | In `exclude.list`? | In squashfs (ISO)? |
|--------------------|--------------------|--------------------|
| **`/swap.img`** (often 8 GiB on disk) | `swap.img`, `swapfile`, `swap/*` | **No** — omit works |
| **`var/cache/*`** (apt, etc.) | eggs master `var/cache/*` | **No** |
| **`home/casparcg/.cache`** | `home/casparcg/.cache/*` | **No** |
| **`~/highascg/node_modules`** | `home/casparcg/highascg/node_modules/*` | **No** |
| **`~/highascg/cef-cache`** | `cef-cache`, `cef-cache/*` | **No** |

`strip-host-swap-for-live-iso.sh prepare` only **swapoff** and removes **`/swap.img` from fstab** so the live system does not try to use swap on boot. It does **not** delete `/swap.img` on the build disk (that is fine — excludes keep it out of the ISO).

The `*.cache` line in the eggs template matches **file names** ending in `.cache`, not directories named `cache`. Directory caches are covered by `var/cache/*` and `home/casparcg/.cache/*`.

Verify on a built ISO:

```bash
unsquashfs -ll /home/eggs/mnt/iso/live/filesystem.squashfs | grep -E 'swap\.img|node_modules|casparcg/\.cache' || echo "OK: not in squashfs"
```

## Why is the ISO still ~5 GiB?

A **~4–5 GiB** `filesystem.squashfs` is normal for **`eggs produce --clone --max`** on a full HighAsCG imaging host **after** excludes. If you still see **~5 GiB** after removing **`/opt/nvidia-pool`**, the last ISO was probably built **before** the pool was deleted or **without** merged excludes — the May 2026 stick still had **`opt/nvidia-pool`** inside squashfs (~1.5 GiB of `.deb` files).

Typical squashfs contents:

| Component | Rough size | In squashfs? |
|-----------|------------|--------------|
| Ubuntu userland + `linux-modules` + `linux-firmware` | ~2–3 GiB compressed | Yes (the OS) |
| **`/opt/nvidia-pool`** | ~1.5 GiB if present on host | **No** — excluded + purged before build (`HIGHASCG_PURGE_NVIDIA_POOL=1`) |
| Caspar + **`~/highascg/lib`** (NDI, etc.) | ~0.7 GiB+ | Yes (playout) |
| One baked NVIDIA branch (535/580/595) | varies | Yes |
| `src/`, `node_modules`, `.cache`, `/swapfile` | large on disk | **No** — exclude.list + `strip-host-swap` |
| **`/run`**, **`/tmp`**, **`/proc`**, **`/dev`** | tmpfs at runtime | **No** — eggs master `run/*`, `tmp/*`, … |

**tmpfs / swap:** Clone snapshots the root filesystem tree, not live tmpfs mounts. Eggs already omits `proc/*`, `dev/*`, `sys/*`, `tmp/*`; HighAsCG adds **`run/*`** and **`swapfile`**. `/swapfile` on the build disk is fine if listed in excludes — `strip-host-swap-for-live-iso.sh prepare` only **swapoff** + drops fstab lines.

Pre/post checks:

```bash
sudo bash tools/eggs/live-usb/audit-eggs-clone-host.sh
sudo eggs produce …   # use build-highascg-egg.sh (not bare eggs produce)
bash tools/eggs/live-usb/verify-iso-squashfs-excludes.sh
```

Quick size check:

```bash
du -h /home/eggs/mnt/iso/live/filesystem.squashfs
du -sh /swapfile /var/cache /home/casparcg/.cache ~/highascg/node_modules /opt/nvidia-pool
unsquashfs -ll /home/eggs/mnt/iso/live/filesystem.squashfs | grep -c nvidia-pool || echo "OK: no pool"
```

## Maintenance

Edit **`penguins-eggs-exclude-highascg-fragment.list`**, regenerate **`exclude.list`** (or re-run merge). Do not hand-edit `/etc` and the repo copy separately — pick one source of truth.
