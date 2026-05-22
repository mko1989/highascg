# Stick Studio (desktop operator UI)

**Stick Studio** wraps destructive USB steps (ISO **dd**, exFAT partition for **`HIGHASCGEXF`**) plus optional workspace setup for WO‑47. Privileged commands run via **`pkexec`** → **`stick-studio-priv.sh`**.

## Requirements

- Python **3**
- **`python3-tk`** (Debian/Ubuntu: `sudo apt install python3-tk`)
- Repo checkout with **`package.json`** at the repo root (`npm run stick-studio`)

## Launch

```bash
npm run stick-studio
```

The **HighAsCG repo** field defaults to this checkout. For **simulation**, `npm run portable:sim` uses that directory as `cwd` (Electron launcher on Mac/Windows — not the stick). The **Copy:** source fills **`drop-update/`** on the stick (server tarball extract).

## Typical flow (matches dev GitHub releases)

1. Download **`highascg_*.iso`** and **`highascg-server_*.tar.gz`** from Releases (see **`docs/DEV_RELEASE_GITHUB.md`**).
2. **Browse** ISO; pick **whole-disk** USB (**Refresh** refreshes **`list_flash_candidates`** from [`flash-stick-common.sh`](../live-usb/flash-stick-common.sh)).
3. Enable **Erase stick with ISO** → **Run pkexec pipeline** (confirm dialog).
4. Enable **Append exFAT partition LABEL HIGHASCGEXF**; re-run pipeline or use USB selection only for exFAT-after-flash layout. Use **EXFAT_FILL_DISK** only on sticks **without** a hybrid‑ISO partition layout (rare debugging case).
5. Mount **`HIGHASCGEXF`**, enter that path under **Mounted HIGHASCGEXF**, enable **Ensure drop-update (+ operator dirs)**.
6. Extract **`highascg-server_*.tar.gz`** to a folder on disk (`tar -xzf …`); enable **Copy:** and browse to that **folder** (repo root with `package.json`). Run pipeline again — content is synced into **`drop-update/`** (directories replaced on conflict).
7. Boot the live system — **`highascg-exfat-server-update`** applies the drop to **`~/highascg`** (optional **`npm ci`** when lockfile is included).
8. **Start simulation** — launches **`npm run portable:sim`** from the **HighAsCG repo** field (dev tree on this machine, not the stick).

## Default operator directories

Created under the mount root when requested:

`drop-update`, `drop-config`, `media`, `templates`, `configs`, `snapshots/rear-panels`.

## Related docs

- [`docs/WO47_ISO_VS_EXFAT.md`](../../docs/WO47_ISO_VS_EXFAT.md)
- [`docs/EXFAT_SERVER_UPDATE.md`](../../docs/EXFAT_SERVER_UPDATE.md)
- [`tools/live-usb/BUILD_AND_FLASH.md`](../live-usb/BUILD_AND_FLASH.md)
- [`docs/DEV_RELEASE_GITHUB.md`](../../docs/DEV_RELEASE_GITHUB.md)
