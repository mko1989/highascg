# RESTORE playout server after accidental full dev-push

If **`dev-push-full-server.sh`** or the old **`dev-push.sh`** ran against production, it **deleted** most of `/home/casparcg/highascg/` (except `config/`, `node_modules/`, state files) and replaced it with an **incomplete dev tree**. Use this guide to recover.

---

## What was lost vs kept

| Usually **kept** | Usually **wiped** |
|------------------|-------------------|
| `config/` | `src/` |
| `node_modules/` | `template/` |
| `.env` | `scripts/` |
| `highascg.config.json` (if at root) | `tools/` |
| `.highascg-state.json` | `index.js` (replaced with dev copy) |
| `.module-state.json` | `package.json` / lockfile (if not in bad tarball) |

---

## Restore option 1 — exFAT stick archive (best if you use sticks)

SSH to playout:

```bash
ssh casparcg@<playout-ip>
ls -la /home/casparcg/exfat/drop-update/applied/
ls -la /home/casparcg/exfat/update/applied/    # legacy path
```

Pick the **newest** folder **before** the bad deploy. It should contain a full server tree (`src/`, `index.js`, `package.json`).

```bash
sudo systemctl stop highascg
APPLIED=/home/casparcg/exfat/drop-update/applied/YYYYMMDDTHHMMSSZ   # adjust
sudo rsync -a --delete \
  --exclude=node_modules \
  --exclude=config \
  --exclude=.env \
  "${APPLIED}/" /home/casparcg/highascg/
sudo chown -R casparcg:casparcg /home/casparcg/highascg
cd /home/casparcg/highascg && npm ci --omit=dev
sudo systemctl start highascg
```

---

## Restore option 2 — GitHub server release tarball

On your Mac (with a proper **highascg-server** release, not the client repo):

```bash
# Download latest highascg-server_*.tar.gz from GitHub releases
scp highascg-server_*.tar.gz casparcg@<playout-ip>:/tmp/
ssh casparcg@<playout-ip>
sudo systemctl stop highascg
cd /home/casparcg/highascg
sudo find . -mindepth 1 -maxdepth 1 \
  ! -name config ! -name node_modules ! -name .env \
  ! -name 'highascg.config.json' ! -name '.highascg-state.json' \
  ! -name '.module-state.json' ! -name '.highascg-previs' \
  -exec rm -rf {} +
sudo tar -xzf /tmp/highascg-server_*.tar.gz -C /home/casparcg/highascg
sudo chown -R casparcg:casparcg /home/casparcg/highascg
npm ci --omit=dev
sudo systemctl start highascg
```

Then push **UI only** from client:

```bash
cd /path/to/highascg-client
npm run deploy:client
```

---

## Restore option 3 — `sim/highascg` on stick

If the stick has a full sim tree:

```bash
ls /home/casparcg/exfat/sim/highascg/package.json
# same rsync pattern as option 1 from that path
```

---

## Restore option 4 — redeploy from a real server checkout (build machine)

Only if you have a **complete** server repo (not `not-needed` partial):

```bash
DEPLOY_FULL_SERVER=1 bash client-scripts/dev-push-full-server.sh
# Type YES when prompted
```

**Never** use full deploy from the client monorepo `not-needed/` folder — it is not a complete server.

---

## After restore — UI only from now on

```bash
# From client repo
npm run deploy:client

# Or from server checkout (dist-web/ must exist)
bash client-scripts/dev-push.sh
```

These **only** rsync `dist-web/` — they do **not** delete `src/` or the rest of the tree.

---

## Verify

```bash
test -f ~/highascg/index.js && test -d ~/highascg/src && echo "server tree OK"
test -f ~/highascg/dist-web/index.html && echo "UI OK"
curl -sS http://127.0.0.1:4200/api/settings | head -c 100
sudo systemctl status highascg
```

---

## Prevention (fixed in client repo)

| Script | Behavior |
|--------|----------|
| `dev-push.sh` | **UI only** — `rsync dist-web/` |
| `dev-push-full-server.sh` | Full tree — requires `DEPLOY_FULL_SERVER=1` + type `YES` |
| `npm run deploy:client` | UI only from client repo |
