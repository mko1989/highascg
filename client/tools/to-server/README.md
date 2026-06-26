# to_server — WO-52 server handoff (client → server)

Gitignored staging folder populated by **`npm run to-server:prepare`**.

## Contents

| Path | Purpose |
|------|---------|
| `dist-web/` | Vite production UI — served by playout `node index.js` on **:4200** |
| `server/` | Patched files mirroring **highascg-server** repo paths (WO-52) |
| `apply-to-server.sh` | Copy `dist-web/` + patches into server checkout |
| `WO52_SERVER_HANDOFF.md` | Migration steps for playout + releases |
| `AGENT_SERVER_CLIENT_MERGE.md` | **Agent brief** — what to do/expect on the server (WO-52) |

## Quick start

```bash
# From highascg-client repo root
npm run to-server:prepare

# Into local server tree (not-needed/ or separate checkout)
SERVER_ROOT=/path/to/highascg-server bash to_server/apply-to-server.sh
```

## What changes on the server (WO-52)

- **`dist-web/`** included in deploy tarballs and stick `drop-update/` applies
- **`HIGHASCG_HEADLESS`** no longer forced on playout (UI served from server)
- exFAT apply reads **`drop-update/`** first, legacy **`update/server/`** fallback
- `dev-push` defaults include UI (`DEPLOY_SERVER_ONLY=0`)

See [WO52_SERVER_HANDOFF.md](./WO52_SERVER_HANDOFF.md) and work orders **52a–52b** in server `work/work-orders/`.
