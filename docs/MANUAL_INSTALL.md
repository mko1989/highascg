# Manual install: `casparcg` user, `/opt/casparcg`, X11, DeckLink, NDI

This guide mirrors the intent of **`scripts/install-phase2.sh`**, **`install-phase3.sh`**, and **`install-helpers.sh`**, but every step is **manual** (no `install.sh`). Adjust paths and versions to your machine.

**Privileges:** Steps below assume a normal user with **`sudo`**. Commands that need root are prefixed with `sudo`. Alternatively, open a root shell once: `sudo -i`, then run the same commands **without** the `sudo` prefix.

---

## 1. Create user `casparcg` and own `/opt/casparcg`

### 1.1 User (service-style, matches scripts)

No interactive shell; home directory exists for nodm/X11:

```bash
USER_CASPAR=casparcg
USER_SHELL=$(command -v nologin || command -v false || echo "/usr/sbin/nologin")

sudo useradd -r -m -s "$USER_SHELL" "$USER_CASPAR"
```

If the user already exists, skip `useradd`.

### 1.2 Directory layout and ownership

```bash
sudo mkdir -p /opt/casparcg/{media,log,template,data,cef-cache,config}
sudo chown -R casparcg:casparcg /opt/casparcg
sudo chmod -R 775 /opt/casparcg
```

Deploy binaries, `config/casparcg.config`, `run.sh`, and `lib/` (CEF, etc.) into `/opt/casparcg`, then re-run `sudo chown` if root created files.

---

## 2. Groups (`video`, `audio`, `render`, …)

Only add groups that exist on your system (same list as **`install-phase3.sh`**):

```bash
for GRP in video audio render plugdev dialout input; do
  if getent group "$GRP" &>/dev/null; then
    sudo usermod -aG "$GRP" casparcg
  fi
done
```

| Group     | Typical use |
|----------|-------------|
| `video`  | `/dev/dri`, GPU |
| `render` | DRM/KMS (e.g. kmsgrab / GPU) |
| `audio`  | ALSA / Pulse / PipeWire |
| `plugdev`| Some USB devices |
| `dialout`| Serial ports |
| `input`  | Input devices |

Reboot or log out so membership applies to new sessions.

---

## 3. Openbox + nodm

Packages (see **`install-phase3.sh`**):

```bash
sudo apt update
sudo apt install -y nodm openbox unclutter xterm util-linux
```

### 3.1 nodm

```bash
sudo tee /etc/default/nodm >/dev/null <<'EOF'
NODM_ENABLED=true
NODM_USER=casparcg
NODM_X_OPTIONS='-s 0 -dpms -nolisten tcp'
EOF
```

### 3.2 Session

```bash
sudo mkdir -p /home/casparcg
echo 'exec openbox-session' | sudo tee /home/casparcg/.xsession >/dev/null
sudo chmod +x /home/casparcg/.xsession
sudo chown casparcg:casparcg /home/casparcg/.xsession
```

### 3.3 Openbox autostart

```bash
```AS ROOT

mkdir -p /home/casparcg/.config/openbox
# Create and edit autostart — see openbox_autostart.md / install-phase3.sh for a full example
chmod +x /home/casparcg/.config/openbox/autostart
chown -R casparcg:casparcg /home/casparcg/.config
```

Restart:

```bash
sudo systemctl restart nodm
```

---

## 4. DeckLink (Blackmagic Desktop Video)

Aligned with **`install-phase2.sh`** (§2.2) and **`fetch_decklink_tarball`** in **`install-helpers.sh`**.

1. Download **Desktop Video for Linux** from [Blackmagic Capture & Playback](https://www.blackmagicdesign.com/support/family/capture-and-playback) (license acceptance required). You can also set a tarball path via `HIGHASCG_DECKLINK_TAR` or place a copy at `/tmp/decklink.tar.gz` when using the automated helper.

2. Install:

```bash

