# HighAsCG passwordless sudo (`NOPASSWD`)

HighAsCG’s Node service often runs as **`casparcg`** (see installer). Several features call **`sudo -n`** so the Web UI works **without an interactive TTY password**.

This page lists **exact commands** that should be mirrored in **`/etc/sudoers.d/`** (or one consolidated file). After edits, run **`sudo visudo -c`** or **`visudo -cf /etc/sudoers.d/…`** to validate syntax.

Always prefer **one fixed path per action** (wrapper script with **no user-controlled arguments**) over broad rules like `NOPASSWD: ALL`.

---

## Installed by HighAsCG installer (reference)

| Fragment / rule | User | Command | Feature |
|-----------------|------|---------|---------|
| **`/etc/sudoers.d/highascg-media-mount`** | `casparcg` | `/usr/local/lib/highascg/media-mount.sh` | WO-38: mount internal/partition → `/home/casparcg/highascg/media` (`src/system/media-partition-mount.js`) |
| **`/etc/sudoers.d/highascg-nvidia-apply-from-pool`** | `casparcg` | `/usr/local/lib/highascg/nvidia-apply-from-pool.sh` | WO-39: NVIDIA driver apply from offline pool (**reads** `/run/highascg/nvidia-apply.req` then deletes it — no argv) |

Source templates in the repo:

- `scripts/sudoers.d/highascg-media-mount`
- `scripts/sudoers.d/highascg-nvidia-apply-from-pool`
- `scripts/install-phase4.sh` (installs helpers + sudoers fragments)

**WO-38 operations:** If you remount **`/home/casparcg/highascg/media`** while CasparCG is up, **restart Caspar** afterward; **umount** needs open files closed (see **`work/docs/MANUAL_INSTALL.md`** §7, **`work/docs/LIVE_USB_IMAGE.md`** §7.2).


### Optional ALSA — **`highascg-asound`** (off by default)

**You usually do not need this on a PortAudio-first / device-name reference system.** Caspar’s PortAudio consumer uses **device indices or names** from the server; HighAsCG already supports a **per-user ALSA default** via **`~/.asoundrc`** with **no sudo** (`scope: user` on `POST /api/audio/default-device` — see `src/audio/audio-devices.js`).

**`/etc/sudoers.d/highascg-asound`** (NOPASSWD **`tee` → `/etc/asound.conf`**) is only for **`scope: system`**, i.e. forcing a **global** default ALSA PCM for **non-Caspar** “system audio”. Install it only if you really use that path:

```bash
HIGHASCG_INSTALL_ASOUND_SUDOERS=1 sudo -E ./scripts/install.sh
```

Otherwise leave it **unset** (default **`0`**) to keep the eggs image minimal. The fragment is emitted by **`install-phase3.sh`** only when that variable is **`1`**.

---

## Used by Node but not always installed automatically

These appear in **`sudo -n`** call sites. If the Nuclear / setup actions fail with a password prompt error, add matching **`NOPASSWD`** lines for **`casparcg`** (or whichever user runs `node`):

| Binary (typical path) | Arguments | Source |
|----------------------|-----------|--------|
| **`/bin/systemctl`** | `restart nodm` | `src/api/routes-system-setup.js`, `src/utils/os-config.js` |
| **`/usr/bin/systemctl`** | `restart nodm` | Same (path varies by distro) |
| **`/sbin/reboot`** | *(none)* | `src/api/routes-system-setup.js` |
| **`/usr/sbin/reboot`** | *(none)* | Same |
| **`/bin/systemctl`** | `reboot` | Same |
| **`/usr/bin/systemctl`** | `reboot` | Same |
| **`/usr/bin/eggs`** | `calamares` | `src/api/routes-system-setup.js` (DISPLAY often `:0`) |

**Not `sudo -n` today (interactive sudo):**

- **`os-config.js`** — persisting X11 layout writes **`/etc/highascg/apply-layout.sh`** and **`/etc/X11/Xsession.d/99highascg-layout`** via **`sudo tee`** without `-n`. Operators need a password session or future passwordless rules / a small wrapper (out of scope unless you add WO-39 helpers).

---

## Settings → **system** / **decklink** (WO-39)

- **NVIDIA pool apply:** **`POST /api/system/gpu-nvidia/apply`** writes **`/run/highascg/nvidia-apply.req`** then runs **`sudo -n /usr/local/lib/highascg/nvidia-apply-from-pool.sh`**. The script allow-lists branches **535**, **580**, **595** and uses **`/opt/nvidia-pool`** (or **`NVIDIA_DEB_POOL`**) as **`Dir::Cache::Archives`** for apt. Optional **nuclear password** is enforced in-process (same as reboot) — not via sudoers.
- **GUI launch:** **`POST /api/system/gui-launch`** spawns allow-listed apps on **`:0`** with **`XAUTHORITY`** from **`getXAuthority()`** — **no sudo** when binaries are executable for the service user.

---

## Operational commands that stay password-protected (examples)

These are **supposed** to stay interactive or polkit-gated:

- **`sudo tailscale up`** (login / auth URL)
- **`sudo apt upgrade`** (general system changes)
- **`sudo eggs produce`** (image build — run on a build host, not from the playout Web UI)

---

## Verification snippets

```bash
# Service user
id casparcg

# Non-interactive check (should succeed when rules exist)
sudo -n -u casparcg /usr/bin/true

# Media helper (will fail with “Missing request file” if no request — that still proves sudo is allowed)
sudo -n -u casparcg /usr/local/lib/highascg/media-mount.sh

# Nvidia apply helper (expects missing req file unless you staged one — proves NOPASSWD)
sudo -n -u casparcg /usr/local/lib/highascg/nvidia-apply-from-pool.sh || true
```

---

## See also

- `tools/live-usb/build-flash-and-persist.sh` — build + flash USB (run as **root**, not via Web UI)
- `scripts/README.md` — install overview
- `docs/SUDO_UBUNTU_SETUP.md` — historical / audio-related sudo notes if present in tree
