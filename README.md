<div align="center">
  <h1>HighAsCG</h1>
  <p><strong>A Node.js bridge service for CasparCG playout machines.</strong></p>
  
  <p>
    <a href="https://mko1989.github.io/highascg/"><strong>📚 Read the Wiki</strong></a> ·
    <a href="https://highascg.dpdns.org/"><strong>💿 Download the ISO</strong></a> ·
    <a href="https://github.com/mko1989/highascg-client"><strong>🖥️ Client UI Repository</strong></a>
  </p>
</div>

---

## 📌 Overview

**HighAsCG** is a backend bridge service designed to run on a playout machine. It acts as the critical connection layer between the **operator client** (an Electron/web UI on a laptop) and **CasparCG** (AMCP playout). Additionally, it interfaces with Ubuntu OS APIs to manage GPU layout, exFAT/USB ingest, and hardware settings.

HighAsCG runs an HTTP and WebSocket server on port **4200**. 
*(Note: HighAsCG does **not** host the operator UI in production.)*

### 🧱 Architecture Overview

- **This Repository (Server)**: The Node.js API and WebSocket bridge (`src/`), systemd services, installer, and Ubuntu stack utilities. These go into the [live ISO](https://highascg.dpdns.org/) and exFAT server drops.
- **Client Repository**: [**highascg-client**](https://github.com/mko1989/highascg-client) — A separate Vite UI and Electron launcher that runs on the **operator machine**. 
- **Documentation**: Check out the [Wiki](https://mko1989.github.io/highascg/) for in-depth technical documentation. Local architectural documents can also be found in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 🚀 Getting Started

### Requirements

- **Node.js** ≥ 20 (LTS 20 or 22 recommended)
- **CasparCG** (Reachable on the configured AMCP port, default `5250`)

### Installation

```bash
cd HighAsCG
npm install
```

### Starting the Server

```bash
npm start
```
By default, the API will be available at `http://127.0.0.1:4200`.

---

## ⚙️ Configuration

Defaults live in `config/default.js`. You can override them via environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `CASPAR_HOST` | CasparCG host IP | `127.0.0.1` |
| `CASPAR_PORT` | AMCP port | `5250` |
| `HTTP_PORT` | API server port | `4200` |
| `HIGHASCG_HEADLESS` | Run API only (no static UI) | `true` (on playout) |
| `BIND_ADDRESS` | Listen address | `0.0.0.0` |
| `OSC_LISTEN_PORT` | OSC UDP port | `6251` |
| `CASPAR_ARM_FILE` | Path touched when "arming" staged Caspar startup | `/home/casparcg/highascg/data/caspar-armed` |

Alternatively, use CLI flags (e.g., `node index.js --port 4200 --no-caspar`). See `node index.js --help` for all options.

---

## 🔌 API & Integration

### OSC (CasparCG → HighAsCG)
CasparCG sends OSC over UDP. HighAsCG listens on `OSC_LISTEN_PORT` (default `6251`) and aggregates messages into its internal state. 

### Staged Caspar Startup (Production)
On a playout machine, HighAsCG can start first, allow for Caspar config updates, and then **arm** Caspar so the supervisor script starts `casparcg-server`.
- Manage via HTTP: `GET /api/system/caspar-arm`, `POST`, `DELETE`

---

## 💻 Development & Deployment

**Split Development (Recommended)**:
1. **Playout API Host (This Repo)**: Run `npm start` (API on `:4200`)
2. **Operator Laptop (Client Repo)**: Run `npm run dev` in [highascg-client](https://github.com/mko1989/highascg-client) (UI on `:3000` connected to `VITE_HIGHASCG_API_ORIGIN=http://<playout-ip>:4200`)

**Deploy Server to Playout Host**:
```bash
npm run deploy:dev
```

### Project Layout

| Path | Role | On playout server? |
|------|------|--------------------|
| `index.js`, `src/` | Node bridge — Caspar AMCP, REST `/api/*`, WebSocket, OS hooks | **Yes** |
| `config/` | Modular settings (runtime JSON) | **Yes** |
| `template/` | Caspar HTML templates | **Yes** |
| `scripts/` | Production installer, systemd | **Yes** |
| `tools/runtime/` | exFAT sync CLI, staged Caspar start | **Yes** |
| `client/` | Legacy in-tree browser UI (dev); not in server tarball | **No** |
| `work/` | Work orders, references, planning | **No** |

### Verification & Testing
Run smoke tests against the running server:
```bash
npm run smoke -- 4200
```
With CasparCG connected:
```bash
npm run smoke:caspar -- 4200
```