cd /tmp
https://swr.cloud.blackmagicdesign.com/DesktopVideo/v16.0/Blackmagic_Desktop_Video_Linux_16.0.tar.gz?verify=1776791815-QyDaLVBq%2FvE14glhLV6tJb33C2Aw%2Fs4NEIRpOu%2BIPsE%3D
tar -xzf decklink.tar.gz   # use your actual filename
sudo dpkg -i /tmp/Blackmagic_Desktop_Video_Linux_16.0/deb/x86_64/desktopvideo_16.0a14_amd64.deb
sudo dpkg -i /tmp/Blackmagic_Desktop_Video_Linux_16.0/deb/x86_64/desktopvideo-gui_16.0a14_amd64.deb
sudo apt install -f -y
sudo modprobe blackmagic_io 2>/dev/null || true
```

3. Verify:

```bash
dpkg -l desktopvideo
command -v desktopvideo_setup   # optional GUI
```

4. Reboot if the installer or Blackmagic docs require it.

---

## 5. NDI SDK (Linux v6)

Aligned with **`install-phase2.sh`** (§2.3) and **`fetch_ndi_sdk_tarball`** in **`install-helpers.sh`**.

1. Download **NDI SDK for Linux** from NDI (account / license). The automated installer script is typically named `Install_NDI_SDK_v6_Linux.sh`.

2. Run the installer (needs root to install system-wide):

```bash
cd /tmp
wget https://downloads.ndi.tv/SDK/NDI_SDK_Linux/Install_NDI_SDK_v6_Linux.tar.gz
tar -xzf Install_NDI_SDK_v6_Linux.tar.gz    
chmod +x Install_NDI_SDK_v6_Linux.sh
sudo ./Install_NDI_SDK_v6_Linux.sh --accept-license
```

3. Install the versioned library and symlinks (layout as in **`install-phase2.sh`**):

```bash
NDI_LIB_SRC=$(find "NDI SDK for Linux/lib/x86_64-linux-gnu" -maxdepth 1 -type f -name 'libndi.so.6.*' 2>/dev/null | head -1)
if [ -n "$NDI_LIB_SRC" ] && [ -f "$NDI_LIB_SRC" ]; then
  sudo install -m 0644 "$NDI_LIB_SRC" /usr/lib/x86_64-linux-gnu/
  NDI_BASE=$(basename "$NDI_LIB_SRC")
  sudo ln -sf "$NDI_BASE" /usr/lib/x86_64-linux-gnu/libndi.so.6
  sudo ln -sf libndi.so.6 /usr/lib/x86_64-linux-gnu/libndi.so
  sudo ldconfig
