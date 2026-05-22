# penguins-eggs `exclude.list` (complete, concise)

Single file to replace **`/etc/penguins-eggs.d/exclude.list`** on the eggs build host.

| File | Purpose |
|------|---------|
| **[`exclude.list`](exclude.list)** | Ready to install (eggs master + one HighAsCG block) |
| [`penguins-eggs-exclude-highascg-fragment.list`](penguins-eggs-exclude-highascg-fragment.list) | HighAsCG-only lines (for merge script) |

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

## What HighAsCG excludes (summary)

**Default (`HIGHASCG_ISO_EMBED_SERVER=1` on prepare):** use **`penguins-eggs-exclude-highascg-embed-server.list`** — server runtime stays on ISO; **`client/`**, **`dist-web/`**, dev trees omitted (UI via Electron launcher).

**WO‑47 only (`HIGHASCG_ISO_EMBED_SERVER=0`):**

| Omitted from ISO squashfs | Provided via |
|-------------------------|----------------|
| `src/`, `scripts/`, `index.js`, `package.json`, `tools/`, … | exFAT **`drop-update/`** (`highascg-server_*.tar.gz`) |
| `client/`, `dist-web/` | Remote UI (not on playout stick) |
| `node_modules/`, `work/`, `deprecated/`, `audio_testing/`, `for_client/`, `From_client/` | Build / dev only |
| `media/*`, `log/`, `cef-cache/`, `data/` | Runtime on machine |
| `home/casparcg/exfat/*` | Mounted at boot (WO-47) |
| Tailscale state (`var/snap`, `snap/`, `root/snap/`, `var/lib`) | Not cloned (avoid stealing builder node) |

**Stays on ISO:** Caspar `config/casparcg.config`, `lib/`, empty `media/` / `template/` stubs, drivers, systemd, etc.

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

A **~5 GiB** `filesystem.squashfs` / hybrid ISO is normal for **`eggs produce --clone --max`** on a full HighAsCG imaging host. Excludes remove **HighAsCG dev trees** and **caches**; they do **not** strip the underlying Ubuntu + broadcast stack.

Typical squashfs contents (your build host pattern):

| Component | Rough size | Excluded? |
|-----------|------------|-----------|
| Ubuntu userland + `linux-modules` + `linux-firmware` | ~2–3 GiB compressed | No (the OS) |
| **`/opt/nvidia-pool`** (offline `.deb` cache for WO‑39) | ~1.5 GiB | **No** — needed on ISO for first-boot driver pick |
| Caspar + **`~/highascg/lib`** (NDI, etc.) | ~0.7 GiB+ | No (playout) |
| Installed NVIDIA / DeckLink / build deps | varies | No |
| `src/`, `node_modules`, `.cache`, swap | large on disk | **Yes** — not in squashfs |

So shrinking below ~4 GiB means **smaller base OS** (fewer packages, one NVIDIA branch only, drop locales/docs) or **moving `nvidia-pool` off-ISO** (network required on first boot). That is a separate tradeoff from the HighAsCG exclude list.

Quick size check:

```bash
du -h /home/eggs/mnt/iso/live/filesystem.squashfs
du -sh /swap.img /var/cache /home/casparcg/.cache ~/highascg/node_modules /opt/nvidia-pool
```

## Maintenance

Edit **`penguins-eggs-exclude-highascg-fragment.list`**, regenerate **`exclude.list`** (or re-run merge). Do not hand-edit `/etc` and the repo copy separately — pick one source of truth.
