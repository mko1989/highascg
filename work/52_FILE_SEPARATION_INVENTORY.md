# HighAsCG file separation and distribution inventory

Concrete list of what belongs to the **server (bundled backend)** vs the **client (browser UI)**. Use for penguins-eggs excludes, `release:github-server` / `release:github-client` tarballs, and exFAT layout.

**Narrative overview:** [`BACKEND_AND_CLIENT_SPLIT.md`](BACKEND_AND_CLIENT_SPLIT.md)  
**WO‑47 ISO vs stick:** [`../docs/WO47_ISO_VS_EXFAT.md`](../docs/WO47_ISO_VS_EXFAT.md)  
**Eggs exclude fragment:** [`../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`](../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list)

---

## Layout (current repo)

| Location | Role |
|----------|------|
| **`index.js`**, **`src/`** | Server at **repo root** — Node orchestrator |
| **`client/`** | UI sources (ES modules) — **not** on playout stick |
| **`dist-web/`** | Vite production build (`npm run build:client`) — Mac/Windows client |
| **`config/`**, **`template/`**, **`scripts/`** | Shipped with server |
| **`tools/runtime/`** | Playout helpers only (`exfat-sync-cli`, Caspar staged start) |
| **`tools/eggs/`**, **`tools/smoke/`**, **`tools/release/`** | Build host / dev — **not** on playout stick |
| **`client/tools/`** | Operator kit, portable sim, client release |

---

## 1. Client only (SPA / static UI)

Remove from **headless server** tarballs, **closed ISO** squashfs, and **exFAT `update/server/`**.

| Path | Notes |
|------|--------|
| **`client/`**, **`dist-web/`** | Remote UI; connects to server via HTTP/WS |
| **`client/tools/`** | Launchers, stick studio, client GitHub release |

---

## 2. Server only (bundled backend)

| Path | Notes |
|------|--------|
| **`index.js`**, **`src/`**, **`config/`**, **`template/`**, **`scripts/`** | Core server |
| **`tools/runtime/`** | Only tools subtree on playout (`exfat-sync-cli.js`, …) |
| **`package.json`**, **`package-lock.json`** | Node deps |

**Dev-only (not in server tarball / ISO):** `work/`, `docs/`, `tools/smoke/`, `tools/eggs/`, `client/`, `deprecated/`

---

## 3. Eggs exclude list (squashfs omits → exFAT `update/server/`)

From `penguins-eggs-exclude-highascg-fragment.list`:

```
home/casparcg/highascg/src, scripts, index.js, package.json, …
home/casparcg/highascg/tools/*     (entire tools/ tree)
home/casparcg/highascg/client/*, dist-web/*, deprecated/*
```

**On stick:** `highascg-server_*.tar.gz` → **`update/server/`** provides `src/`, `scripts/`, **`tools/runtime/`**, etc.

ISO keeps: Caspar **`config/casparcg.config`**, **`lib/`**, empty **`media/`** / **`template/`** stubs.

---

## 4. exFAT stick paths (operator payload)

| exFAT path | Contents |
|------------|----------|
| **`update/server/`** | Server drop (`highascg-server_*.tar.gz` extract) |
| `drop-config/` | Optional `highascg.config.json` |
| `media/`, `templates/`, `configs/`, … | Operator data |

**Legacy (deprecated):** `sim/highascg/` — do not use for new playout sticks.

**Client:** install on Mac/Windows; **not** copied to playout exFAT.

---

## 5. GitHub release tarballs

| Script | Includes | Excludes |
|--------|----------|----------|
| **`release:github-server`** | `index.js`, `src/`, `scripts/`, `config/`, `template/`, **`tools/runtime/`** | `client/`, `dist-web/`, `tools/smoke/`, `tools/eggs/` |
| **`release:github-client`** | `dist-web/` only | All server paths |
| **Monolith** (deprecated) | See `deprecated/tools/release/make-dev-github-release.sh` | — |

---

## Checklist before `eggs produce`

- [ ] Build host checkout is **`~/highascg`** only.
- [ ] `sudo npm run eggs:prepare` — merged excludes + WO‑47 units.
- [ ] `npm run verify:structure`
- [ ] Stick: extract **`highascg-server_*.tar.gz`** into **`update/server/`** (includes **`tools/runtime/`**).
