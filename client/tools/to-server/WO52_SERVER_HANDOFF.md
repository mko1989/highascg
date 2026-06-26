# WO-52 server handoff (client → server)

**Program:** [52_WO_SERVER_HOSTED_UI_MIGRATION_INDEX](../not-needed/work/work-orders/52_WO_SERVER_HOSTED_UI_MIGRATION_INDEX.md)  
**Slices covered here:** 52a (enable UI on playout), 52b (release + drop-update)

---

## 1. Apply from client repo

```bash
cd /path/to/highascg-client
npm run to-server:prepare
SERVER_ROOT=/path/to/highascg-server bash to_server/apply-to-server.sh
```

This copies:

- `to_server/dist-web/` → `$SERVER_ROOT/dist-web/`
- `to_server/server/**` → `$SERVER_ROOT/` (patched scripts, config, src comments)

---

## 2. Playout machine (already deployed)

### A. Deploy code + UI

Option 1 — **dev-push** (from server checkout after apply):

```bash
cd /path/to/highascg-server
# Defaults now include dist-web/ (DEPLOY_SERVER_ONLY=0)
bash client-scripts/dev-push.sh
```

Option 2 — **stick drop-update**:

```bash
# On workstation: extract highascg-server_*.tar.gz to stick
tar -xzf highascg-server_*.tar.gz -C /Volumes/HIGHASCGEXF/drop-update
test -f /Volumes/HIGHASCGEXF/drop-update/package.json
test -f /Volumes/HIGHASCGEXF/drop-update/dist-web/index.html
```

Boot playout → `highascg-exfat-server-update.service` rsyncs into `~/highascg/`.

### B. Disable headless mode

```bash
sudo rm -f /etc/systemd/system/highascg.service.d/10-headless.conf
# Or set HIGHASCG_HEADLESS=false in ~/highascg/.env
sudo systemctl daemon-reload
sudo systemctl restart highascg
```

### C. Verify

```bash
curl -sS http://127.0.0.1:4200/ | head -3
# Open from LAN: http://<playout-ip>:4200/
```

Allow TCP **4200** on firewall if needed.

---

## 3. Release tarball (server repo)

After applying patches:

```bash
cd /path/to/highascg-server
RELEASE_BUILD_CLIENT=0 npm run release:github-server:dry   # dist-web/ must exist
npm run release:github-server
```

`dist-web/` is a **required** member when `RELEASE_SERVER_ONLY` is not set.

Legacy API-only drops: `RELEASE_SERVER_ONLY=1 npm run release:github-server`.

---

## 4. Patched files (in `to_server/server/`)

| File | Change |
|------|--------|
| `scripts/archive-common.sh` | Include `dist-web/` in server tarball; deploy defaults |
| `scripts/highascg-exfat-server-update.sh` | `drop-update/` primary path |
| `config/server-update-rsync-excludes.txt` | Allow `dist-web/` rsync |
| `scripts/write-highascg-systemd-unit.sh` | Headless drop-in opt-in only |
| `tools/eggs/live-usb/systemd/highascg.service.d-10-headless.conf.example` | Document opt-in |
| `src/repo-paths.js` | Comments: production serves `dist-web/` |
| `src/server/headless-mode.js` | Comments: CI/dev opt-in |
| `tools/release/make-github-release-server.sh` | Release notes + dist-web check |
| `client-scripts/sync-dist-web-from-client.sh` | **NEW** — sync UI from client repo |
| `client-scripts/dev-push.sh` | Defaults + no forced headless `.env` |

---

## 5. Rollback

- Restore `10-headless.conf` with `HIGHASCG_HEADLESS=true`
- Use `RELEASE_SERVER_ONLY=1` for API-only tarball
- Operators use Electron hub + remote API (pre-WO-52 workflow)
