# Production install

From a cloned repo (see main [README.md](../README.md) for Node app setup):

```bash
sudo ./scripts/install.sh
```

**Entry:** [install.sh](install.sh) — sets `SCRIPT_DIR` to the repo root, then sources (in order) `install-config.sh`, `install-helpers.sh`, and `install-phase1.sh` … `install-phase5.sh`. Copy the **whole** `scripts/` directory when distributing; `install.sh` exits if any of those files are missing.

Openbox autostart reference: [**openbox_autostart.md**](../openbox_autostart.md).

---

## Dev deploy (optional)

[dev-push.sh](dev-push.sh) — tarball + `scp` to a remote host (excludes `node_modules`, live `highascg.config.json`, etc.).

```bash
npm run deploy:dev
```

Optional env: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_PATH`, or `.env.deploy` in the repo root.
