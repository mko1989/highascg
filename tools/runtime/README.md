# Runtime helpers (shipped with server)

Installed under `~/highascg/tools/runtime/` on playout machines (server GitHub release + exFAT `update/server/`).

| File | Purpose |
|------|---------|
| `exfat-sync-cli.js` | Boot mtime sync (`highascg-exfat-sync.service`) |
| `start-highascg.sh` | Minimal `node index.js` launcher |
| `casparcg-staged-start.sh` | Caspar after `data/caspar-armed` |
| `casparcg-run.sh` | Caspar restart wrapper (canonical copy for `/opt/casparcg/run.sh`) |