fi
```

If paths differ, locate `libndi.so.6.*` inside the extracted SDK and adjust.

4. Optional (same idea as **`install-phase3.sh`**): copy next to Caspar for loaders that search the app directory:

```bash
sudo cp /usr/lib/x86_64-linux-gnu/libndi.so.6 /opt/casparcg/ 2>/dev/null || true
sudo chown casparcg:casparcg /opt/casparcg/libndi.so.6 2>/dev/null || true
```

---

## 6. CEF / dynamic libraries for Caspar

If Caspar loads bundled CEF from `/opt/casparcg/lib`:

```bash
echo /opt/casparcg/lib | sudo tee /etc/ld.so.conf.d/casparcg.conf >/dev/null
sudo ldconfig
```

Alternatively set `LD_LIBRARY_PATH=/opt/casparcg/lib` in the **environment that starts Caspar** (value must be the **directory**, not the `.so` path). That does not require `sudo` if you only change a user’s systemd unit or shell script.

---

## 7. Optional HighAsCG-related bits (from scripts)

- **USB media ingest (WO-29)**: install **`udisks2`** and **`policykit-1`**; copy **`scripts/polkit/50-highascg-udisks.rules`** to **`/etc/polkit-1/rules.d/`** so the `casparcg` user (group **`plugdev`**) can run **`udisksctl unmount` / `power-off`** without a password. The full installer does this in **`install-phase4.sh`** (section 4.3b). If a stick does not auto-mount under **`/media/…`**, check **`udev`/`udisks2`** logs and that the volume is not already mounted elsewhere.
- **Sudoers for `/etc/asound.conf`**: **optional** — only for Web UI **system-wide** ALSA default. Default installer skips this; set **`HIGHASCG_INSTALL_ASOUND_SUDOERS=1`** during install (see **`install-phase3.sh`**). Per-user **`~/.asoundrc`** needs no sudo.
- **NVIDIA X session tweaks**: only for NVIDIA GPUs — see **`install-phase2.sh`**.
- **WO-38 internal media partition → `/home/casparcg/highascg/media/drive`** (often live USB + large clips on SATA/NVMe): **`scripts/install-phase4.sh`** installs **`/usr/local/lib/highascg/media-mount.sh`** and **`/etc/sudoers.d/highascg-media-mount`** so the **`casparcg`** user can run **`sudo -n`** on that script **only**. Details and verification snippets: **`docs/HIGHASCG_PASSWORDLESS_SUDO.md`**. Operational notes: **umount fails while Caspar has files open** — stop playback, then retry. **After remounting from Settings while Caspar stays up**, **restart CasparCG** (scanner + media paths refresh). Cold HighAsCG start **waits for this mount step before connecting AMCP** (`index.js`), but **scanner / X11 autostart ordering** remains your responsibility outside Node.

---

## 8. Checklist

| Step | Done |
|------|------|
| User `casparcg` exists with home | ☐ |
| `sudo chown -R casparcg:casparcg /opt/casparcg` | ☐ |
| Groups: `video`, `audio`, `render`, `plugdev`, `dialout`, `input` | ☐ |
| `nodm` configured; `.xsession` → `openbox-session` | ☐ |
| Openbox autostart + Caspar `run.sh` or equivalent | ☐ |
| DeckLink `desktopvideo` packages installed | ☐ |
| NDI SDK + `libndi.so.6` + `ldconfig` | ☐ |
| `ldconfig` or `LD_LIBRARY_PATH` for `/opt/casparcg/lib` | ☐ |
| HighAsCG cloned to `/opt/highascg`, `npm install`, service (optional) | ☐ |
| Reboot and verify X + Caspar | ☐ |

---

## 9. HighAsCG — fetch from GitHub and install

Replace **`YOUR_REPO`** with your GitHub URL (HTTPS or SSH), for example **`https://github.com/mko1989/highascg.git`** (same default as `HIGHASCG_GIT_URL` in `scripts/install-config.sh`).

