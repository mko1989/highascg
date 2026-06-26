<div align="center">
  <h1>HighAsCG</h1>
  <p><strong>CasparCG playout control — unified client + server on one Ubuntu host.</strong></p>
  
  <p>
    <a href="https://mko1989.github.io/highascg/"><strong>📚 Read the Wiki</strong></a> ·
    <a href="https://highascg.dpdns.org/"><strong>💿 Download the ISO</strong></a> ·
    <a href="https://github.com/mko1989/highascg-client"><strong>🖥️ Electron launcher</strong></a> (optional)
  </p>
</div>

---

## 📌 Overview

**HighAsCG** is a **single repository** for modular, unified development: the **operator UI** (`client/`), the **Node API bridge** (`src/`), and playout tooling all live here and run together on the **Ubuntu playout machine**.

The Node service on port **4200** serves **both** the REST/WebSocket API and the built operator web GUI (`dist-web/`). Operators open **`http://<playout-ip>:4200/`** in any browser on the playout host or LAN.

| Piece | Where it lives | Role |
|-------|----------------|------|
| **Operator UI sources** | **`client/`** in this repo | Canonical UI — dashboard, scenes, device view, timeline, settings |
| **Production UI bundle** | **`dist-web/`** | Vite build output — what `:4200` serves |
| **API / Caspar / OS bridge** | **`src/`**, `index.js` | AMCP, GPU, exFAT, WebSocket, config |
| **Electron launcher** | [**highascg-client**](https://github.com/mko1989/highascg-client) (optional, separate packaging) | Stick prep, **simulator**, **multiserver** workflow, optional modules (CG Studio, …) — extracted from `client/tools/electron-launcher/` here. Opens the **system browser** to playout `:4200`; does **not** host the control UI |

> **Do not develop the operator UI in highascg-client.** That repo is an Electron packaging extract only. Edit **`client/`** in this repo, then `npm run build:client`.

### 🧱 Architecture

- **This repository** — unified client + server; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **highascg-client** — optional Mac/Windows/Linux Electron hub (simulator, multiserver, modules); not the UI source tree.
- **Documentation** — [Wiki](https://mko1989.github.io/highascg/) · local [`docs/`](docs/).

---

## 🚀 Getting Started

### Requirements

- **Node.js** ≥ 20 (LTS 20 or 22 recommended)
- **CasparCG** (reachable on AMCP port, default `5250`)
- **`dist-web/index.html`** — run `npm run build:client` after cloning (or ship a prebuilt `dist-web/`)

### Installation

```bash
cd highascg
npm install
npm run build:client   # client/ → dist-web/
```

### Starting the server

```bash
npm start
```

By default: **`http://127.0.0.1:4200/`** (UI + API) and **`http://127.0.0.1:4200/api/...`**.

---

## ⚙️ Configuration

Defaults live in `config/`. Override via environment variables:

| Variable | Purpose | Default (production) |
|----------|---------|----------------------|
| `CASPAR_HOST` | CasparCG host IP | `127.0.0.1` |
| `CASPAR_PORT` | AMCP port | `5250` |
| `HTTP_PORT` | HTTP server port | `4200` |
| `HIGHASCG_HEADLESS` | API only (no `dist-web/`) | **unset** (serve UI) |
| `BIND_ADDRESS` | Listen address | `0.0.0.0` |
| `OSC_LISTEN_PORT` | OSC UDP port | `6251` |
| `CASPAR_ARM_FILE` | Staged Caspar startup arm file | `/home/casparcg/highascg/data/caspar-armed` |

CLI flags: `node index.js --help`.

---

## 🔌 API & Integration

### OSC (CasparCG → HighAsCG)
CasparCG sends OSC over UDP. HighAsCG listens on `OSC_LISTEN_PORT` (default `6251`).

### Staged Caspar startup
HighAsCG can start first, apply config, then arm Caspar: `GET/POST/DELETE /api/system/caspar-arm`.

---

## 💻 Development & deployment

**On playout (production):** `highascg.service` serves API + `dist-web/` on `:4200`. Do **not** install `10-headless.conf` unless you explicitly want API-only debug.

**UI iteration (same machine or dev laptop):**

```bash
npm start              # API on :4200
npm run dev:client     # Vite on :4350 → proxies /api to :4200
```

Copy `.env.development.example` → `.env.development`; set `VITE_HIGHASCG_API_ORIGIN` to the API host.

**Rebuild what the server serves after UI edits:**

```bash
npm run build:client   # refreshes dist-web/ — normal browser refresh is enough (no server restart)
```

Use `npm run start:headless` only for API-only debug.

**Deploy to playout host:**

```bash
npm run build:client   # ensure dist-web/ is current
npm run deploy:dev     # includes dist-web/ by default
```

See [`from_client/AGENT_SERVER_CLIENT_MERGE.md`](from_client/AGENT_SERVER_CLIENT_MERGE.md).

### Project layout

| Path | Role | On playout server? |
|------|------|--------------------|
| `index.js`, `src/` | Node bridge — REST, WS, Caspar, OS hooks | **Yes** |
| `client/` | **Canonical operator UI sources** | Sources only — ship **`dist-web/`** |
| `dist-web/` | Built operator UI (served on `:4200`) | **Yes** |
| `config/`, `template/`, `scripts/` | Settings, Caspar templates, systemd | **Yes** |
| `tools/runtime/` | exFAT sync CLI, staged Caspar start | **Yes** |
| `client/tools/electron-launcher/` | Electron hub sources (packaged in highascg-client) | **No** on playout |
| `work/` | Work orders, planning | **No** |

### Verification

```bash
npm run smoke -- 4200
npm run smoke:caspar -- 4200
curl -sf http://127.0.0.1:4200/ | head -5   # expect HTML when dist-web present
```
