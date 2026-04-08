# Tools (optional)

Helpers for development, smoke tests, and advanced production boot layouts. **Not** part of `scripts/install.sh`.

| File | Purpose |
|------|---------|
| [http-smoke.js](http-smoke.js) | `npm run smoke -- <port>` — HTTP + WebSocket checks against a running server |
| [smoke-caspar.js](smoke-caspar.js) | `npm run smoke:caspar -- <port>` — extra checks when Caspar is connected |
| [verify-w02-structure.js](verify-w02-structure.js) | Path checklist vs migration WO-02 target tree |
| [boot-orchestrator.js](boot-orchestrator.js) | CLI: network banner, display layout (`node tools/boot-orchestrator.js`) |
| [setup-kmsgrab-from-ssh.sh](setup-kmsgrab-from-ssh.sh) | SSH helper for DRM/kmsgrab on a headless box |
| [start-highascg.sh](start-highascg.sh) | Minimal `node index.js` launcher under `/opt/highascg` |
| [casparcg-staged-start.sh](casparcg-staged-start.sh) | Wait for “armed” ready file, then Caspar supervisor loop |

### Staged Caspar (scanner + HighAsCG first, Caspar after arm)

**Goal:** Start media scanner and HighAsCG before Caspar; Caspar runs only after a ready file exists (or `POST /api/system/caspar-arm`).

**Default ready file:** `/opt/casparcg/data/caspar-armed` — align with **`CASPAR_ARM_FILE`** on HighAsCG.

**Example** (adjust paths; copy or symlink `tools/` under `/opt/highascg/tools/`):

```bash
/opt/highascg/tools/start-highascg.sh >> /tmp/highascg.log 2>&1 &
/opt/highascg/tools/casparcg-staged-start.sh >> /tmp/caspar-staged.log 2>&1 &
```

See the main [README.md](../README.md) (staged Caspar section) for HTTP arm/disarm.