**Requirements:** Node.js **≥ 20** (see [NodeSource](https://github.com/nodesource/distributions) or `install-phase4.sh`). Ubuntu’s default `nodejs` package is often too old.

### 9.1 Clone into `/opt/highascg` and install dependencies

```bash
sudo rm -rf /opt/highascg
sudo mkdir -p /opt/highascg
sudo chown casparcg:casparcg /opt/highascg

sudo -u casparcg git clone --depth 1 https://github.com/mko1989/highascg.git /opt/highascg

cd /opt/highascg
sudo -u casparcg npm install --omit=dev
```



### 9.2 Configuration

```bash
cd /opt/highascg
if [ ! -f highascg.config.json ] && [ -f highascg.config.example.json ]; then
  sudo -u casparcg cp highascg.config.example.json highascg.config.json
fi
sudo chown -R casparcg:casparcg /opt/highascg
sudo chmod -R 775 /opt/highascg
```

Edit `highascg.config.json` (or use env vars — see root **`README.md`**) as needed.

### 9.2.1 Optional 3D Previs (`three`)

The browser-side **3D Previs** feature (PGM cell 2D/3D toggle, imported stage models, LED-style video mapping) is gated behind **`HIGHASCG_PREVIS=1`** or **`config.features.previs3d === true`** (see root `index.js` and `docs/MODULES.md`).

The **`three`** package is listed under **`optionalDependencies`** in `package.json`. A minimal install such as `npm install --omit=dev` **without** optional packages does **not** install it.

To pull optional dependencies (including **`three`**):

```bash
cd /opt/highascg
sudo -u casparcg npm run install:previs
# equivalent: npm install --include=optional
```

Enable the server-side feature flag (pick one):

**systemd `Environment=`**

```ini
Environment=HIGHASCG_PREVIS=1
```

**Or** in `highascg.config.json`:

```json
"features": {
  "previs3d": true
}
```

In the web UI (with Previs enabled), operators can: toggle the **PGM** preview cell to **3D**, import a **`.glb`** stage, tag meshes as screens, and use **Scene settings** (virtual canvas size, video texture cap, lights). The inspector **Screen mapping** section includes a **virtual-canvas region** control (drag / corner resize) to crop how PGM video maps onto a screen; that layout is stored in the browser (with the rest of previs state in `localStorage`, key `highascg.previs.state.v1`). It is optional workflow polish, not required for a minimal playout install.

### 9.3 systemd service (optional, matches `install-phase4.sh`)

```bash
sudo tee /etc/systemd/system/highascg.service >/dev/null <<'EOF'
[Unit]
Description=HighAsCG Playout Control Server
After=network.target

[Service]
Type=simple
User=casparcg
Group=casparcg
UMask=002
WorkingDirectory=/opt/highascg
ExecStart=/usr/bin/node /opt/highascg/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable highascg.service
sudo systemctl start highascg.service
```

Check: `systemctl status highascg`, then open **`http://SERVER_IP:8080/`** (or the port in your config).

### 9.3.1 npm: `go2rtc-static` download timeout

The `go2rtc-static` package runs `node dist/install.js` after install and **downloads** a go2rtc binary from GitHub (`got` request timeout **30s**). Slow links, firewalls, or GitHub blocks produce:

`TimeoutError: Timeout awaiting 'request' for 30000ms`

**Workaround A — system binary + skip scripts (typical on restricted servers)**

1. Install a compatible `go2rtc` binary on the server (e.g. [AlexxIT/go2rtc releases](https://github.com/AlexxIT/go2rtc/releases) for Linux amd64), place it at e.g. `/usr/local/bin/go2rtc`, `chmod +x`.
2. Deploy Node modules without running the post-install download:

   ```bash
   cd /opt/highascg
   npm ci --ignore-scripts
   ```

3. Point HighAsCG at that binary (either is fine):

   - Environment: `HIGHASCG_GO2RTC_BINARY=/usr/local/bin/go2rtc`  
   - Or: `GO2RTC_BIN=/usr/local/bin/go2rtc` (also respected by the `go2rtc-static` package if present)

   In **systemd**, add e.g. `Environment=HIGHASCG_GO2RTC_BINARY=/usr/local/bin/go2rtc` under `[Service]`.

**Workaround B — proxy:** if GitHub is only reachable via proxy, set `HTTPS_PROXY` / `https_proxy` during `npm install` (the download script uses `https-proxy-agent`).

**Workaround C:** run `npm ci` on a machine with reliable GitHub access, then **rsync `node_modules`** to the server (or use `npm pack` / offline mirror).

### 9.4 Full automated installer (Caspar + HighAsCG + more)

If you want the **entire** stack (Caspar debs, nodm, Tailscale, Syncthing, etc.), clone the repo to a path with the full `scripts/` tree and run:

```bash
git clone https://github.com/YOUR_ORG/highascg.git
cd highascg
sudo ./scripts/install.sh
```

That uses **`scripts/install-config.sh`** (including `HIGHASCG_GIT_URL`) and **`install-phase4.sh`** to deploy to `/opt/highascg`; for a machine that already has the repo cloned, phase 4 can sync from `SCRIPT_DIR` instead of cloning again.

### 9.5 Dev deploy from your laptop

**`scripts/dev-push.sh`** / `npm run deploy:dev` — rsync or scp to a remote host (see **`scripts/README.md`** and `.env.deploy`).

---

## Script reference (repo)

| Topic | File |
|--------|------|
| User, groups, nodm, openbox, `/opt/casparcg` | `scripts/install-phase3.sh` |
| FFmpeg base, NVIDIA, DeckLink, NDI | `scripts/install-phase2.sh` |
| Tarball fetch helpers | `scripts/install-helpers.sh` |
| Openbox autostart notes | `openbox_autostart.md` (repo root) |
