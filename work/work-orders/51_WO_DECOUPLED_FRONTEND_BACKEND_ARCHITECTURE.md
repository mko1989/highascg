# Work Order 51: Decoupling Frontend & Backend Architecture

**Status: DEPRECATED (2026-07-27) — the headless split model was superseded by WO-52 (API + dist-web/ served from the playout box on :4200). Do not treat as source of truth.**

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:  
> 1. Add a dated entry to the **Work Log** section at the bottom.  
> 2. Update task checkboxes to reflect current status.  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.  
> 4. Do **not** delete previous agents’ log entries.

**Parent / context:** [Architecture Analysis](../../docs/architecture_analysis.md) or `/home/casparcg/.gemini/antigravity/brain/0ec5855d-b84e-4947-b307-3f07952c0eca/architecture_analysis.md`  
**Status:** Historical — WO-51 headless model superseded by **WO-52** (API + `dist-web/` on playout `:4200`). See [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](../../docs/PLAN_SERVER_CLIENT_SPLIT.md), [`from_client/AGENT_SERVER_CLIENT_MERGE.md`](../../from_client/AGENT_SERVER_CLIENT_MERGE.md).  
**Prerequisites:** HighAsCG modular layout rendering, functioning settings and device-graph APIs.

---

## 1. Goal

Split the monolithic **HighAsCG** codebase into two independent, highly specialized services:
1. **Headless Backend (API & Orchestrator)**: A pure Express + WebSocket service that handles CasparCG AMCP connections, timeline plays, DMX, and OS layouts, entirely freed from serving static UI assets.
2. **Modular Frontend SPA (Vite)**: A modern, high-performance static frontend single-page application hosted and scaled independently (using Nginx or a lightweight static file server) that communicates with the backend via configurable HTTP and WebSocket endpoints.

---

## 2. Scope & Boundaries

### Headless Backend Changes
- **CORS Middleware Support**: Integrate standard `cors` middleware inside Express to selectively accept cross-origin requests during development.
- **Remove Static Asset Serving**: Conditionally disable serving the `./web` directory when running in pure headless mode.
- **Configurable Ports**: Add support for independent API (`HIGHASCG_API_PORT`) and WebSocket ports.

### Modern Frontend Changes
- **Vite Bundler Setup**: Create a clean `vite.config.js` configuration in the frontend directory.
- **Dynamic Connection Resolution**: Refactor network communication (`fetch` requests, WebSocket connections) to dynamically resolve paths using standard environment variables (`VITE_API_URL` and `VITE_WS_URL`) or fall back to the host window origin.
- **Isolated Release Lifecycles**: Allow independent building, optimization, and minification of frontend code.

---

## 3. Production Architecture (Nginx Reverse Proxy)

In production environments, both services are stitched together under a unified origin to eliminate CORS overhead entirely.

```nginx
server {
    listen 80;
    server_name highascg.local;

    # Static UI Assets
    location / {
        root /var/www/highascg-client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API Proxy
    location /api/ {
        proxy_pass http://127.0.0.1:4200/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket Proxy
    location /ws/ {
        proxy_pass http://127.0.0.1:4200/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

---

## 4. Tasks (Checklist)

- [x] **T1: Backend - CORS Middleware Support**
  - Install the standard Node `cors` package: `npm install cors`.
  - Wire it inside `src/server/http-server.js` to allow specific dev server origins (e.g., `http://localhost:5173`).
- [x] **T2: Backend - Configurable API Ports**
  - Add `HIGHASCG_API_PORT` (default `4200`) in `highascg.config.json` or `.env` to support independent backend execution.
- [x] **T3: Backend - Conditionally Disable Static Assets**
  - Add a flag (e.g. `HIGHASCG_HEADLESS=true`) to bypass serving `./web` via `express.static` in `src/server/http-server.js` or `index.js`.
- [x] **T4: Frontend - Initialize Vite Configuration**
  - Set up a clean `vite.config.js` config pointing the root to `./web` and defining target outputs inside a `./dist` folder.
- [x] **T5: Frontend - Dynamic Endpoint Client**
  - Create a central `api-client.js` inside `client/lib/` to dynamically map endpoints to `import.meta.env.VITE_API_URL || window.location.origin` for standard calls and socket feeds.
- [x] **T6: Deployment - Environment Setup**
  - Provide an `.env.example` in both frontend and backend directories with the appropriate port configurations.
  - Document the production systemd-unit split layout.

---

## 5. Success Criteria

1. **Headless Mode Runs**: Node.js backend starts up on port `4200` without serving frontend folders and successfully accepts incoming REST API calls under `/api`.
2. **Frontend Compiles**: Running `npm run build` inside the frontend directory compiles optimized, minified HTML/CSS/JS bundles inside `dist/`.
3. **Pristine Connection**: The compiled frontend SPA connects successfully to the backend in both local dev mode (`localhost:5173` connecting to `localhost:4200`) and under production Nginx reverse proxy configurations.

---

## 6. Related Files (Touch Points)

- `index.js` — Core orchestrator and bootstrapping
- `src/server/http-server.js` — Express configuration and asset routes
- `client/` — Frontend assets directory
- `package.json` — Workspace-level dependencies and script bindings

---

## 7. Work Log

### 2026-05-19 — Work Order Drafted
- Created initial work order `51_WO_DECOUPLED_FRONTEND_BACKEND_ARCHITECTURE.md` outlining decoupled goals, boundaries, reverse proxy layouts, and concrete phase checklist tasks.
- **Instructions for next agent:** Begin Phase 1 by adding `cors` middleware inside the Express server, setting up independent environment configurations, and preparing the Vite configuration.

### 2026-05-19 — System Split Implemented & Verified (Agent)
- **Backend Bypass Check**: Integrated `process.env.HIGHASCG_HEADLESS` condition check inside `src/server/http-server.js` to block static directories and return 404 JSON errors.
- **Vite Configured**: Created `vite.config.js` config routing all `/api` and WebSockets upgrades directly to the Node orchestrator and isolating optional dependencies (`three`, `grapesjs`, `html-to-image`) from compilation limits.
- **Verified Operations**: Confirmed dynamic CORS integration, compiled file pathways, and seamless reverse proxy routing. Headless execution verified on port 8888 under local CLI options.
- **Instructions for Next Agent:** Continue monitoring production Nginx bindings; optionally optimize production bundles further once deployed on local site servers.

### 2026-06 — WO-52 supersession note
- **Production:** API + **`dist-web/`** on playout **`:4200`** (same machine). See [`from_client/AGENT_SERVER_CLIENT_MERGE.md`](../../from_client/AGENT_SERVER_CLIENT_MERGE.md).
- **WO-51 headless + remote Electron** remains documented in [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](../../docs/PLAN_SERVER_CLIENT_SPLIT.md) as historical.

### 2026-05-20 — Server/client split closed (PLAN phases 3–4)
- **At the time:** Electron launcher with `HIGHASCG_HEADLESS=true` on playout; server tarball excluded `client/` and `dist-web/`.
- **Superseded by WO-52** — see entry above.
