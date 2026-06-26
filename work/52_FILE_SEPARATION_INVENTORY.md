# HighAsCG file separation and distribution inventory

Concrete list of what belongs to the **server (Node bridge)** vs the **browser UI** for packaging. **Unified repo:** `client/` + `src/` in one tree; **`dist-web/`** served on `:4200` on the playout machine. Optional Electron launcher = sim / multiserver / modules packaging only.

**Narrative overview:** [`BACKEND_AND_CLIENT_SPLIT.md`](BACKEND_AND_CLIENT_SPLIT.md) · [`../from_client/AGENT_SERVER_CLIENT_MERGE.md`](../from_client/AGENT_SERVER_CLIENT_MERGE.md)  
**WO‑47 ISO vs stick:** [`../docs/WO47_ISO_VS_EXFAT.md`](../docs/WO47_ISO_VS_EXFAT.md)  
**Eggs exclude fragment:** [`../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list`](../tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list)

---

## Layout (current repo)

| Location | Role |
|----------|------|
| **`index.js`**, **`src/`** | Server at **repo root** — Node orchestrator |
| **`client/`** | UI **sources** (ES modules) — build only; **not** deployed as sources on playout |
| **`dist-web/`** | Vite production build — **required on playout**; served on `:4200` |
| **`config/`**, **`template/`**, **`scripts/`** | Shipped with server |
| **`tools/runtime/`** | Playout helpers only (`exfat-sync-cli`, Caspar staged start) |
| **`tools/eggs/`**, **`tools/smoke/`**, **`tools/release/`** | Build host / dev — **not** on playout stick |
| **`client/tools/`** | Operator kit, portable sim, client release |

---

## 1. UI sources only (not deployed to playout as-is)

Exclude **`client/`** from playout rsync; **include** built **`dist-web/`**.

| Path | Notes |
|------|--------|
| **`client/`** | **Canonical UI sources** — `npm run build:client` → `dist-web/` |
| **`client/tools/`** | Electron launcher sources → optional [highascg-client](https://github.com/mko1989/highascg-client) packaging (sim, multiserver, modules) |

---

## 2. Server + UI on playout

| Path | Notes |
|------|--------|
| **`index.js`**, **`src/`**, **`config/`**, **`template/`**, **`scripts/`**, **`dist-web/`** | Core server + operator UI |
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
| **`release:github-server`** | `index.js`, `src/`, `scripts/`, `config/`, `template/`, **`tools/runtime/`**, **`dist-web/`** | `client/` (sources), `tools/smoke/`, `tools/eggs/` |
| **`release:github-client`** | `dist-web/` only (optional UI-only hotfix) | All server paths |
| **Monolith** (deprecated) | See `deprecated/tools/release/make-dev-github-release.sh` | — |

---

## Checklist before `eggs produce`

- [ ] Build host checkout is **`~/highascg`** only.
- [ ] `sudo npm run eggs:prepare` — merged excludes + WO‑47 units.
- [ ] `npm run verify:structure`
- [ ] Stick: extract **`highascg-server_*.tar.gz`** into **`update/server/`** (includes **`tools/runtime/`**).
