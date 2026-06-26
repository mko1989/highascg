# Agent brief: client / server merge on playout (WO-52)

> **Audience:** Cursor agent (or human) on the **playout machine** or in the **highascg** unified repo.
>
> **UI sources** live in **`client/`** in this repo. Build with `npm run build:client` → **`dist-web/`**.  
> **highascg-client** on GitHub is **optional Electron packaging only** (simulator, multiserver, modules) — **not** the operator UI source tree.  
> **This doc** describes production on playout: **API + UI on `:4200`**, same machine.

**Related:** `WO52_SERVER_HANDOFF.md` (operator steps) · work orders **52a–52b** in `work/work-orders/`

## Canonical operator model

**The HighAsCG client and server run on the same playout machine.** The Node server (`highascg.service`, port **4200**) serves **both** the API and the operator **web GUI** (`dist-web/` at `/`). Operators use any browser at `http://<playout-ip>:4200/`.

The **optional Electron launcher** ([highascg-client](https://github.com/mko1989/highascg-client)) packages a **subset** of this repo (`client/tools/electron-launcher/`) for stick setup, **simulator**, **multiserver** workflow, and optional **modules**. It opens the system browser to the server URL — it does **not** host the control UI and is **not** where you develop dashboard/scenes/device-view.

---

## 1. What changed (one paragraph)

Production used to run **`HIGHASCG_HEADLESS=true`**: Node served **API only** on `:4200`; operators opened the UI from **Electron** on `:4350`. **WO-52 reverses that default:** the playout server serves **both** API and built UI (`dist-web/`) on **`http://<host>:4200/`** on the **same machine**. The **standalone multiplatform Electron launcher** is a **hub only** (stick setup, links, sim, updates) and opens the **system browser** to the server URL — it does **not** host the control UI.

---

## 2. Target architecture on playout

```
┌─────────────────────────────────────────────────────────┐
│  Ubuntu playout (192.168.x.x)                           │
│  highascg.service → node index.js :4200                   │
│    ├── /api/*        REST                                 │
│    ├── /api/ws       WebSocket                            │
│    ├── /templates/*  Caspar HTML                          │
│    ├── /vendor/*     optional ESM bundles                 │
│    └── /*            dist-web/ SPA (operator UI)          │
└─────────────────────────────────────────────────────────┘
         ▲
         │  http://<playout-ip>:4200/
         │
   Any LAN browser · Electron hub (external browser only)
```

| Concern | Before (WO-51) | After (WO-52) |
|---------|----------------|---------------|
| UI host | Electron `:4350` | Server `:4200` |
| `dist-web/` on playout | Excluded from deploy/drops | **Required** |
| `HIGHASCG_HEADLESS` | `true` in systemd / `.env` | **Unset** (or removed) |
| Stick drop path | `update/server/` (legacy) | **`drop-update/`** (canonical) |
| Operator entry URL | `http://localhost:4350/` | `http://<playout-ip>:4200/` |

---

## 3. Repo layout the server must have

After a successful merge deploy, under `~/highascg/` (or `DEPLOY_PATH`):

```
highascg/
  index.js              # entry — unchanged role
  package.json
  src/                  # Node API, Caspar, WS — unchanged role
  config/
  template/             # Caspar templates → /templates/
  scripts/              # includes patched archive-common, exfat update
  tools/runtime/
  dist-web/             # ★ NEW required in production
    index.html
    assets/
    build-stamp.json    # optional; from client handoff
  client/               # ★ Canonical UI sources (dev/build) — not deployed as sources on playout
```

**Rule:** Ship **`dist-web/`** (built from **`client/`**), not raw **`client/`** sources, on playout sticks and deploy tarballs.

---

## 4. Build & deploy (unified repo)

All development happens in **this repository**:

```bash
# Repo root — playout or dev machine
npm install
npm run build:client    # client/ → dist-web/
npm start               # :4200 serves API + dist-web/
```

Deploy to another playout host:

```bash
npm run build:client    # ensure dist-web/ is current
npm run deploy:dev      # includes dist-web/ by default
```

Legacy `client/tools/to-server/` scripts are for historical handoffs from the old split-repo workflow — prefer **`npm run build:client`** in this repo.

---

## 5. Agent tasks on the server (checklist)

### A. After code lands (deploy or stick drop)

- [ ] Confirm `dist-web/index.html` exists under deploy path
- [ ] Confirm **`10-headless.conf` is absent:**
  ```bash
  test ! -f /etc/systemd/system/highascg.service.d/10-headless.conf && echo OK
  ```
- [ ] Confirm `.env` does **not** force headless:
  ```bash
  grep '^HIGHASCG_HEADLESS=' ~/highascg/.env || echo "no headless in .env (good)"
  ```
  If `HIGHASCG_HEADLESS=true`, remove that line.
- [ ] Restart service:
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl restart highascg
  ```
- [ ] Smoke test locally on playout:
  ```bash
  curl -sS http://127.0.0.1:4200/ | head -5          # HTML, not JSON error
  curl -sS http://127.0.0.1:4200/api/settings | head -c 200
  ```
- [ ] Smoke test from LAN (if applicable): open `http://<playout-ip>:4200/`

### B. Patched server scripts — know what they do

| File | Agent expectation |
|------|-------------------|
| `scripts/archive-common.sh` | Server tarballs **include** `dist-web/` unless `RELEASE_SERVER_ONLY=1`. macOS-safe (no bash 4 namerefs). |
| `scripts/highascg-exfat-server-update.sh` | Reads **`/home/casparcg/exfat/drop-update/`** first; falls back to `update/server/`. Rsyncs **`dist-web/`** to `~/highascg/`. |
| `config/server-update-rsync-excludes.txt` | **`dist-web/` is NOT excluded** anymore. |
| `scripts/write-highascg-systemd-unit.sh` | Installs headless drop-in **only** if `HIGHASCG_INSTALL_HEADLESS=1`. Default install: **no** headless. |
| `client-scripts/dev-push.sh` | `ROOT` = parent of `client-scripts/` (one `..`). Default deploy includes `dist-web/`. Clears `HIGHASCG_HEADLESS` from remote `.env` on full deploy. |
| `client-scripts/sync-dist-web-from-client.sh` | Legacy — prefer `npm run build:client` in unified repo. |
| `src/repo-paths.js` | `resolveWebDir()` prefers `dist-web/` when `index.html` exists. |
| `src/server/headless-mode.js` | Headless only when env explicitly set. |

### C. Do **not** do (unless explicitly asked)

- Do **not** re-enable `HIGHASCG_HEADLESS=true` on production playout without user request
- Do **not** remove `dist-web/` from stick drops or rsync excludes again
- Do **not** expect `client/` sources on playout — only `dist-web/`
- Do **not** add nginx or a second UI port unless user requests it — v1 is same-origin `:4200`
- Do **not** embed operator UI in Electron on the server — server has no Electron role

### D. Optional / CI-only headless

For API-only debugging on the server checkout:

```bash
HIGHASCG_HEADLESS=true node index.js
```

Or install systemd drop-in manually from `tools/eggs/live-usb/systemd/highascg.service.d-10-headless.conf.example`.

---

## 6. Stick / exFAT updates (playout boot)

Canonical drop layout on `HIGHASCGEXF`:

```
drop-update/
  package.json
  index.js
  src/
  dist-web/          # ★ must be present for UI update
  ...
drop-update/applied/<UTC>/   # archived after successful apply
```

Boot order (unchanged):

```
exfat mount → highascg-exfat-server-update → exfat-sync → highascg.service
```

After apply, operators use **`http://<playout-ip>:4200/`** — no stick copy of the client repo required.

---

## 7. How the browser UI talks to the API (same origin)

When the SPA is served from `:4200`, `client/lib/api-origin.js` uses **relative** paths:

- `fetch('/api/...')`
- `WebSocket` → `ws://<host>:4200/api/ws`

No `highascg-api-origin` meta tag or CORS proxy is needed on playout.

**Dev-only exception:** Vite on `:4350` still proxies to API — that runs on developer laptops, not on playout.

---

## 8. Electron hub (operator laptop) — server agent context

The server agent does **not** run Electron. Know this so you don't debug the wrong layer:

| Component | Runs on | Serves UI? |
|-----------|---------|------------|
| `highascg.service` | Playout | **Yes** (`dist-web/`) |
| Electron launcher | Operator Mac/PC | **No** — opens system browser to `http://<server>:4200/` |

If a user says "launcher won't show UI", verify **server** `curl http://<ip>:4200/` first before touching Electron (WO-52c).

---

## 9. Troubleshooting matrix

| Symptom | Likely cause | Server-side fix |
|---------|--------------|-----------------|
| `GET /` returns JSON `"headless mode"` | `HIGHASCG_HEADLESS` set | Remove from `.env` and systemd drop-in; restart |
| `GET /` 404, API works | Missing `dist-web/` | Run `npm run build:client` and redeploy |
| UI loads, WS fails | Firewall / bind address | `BIND_ADDRESS=0.0.0.0`; open port 4200 |
| Stick boot didn't update UI | Drop missing `dist-web/` or old rsync excludes | New drop with full server tar; check `drop-update/` path |
| `dev-push` can't find `archive-common.sh` | Wrong `ROOT` in script | Use patched `client-scripts/dev-push.sh` (`..` not `../..`) |
| `local: -n: invalid option` on Mac | Old `archive-common.sh` | Use bash-3.2-safe `archive-common.sh` from handoff |

---

## 10. Verification commands (copy-paste for agent)

```bash
# On playout as casparcg
test -f ~/highascg/dist-web/index.html && echo "UI bundle: OK" || echo "UI bundle: MISSING"
test -f ~/highascg/index.js && echo "server entry: OK"
systemctl is-active highascg
curl -sf http://127.0.0.1:4200/ | grep -q '<!DOCTYPE html' && echo "HTML UI: OK" || echo "HTML UI: FAIL"
curl -sf http://127.0.0.1:4200/api/settings >/dev/null && echo "API: OK" || echo "API: FAIL"
```

```bash
# Check headless not forced
systemctl show highascg -p Environment 2>/dev/null | grep -i headless || echo "no headless in unit env"
grep HEADLESS ~/highascg/.env 2>/dev/null || echo "no headless in .env"
```

---

## 11. Release / packaging expectations

- **`highascg-server_*.tar.gz`** must contain `dist-web/index.html` at archive root (unless `RELEASE_SERVER_ONLY=1` emergency build).
- Rebuild UI on playout: `npm run build:client` (sources in `client/`).
- Optional **`highascg-client`** Electron releases: simulator / multiserver / modules packaging — not the canonical UI tree.

---

## 12. Work log (server agent)

When you change server behavior for WO-52, append:

```
### YYYY-MM-DD — Agent
- What was done
- Deploy path / stick / manual
- Verification results
- Instructions for next agent
```

---

## 13. Quick decision tree

```
User wants UI on playout?
  ├─ Yes → dist-web/ present, headless OFF, restart highascg, test :4200
  ├─ UI missing after deploy → run npm run build:client; check dist-web/; redeploy
  ├─ Stick update → drop-update/ with full server tar including dist-web/
  └─ API-only debug → HIGHASCG_HEADLESS=true temporarily (not production default)
```

*End of agent brief — WO-52 server / client merge*
