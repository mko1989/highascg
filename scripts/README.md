# Production install

From a cloned repo (see main [README.md](../README.md) for Node app setup):

```bash
sudo ./scripts/install.sh
```

**Entry:** [install.sh](install.sh) — sets `SCRIPT_DIR` to the repo root, then sources (in order) `install-config.sh`, `install-helpers.sh`, and `install-phase1.sh` … `install-phase5.sh`. Copy the **whole** `scripts/` directory when distributing; `install.sh` exits if any of those files are missing.

Openbox autostart reference: [**openbox_autostart.md**](../openbox_autostart.md).

**USB import on Ubuntu** — udisks2, polkit, and user **`casparcg`** (see `USER_CASPAR` in [install-config.sh](install-config.sh)): [**docs/USB_AUTO_MOUNT_UBUNTU.md**](../docs/USB_AUTO_MOUNT_UBUNTU.md). Phase 4 installs `scripts/polkit/50-*.rules` and **`51-highascg-udisks-casparcg-headless.rules`**; use **`loginctl enable-linger`** on headless playout if needed.

---

## Dev deploy (optional)

[dev-push.sh](dev-push.sh) — **`tar`** (excludes `node_modules`, `.git`, `work`, env files, `highascg.config.json`) → **`ssh`** stream upload (`cat >` tarball on the server) → **`ssh`** to wipe everything under **`DEPLOY_PATH`** except existing **`highascg.config.json`** and **`node_modules`** (so deps are not deleted every time), then **`tar -xzf`**. Does **not** run `npm` on the server. Optional **`DEPLOY_USE_SFTP=1`** or **`DEPLOY_USE_SCP=1`** for other upload modes.

The SSH user must have a **normal login shell** (not `/usr/sbin/nologin`). If you see *This account is currently not available*, run on the server: **`sudo chsh -s /bin/bash`** for **`DEPLOY_USER`**.

```bash
npm run deploy:dev
```

Optional: **`DEPLOY_HOST`**, **`DEPLOY_USER`**, **`DEPLOY_PATH`** (default `/opt/highascg`), **`DEPLOY_REMOTE_TMP`**, **`DEPLOY_REMOTE_SUDO`** (set **`1`** if **`DEPLOY_USER`** cannot write **`DEPLOY_PATH`** — extract runs via **`sudo`**), **`DEPLOY_USE_SFTP`**, **`DEPLOY_USE_SCP`**, **`DEPLOY_SSH_CONTROL`**, **`DEPLOY_SSH_PASSWORD`** (uses `sshpass`, if installed), **`DEPLOY_SUDO_PASSWORD`** (used with `sudo -S` when `DEPLOY_REMOTE_SUDO=1`), or a repo-root **`.env.deploy`**.

Example `.env.deploy`:

```bash
DEPLOY_HOST=192.168.0.2
DEPLOY_USER=casparcg
DEPLOY_PATH=/opt/highascg
DEPLOY_SSH_PASSWORD='your-ssh-password'
# Optional only if DEPLOY_REMOTE_SUDO=1
# DEPLOY_SUDO_PASSWORD='your-sudo-password'
```

The script uses **`BatchMode=no`** and SSH **ControlMaster** so your password is normally prompted in the terminal. If you set password vars, deploy can run non-interactively. Keep `.env.deploy` local/private (do not commit secrets).

**After deploy:** restart the service if needed. Run `cd "$DEPLOY_PATH" && npm ci` (or `npm install`) **only when `package.json` / `package-lock.json` changed** — the deploy no longer removes the server’s `node_modules` each time.

**`scp` / `sftp` errors (“Received message too long” / noisy shell)** — prefer the default **ssh stream** upload; fix **`~/.bashrc`** so non-interactive sessions print nothing (`case $- in *i*) ;; *) return ;; esac`). **`DEPLOY_USE_SCP=1`** does not help accounts with **`nologin`** shells.

**Paths:** install docs often use **`/opt/highascg`**. If you use a different case (e.g. **`/opt/HighAsCG`**), set **`DEPLOY_PATH`** in **`.env.deploy`** to match **`WorkingDirectory`** / **`ExecStart`** in your systemd unit.

**Permissions:** the SSH user must be able to **`rm`** and **`tar -C`** into **`DEPLOY_PATH`**, or set **`DEPLOY_REMOTE_SUDO=1`** so extract uses **`sudo`** (configure **`sudoers`** with **`NOPASSWD`** if you want non-interactive deploy).
