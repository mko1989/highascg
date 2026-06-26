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

The **HighAsCG repo** field defaults to this checkout. For **simulation**, `npm run portable:sim` is spawned with **that directory** as `cwd`; point it at the clone where you edit code. The **Copy:** source used for **`sim/highascg`** may be another path (e.g. directory produced from a release **`.tar.gz`**).

## Typical flow (matches dev GitHub releases)

1. Download **`highascg_*.iso`** and **`highascg_<stamp>.tar.gz`** from Releases (see **`docs/DEV_RELEASE_GITHUB.md`**).
2. **Browse** ISO; pick **whole-disk** USB (**Refresh** refreshes **`list_flash_candidates`** from [`flash-stick-common.sh`](../live-usb/flash-stick-common.sh)).
3. Enable **Erase stick with ISO** → **Run pkexec pipeline** (confirm dialog).
4. Enable **Append exFAT partition LABEL HIGHASCGEXF**; re-run pipeline or use USB selection only for exFAT-after-flash layout. Use **EXFAT_FILL_DISK** only on sticks **without** a hybrid‑ISO partition layout (rare debugging case).
5. Mount **`HIGHASCGEXF`**, enter that path under **Mounted HIGHASCGEXF**, enable **Ensure sim/highascg (+ operator dirs)**.
6. Extract **`highascg_*.tar.gz`** to a folder on disk (`tar -xzf …`); enable **Copy:** and browse to that **folder** (repo root). Run pipeline again — content is synced into **`sim/highascg`** (directories replaced on conflict).
7. If the archive omitted **`node_modules`**, open a terminal under **`sim/highascg`** and run **`npm ci`** (or project install scripts).
8. **Start simulation** — launches **`npm run portable:sim`** using the repo path from the **HighAsCG repo** field (your dev tree; simulation script resolves exFAT paths — see **`tools/portable-desktop/launch-sim-from-exfat.js`**).

## Default operator directories

Created under the mount root when requested:

`sim/highascg`, `drop-config`, `media`, `templates`, `configs`, `snapshots/rear-panels`.

## Related docs

- [`not-needed/docs/WO47_ISO_VS_EXFAT.md`](../../../not-needed/docs/WO47_ISO_VS_EXFAT.md)
- [`tools/live-usb/BUILD_AND_FLASH.md`](../live-usb/BUILD_AND_FLASH.md)
- [`not-needed/docs/DEV_RELEASE_GITHUB.md`](../../../not-needed/docs/DEV_RELEASE_GITHUB.md)
