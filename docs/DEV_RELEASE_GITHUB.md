# Dev GitHub releases (ISO + portable tarball)

Use this flow when you have a **build host or workstation** running the repo (typically with `node_modules` already installed). Two modes:

- **Full image (rare)** — Eggs ISO + tarball: **`npm run release:dev-github`** (needs **`sudo`** / eggs).
- **Split server + client (canonical)** — playout API tarball + operator UI:
  - **`npm run release:github-server`** → `highascg-server_<UTC>.tar.gz` (no `client/`, `dist-web/`)
  - **`npm run release:github-launcher`** → `highascg-launcher_<UTC>.tar.gz` (Electron prep kit + embedded `dist-web/`)
  - **`npm run release:github-client`** → `highascg-client_<UTC>.tar.gz` (`dist-web/` only — optional if you use launcher tarball)
- **Alpha / app-only (legacy monolith)** — **`npm run release:github-app`** — full repo tarball with `dist-web/`; prefer split releases for new sticks.

**Playout stick:** extract **`highascg-server_*.tar.gz`** into **`update/server/`** only (API + Caspar; no UI). **Operator laptop:** **`highascg-launcher_*.tar.gz`** or clone + **`npm run launcher`**. Do not put `dist-web/` on the playout stick.

## What gets published

**Full** run (`release:dev-github`) produces:

| Asset | Produced by |
|-------|----------------|
| `highascg_*.iso` under `/home/eggs/` | **Full:** `sudo npm run eggs:build` — merges [`penguins-eggs-exclude-highascg-fragment.list`](../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list) via `prepare-eggs-clone-with-exfat.sh`. **Quick (deprecated):** `sudo bash deprecated/tools/release/make-dev-github-release-iso-quick.sh` |

**Every** run produces:

| Asset | Produced by |
|-------|----------------|
| `dist/highascg_<UTC>.tar.gz` | **Legacy** monolith (`release:github-app`): `src/` + built **`dist-web/`**. Split server tarball has **no** `dist-web/`. |

**Legacy alpha** (`npm run release:github-app`): monolith tarball only — prefer **`release:github-server`** + **`release:github-launcher`** for new deployments.

GitHub Releases have a soft **per-asset ~2 GiB** limit. If the server tarball is too large, use `--zip-exclude-node-modules` and run `npm ci` under `~/highascg` after the stick applies `update/server/`.

### Why is the **server** tarball so big?

The **server** asset (`release:github-server`) is backend-only — it does **not** include `client/` or `dist-web/`. Size still adds up because:

| Component | Typical share |
|-----------|----------------|
| **`node_modules/`** | Largest — all runtime deps (optional packages too if installed). Use `--zip-exclude-node-modules` + `npm ci` on the stick. |
| **`tools/runtime/`** | Only tools subtree in server tarball (`exfat-sync-cli`, staged Caspar). |
| **`src/`** | Node orchestrator, APIs, Caspar client (repo root). |
| **`scripts/`**, **`config/`**, **`template/`** | Install helpers and Caspar templates. |

The **client** tarball is small (`dist-web/` only). The **launcher** tarball ships `client/tools/electron-launcher/` including synced `dist-web/`. **`release:github-app`** remains a legacy monolith with both server and UI.

Shared rules: [`scripts/archive-common.sh`](../scripts/archive-common.sh) (used by deploy + release scripts).

## Prerequisites

1. **`gh`** installed and **`gh auth login`** finished for the repo you push to.
2. **`tar`** (gzip) — standard on Ubuntu/Debian. **`sudo`** only for **full** image builds (**`npm run release:dev-github`**).
3. **penguins‑eggs** only when you build a **full** ISO (same expectations as [**`BUILD_AND_FLASH.md`**](../tools/eggs/live-usb/BUILD_AND_FLASH.md)).
4. Repo root checkout (for `npm run …` wrappers below).

## Commands

### Split — server + launcher (canonical)

```bash
npm run release:github-server:dry
npm run release:github-launcher:dry
npm run release:github-server
npm run release:github-launcher
```

On the playout stick:

```bash
mkdir -p <mount>/update/server
tar -xzf highascg-server_<stamp>.tar.gz -C <mount>/update/server
```

Operator laptop: extract **`highascg-launcher_*.tar.gz`**, `npm install electron` in `electron-launcher/`, run Electron, set playout API host/port. Production playout: **`HIGHASCG_HEADLESS=true`**.

Optional UI-only drop: **`npm run release:github-client`** (same `dist-web/` as launcher sync).

### Legacy — monolith tarball

```bash
npm run release:github-app:dry
npm run release:github-app
```

### Full image — Eggs ISO + tarball (rare)

Dry run:

```bash
npm run release:dev-github:dry
```

Full prerelease with default full ISO:

```bash
npm run release:dev-github
```

Direct script equivalents:

```bash
./deprecated/tools/release/make-dev-github-release.sh --app-only --dry-run
./deprecated/tools/release/make-dev-github-release.sh --app-only
./deprecated/tools/release/make-dev-github-release.sh --dry-run
./deprecated/tools/release/make-dev-github-release.sh
./deprecated/tools/release/make-dev-github-release.sh --quick-iso --tag dev-smoke-$(date -u +%Y%m%d)
```

See `./deprecated/tools/release/make-dev-github-release.sh --help` for every flag.

Useful variants:

| Need | Flags |
|------|--------|
| **Server + launcher prereleases** | **`release:github-server`** + **`release:github-launcher`** |
| **Legacy monolith tarball** | **`npm run release:github-app`** or **`--app-only`** |
| Rebuild tarball + attach **existing** ISO | `--no-iso` (still expects an ISO under `/home/eggs/`). |
| Smaller archive | `--zip-exclude-node-modules` |
| Repeat same tag during testing | `--replace` |
| Custom tag | `--tag name` |
| Custom output directory | `--out-dir /tmp/rel` |
| Historical source in archive | `--zip-with-git` and/or `--zip-with-work` |

## ISO discovery

The helper uses **`find_latest_iso`** from [`flash-stick-common.sh`](../tools/eggs/live-usb/flash-stick-common.sh) (same rule as flashing tools — typically **`/home/eggs/**/*.iso`** newest). Align **`BASENAME`** with Eggs output if you renamed the image.

## Operator path: Stick Studio + release tarball

Designed to match WO‑47: live system on hybrid ISO plus **`HIGHASCGEXF`** exFAT for data.

### 1. Download release assets

From the GitHub **Releases** page, download:

- The **ISO** (from a **full** `release:dev-github` run, or reuse an older ISO you keep on file).
- **`highascg_<timestamp>.tar.gz`** — **every** prerelease has this; **alpha** / **`release:github-app`** releases have **only** this file (unless you used `--zip-exclude-node-modules`).

### 2. Flash ISO and carve exFAT (desktop)

On a workstation with UI:

```bash
npm run stick-studio
```

Documentation: **`client/tools/stick-tools/README.md`**.

Rough order in the GUI:

1. Point **ISO** at the downloaded file and **whole-disk USB**.
2. Enable **Erase stick with ISO**, run **pkexec pipeline** (or flash first, then exFAT-only if you skipped dd).
3. Enable **Append exFAT … HIGHASCGEXF** where appropriate.
4. Mount the exFAT volume and set **mount path** in Stick Studio; create **`update/server/`** (and operator dirs).

### 3. Lay out server drop on the stick

With the exFAT volume mounted at `<mount>`:

```bash
mkdir -p <mount>/update/server
tar -xzf /path/to/highascg-server_<stamp>.tar.gz -C <mount>/update/server
```

so that `<mount>/update/server/package.json` exists (includes **`tools/runtime/`**).

If the archive omitted `node_modules`, run **`npm ci`** on the playout host after first boot apply (or bake deps into the tarball).

**Monolith / alpha tarball (deprecated):** see `deprecated/tools/release/make-dev-github-release.sh` — prefer split server + client releases.

(Use **`install:base`** / **`install:previs`** from `package.json` if you mirror production optional deps.)

### 4. Simulation mode

Stick Studio runs **`npm run portable:sim`** against the **HighAsCG repo path** configured at the top of the window (point this at your **local git checkout** on the workstation, not necessarily the stick copy). That script uses [`client/tools/portable-desktop/launch-sim-from-exfat.js`](../client/tools/portable-desktop/launch-sim-from-exfat.js) to drive simulation using exFAT paths.

For headless / CI testing, from a repo that has the same mount layout available:

```bash
npm run portable:sim
```

### 5. Reference docs

- [**`WO47_ISO_VS_EXFAT.md`**](WO47_ISO_VS_EXFAT.md) — split between squashfs and exFAT.
- [**`BUILD_AND_FLASH.md`**](../tools/eggs/live-usb/BUILD_AND_FLASH.md) — full build and flash runbook.
- [**`EXFAT_DATA_ZERO_TOUCH.md`**](../tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md) — mount and data layout on the stick.

## Troubleshooting

- **Eggs prints “finished” but the release script says there is no ISO** — the image is often at **`/home/eggs/mnt/highascg_*.iso`**. The release script now **`chmod`**s that tree after a full/quick build so your user can read it; if you built ISO separately, run **`sudo chmod a+rx /home/eggs/mnt`** and **`sudo chmod a+r /home/eggs/mnt/*.iso`**, or set **`HIGHASCG_ISO=/home/eggs/mnt/….iso`**.
- **Exit code 141** — usually **SIGPIPE** (e.g. a broken pipe or the terminal closing while a long **`tar`**/upload is still running). Re-run after the ISO step finishes, or run **`./deprecated/tools/release/make-dev-github-release.sh --no-iso`** once the ISO already exists (still uploads that ISO + a fresh tarball).
- **`HIGHASCG_ISO`** is **ignored** when using **`--app-only`** / **`release:github-app`** (those releases intentionally have no ISO asset).

## Environment variables

| Variable | Role |
|----------|------|
| `BASENAME` | Passed to Eggs / build scripts (default `highascg`). |
| `HIGHASCG_ISO` | For **full** releases: explicit `.iso` path (skips **`find_latest_iso`** under **`/home/eggs/`**). **Ignored** with **`--app-only`**. |
| `GITHUB_REPOSITORY` | `owner/name` if `gh` cannot infer from `git remote`. |
| `GH_TOKEN` | Token for non-interactive `gh` (CI). |

## CI note

`eggs produce` and full ISO builds usually need **root** and a prepared Linux host. **Alpha** uploads (**`--app-only`**) avoid that path entirely. For GitHub Actions you may run **`release:github-app`**, **`--dry-run`**, or attach prebuilt ISO artifacts separately; keep secrets (`GH_TOKEN`) in encrypted vars.
