# Dev GitHub releases (server tarball + optional ISO)

Use this flow when you have a **build host or workstation** running the repo (typically with `node_modules` already installed). Two modes:

- **Server drop (canonical)** — playout tarball includes API + **`dist-web/`** (built from in-repo **`client/`**):
  - **`npm run release:github-server`** → `highascg-server_<UTC>.tar.gz` (`src/` + **`dist-web/`**; `BUILD_STAMP` + `package.json` `version` = UTC stamp in tarball; working tree restored after pack). Preview: **`npm run release:github-server:dry`**.
- **Full image (rare, manual/deprecated flow)** — build the ISO with **`sudo npm run eggs:build`**, then publish with the **deprecated** helper **`work/deprecated/tools/release/make-dev-github-release.sh`** (kept for reference; needs **`sudo`** / eggs; no npm wrapper exists).

**Playout stick:** extract **`highascg-server_*.tar.gz`** into **`drop-update/`** (API + UI on **`http://<playout-ip>:4200/`**). Optional Electron hub ([highascg-client](https://github.com/mko1989/highascg-client)) for simulator / multiserver / stick prep — opens browser to playout.

## What gets published

**Full** run (deprecated helper) produces:

| Asset | Produced by |
|-------|----------------|
| `highascg_*.iso` under `/home/eggs/` | **Full:** `sudo npm run eggs:build` — merges [`penguins-eggs-exclude-highascg-fragment.list`](../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list) via `prepare-eggs-clone-with-exfat.sh`. **Quick (deprecated):** `sudo bash work/deprecated/tools/release/make-dev-github-release-iso-quick.sh` |

**Canonical** run produces:

| Asset | Produced by |
|-------|----------------|
| `dist/highascg-server_<UTC>.tar.gz` | **`npm run release:github-server`** — WO-52 server tarball including **`dist-web/`**. |

(The old full-repo monolith tarball and separate launcher/app release scripts were retired; the deprecated helper's `--app-only` flag still builds a monolith tarball if you truly need one.)

GitHub Releases have a soft **per-asset ~2 GiB** limit. If the server tarball is too large, use `--zip-exclude-node-modules` and run `npm ci` under `~/highascg` after the stick applies the `drop-update/` drop.

### Why is the **server** tarball so big?

The **server** asset (`release:github-server`) includes **`dist-web/`** (WO-52) but not in-tree **`client/`** sources. Size still adds up because:

| Component | Typical share |
|-----------|----------------|
| **`node_modules/`** | Largest — all runtime deps (optional packages too if installed). Use `--zip-exclude-node-modules` + `npm ci` on the stick. |
| **`tools/runtime/`** | Only tools subtree in server tarball (`exfat-sync-cli`, staged Caspar). |
| **`src/`**, **`dist-web/`** | Node bridge + operator UI bundle |
| **`scripts/`**, **`config/`**, **`template/`** | Install helpers and Caspar templates. |

The **client** tarball (if published separately) is `dist-web/` only. The Electron hub lives in the separate [highascg-client](https://github.com/mko1989/highascg-client) repo — not published from here.

Shared rules: [`scripts/lib/archive-common.sh`](../scripts/lib/archive-common.sh) (used by deploy + release scripts).

## Prerequisites

1. **`gh`** installed and **`gh auth login`** finished for the repo you push to.
2. **`tar`** (gzip) — standard on Ubuntu/Debian. **`sudo`** only for **full** image builds.
3. **penguins‑eggs** only when you build a **full** ISO (same expectations as [**`BUILD_AND_FLASH.md`**](../tools/eggs/live-usb/BUILD_AND_FLASH.md)).
4. Repo root checkout (for `npm run …` wrappers below).

## Commands

### Server drop (canonical)

```bash
npm run release:github-server:dry
npm run release:github-server
```

On the playout stick (WO-52):

```bash
mkdir -p <mount>/drop-update
tar -xzf highascg-server_<stamp>.tar.gz -C <mount>/drop-update
```

After boot: open **`http://<playout-ip>:4200/`**. Optional Electron hub ([highascg-client](https://github.com/mko1989/highascg-client)) opens the same URL for simulator / multiserver / modules. **`HIGHASCG_HEADLESS=true`** is API-only debug, not production default.

### Full image — Eggs ISO + tarball (rare, deprecated/manual)

> **Deprecated.** No npm wrapper exists for this flow anymore. Build the ISO with **`sudo npm run eggs:build`**, then use the archived helper directly:

```bash
./work/deprecated/tools/release/make-dev-github-release.sh --dry-run
./work/deprecated/tools/release/make-dev-github-release.sh
./work/deprecated/tools/release/make-dev-github-release.sh --app-only --dry-run   # legacy monolith tarball only
./work/deprecated/tools/release/make-dev-github-release.sh --quick-iso --tag dev-smoke-$(date -u +%Y%m%d)
```

See `./work/deprecated/tools/release/make-dev-github-release.sh --help` for every flag.

Useful variants:

| Need | Flags |
|------|--------|
| **Server prerelease (canonical)** | **`npm run release:github-server`** |
| **Legacy monolith tarball** | deprecated helper with **`--app-only`** |
| Rebuild tarball + attach **existing** ISO | `--no-iso` (still expects an ISO under `/home/eggs/`). |
| Smaller archive | `--zip-exclude-node-modules` |
| Repeat same tag during testing | `--replace` |
| Custom tag | `--tag name` |
| Custom output directory | `--out-dir /tmp/rel` |
| Historical source in archive | `--zip-with-git` and/or `--zip-with-work` |

## ISO discovery

The helper uses **`find_latest_iso`** from [`flash-stick-common.sh`](../tools/eggs/live-usb/flash-stick-common.sh) (same rule as flashing tools — typically **`/home/eggs/**/*.iso`** newest). Align **`BASENAME`** with Eggs output if you renamed the image. ISO names follow **`highascg_amd64_YYYY-MM-DD_HHMM.iso`**.

## Operator path: Stick Studio + release tarball

Designed to match WO‑47: live system on hybrid ISO plus **`HIGHASCGEXF`** exFAT for data.

### 1. Download release assets

From the GitHub **Releases** page, download:

- The **ISO** (from a **full** deprecated-helper run, or reuse an older ISO you keep on file).
- **`highascg-server_<stamp>.tar.gz`** — the canonical server drop (every `release:github-server` prerelease has this).

### 2. Flash ISO and carve exFAT (desktop)

On a workstation with UI (no npm wrapper — run the tool directly):

```bash
python3 client/tools/stick-tools/stick_studio.py
```

Documentation: **`client/tools/stick-tools/README.md`**.

Rough order in the GUI:

1. Point **ISO** at the downloaded file and **whole-disk USB**.
2. Enable **Erase stick with ISO**, run **pkexec pipeline** (or flash first, then exFAT-only if you skipped dd).
3. Enable **Append exFAT … HIGHASCGEXF** where appropriate.
4. Mount the exFAT volume and set **mount path** in Stick Studio; create **`drop-update/`** (and operator dirs).

### 3. Lay out server drop on the stick

With the exFAT volume mounted at `<mount>`:

```bash
mkdir -p <mount>/drop-update
tar -xzf /path/to/highascg-server_<stamp>.tar.gz -C <mount>/drop-update
```

so that `<mount>/drop-update/package.json` exists (includes **`tools/runtime/`**). The boot-time server update applies it into `~/highascg` and records the stamp under `drop-update/applied/`. (`update/server/` is the **legacy** drop location — still accepted once, but use `drop-update/`.)

If the archive omitted `node_modules`, run **`npm ci`** on the playout host after first boot apply (or bake deps into the tarball).

**Monolith / alpha tarball (deprecated):** see `work/deprecated/tools/release/make-dev-github-release.sh` — prefer the split server release.

(Use **`install:base`** / **`install:previs`** from `package.json` if you mirror production optional deps.)

### 4. Simulation mode

Stick Studio drives simulation against the **HighAsCG repo path** configured at the top of the window (point this at your **local git checkout** on the workstation, not necessarily the stick copy), using [`client/tools/portable-desktop/launch-sim-from-exfat.cjs`](../client/tools/portable-desktop/launch-sim-from-exfat.cjs) with exFAT paths.

For headless / CI testing, from a repo that has the same mount layout available:

```bash
node client/tools/portable-desktop/launch-sim-from-exfat.cjs
```

### 5. Reference docs

- [**`WO47_ISO_VS_EXFAT.md`**](WO47_ISO_VS_EXFAT.md) — split between squashfs and exFAT.
- [**`BUILD_AND_FLASH.md`**](../tools/eggs/live-usb/BUILD_AND_FLASH.md) — full build and flash runbook.
- [**`EXFAT_DATA_ZERO_TOUCH.md`**](../tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md) — mount and data layout on the stick.

## Troubleshooting

- **Eggs prints “finished” but the release script says there is no ISO** — the image is often at **`/home/eggs/mnt/highascg_*.iso`**. The release script now **`chmod`**s that tree after a full/quick build so your user can read it; if you built ISO separately, run **`sudo chmod a+rx /home/eggs/mnt`** and **`sudo chmod a+r /home/eggs/mnt/*.iso`**, or set **`HIGHASCG_ISO=/home/eggs/mnt/….iso`**.
- **Exit code 141** — usually **SIGPIPE** (e.g. a broken pipe or the terminal closing while a long **`tar`**/upload is still running). Re-run after the ISO step finishes, or run **`./work/deprecated/tools/release/make-dev-github-release.sh --no-iso`** once the ISO already exists (still uploads that ISO + a fresh tarball).
- **`HIGHASCG_ISO`** is **ignored** with **`--app-only`** (those releases intentionally have no ISO asset).

## Environment variables

| Variable | Role |
|----------|------|
| `BASENAME` | Passed to Eggs / build scripts (default `highascg`). |
| `HIGHASCG_ISO` | For **full** releases: explicit `.iso` path (skips **`find_latest_iso`** under **`/home/eggs/`**). **Ignored** with **`--app-only`**. |
| `GITHUB_REPOSITORY` | `owner/name` if `gh` cannot infer from `git remote`. |
| `GH_TOKEN` | Token for non-interactive `gh` (CI). |

## CI note

`eggs produce` and full ISO builds usually need **root** and a prepared Linux host. **Server tarball** uploads (`release:github-server`) avoid that path entirely. For GitHub Actions you may run **`release:github-server:dry`**, or attach prebuilt ISO artifacts separately; keep secrets (`GH_TOKEN`) in encrypted vars.
