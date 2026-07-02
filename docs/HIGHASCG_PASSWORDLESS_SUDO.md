# HighAsCG passwordless sudo (`NOPASSWD`)

HighAsCG’s Node service often runs as **`casparcg`** (see installer). Several features call **`sudo -n`** so the Web UI works **without an interactive TTY password**.

This page lists **exact commands** that should be mirrored in **`/etc/sudoers.d/`** (or one consolidated file). After edits, run **`sudo visudo -c`** or **`visudo -cf /etc/sudoers.d/…`** to validate syntax.

Always prefer **one fixed path per action** (wrapper script with **no user-controlled arguments**) over broad rules like `NOPASSWD: ALL`.

---

## Installed by HighAsCG installer (reference)

| Fragment / rule | User | Command | Feature |
|-----------------|------|---------|---------|
Source templates in the repo:

- `scripts/install-phase4.sh` (installs helpers + sudoers fragments)

**Removed (2026-05):** WO-38 **`highascg-media-mount`** / **`media/drive`** partition mount — durable config/state/media use **exFAT only** (`HIGHASCGEXF`, WO-47). See **`work/work-orders/WO_remove-persistence-partition-workflow_exfat-only.md`**.

**Removed (2026-05):** Multi-branch **`/opt/nvidia-pool`** and **`nvidia-apply-from-pool`** — one NVIDIA driver per live ISO (`HIGHASCG_NVIDIA_DRIVER=535|580|595`). See **`work/work-orders/WO_single-nvidia-driver-per-iso.md`**.


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
| **`/usr/local/lib/highascg/highascg-webui-server-update.sh`** | `--source <extract-dir>` | Web UI server update (WO-66) |
| **`/usr/bin/eggs`** | `calamares` | `src/api/routes-system-setup.js` (DISPLAY often `:0`) |
| **`/usr/local/lib/highascg/highascg-network-apply.sh`** | fixed `dhcp` / `static` + allow-listed iface args | WO-59 **Apply network** (`POST /api/system/network/apply`) |
| **`/usr/local/lib/highascg/highascg-network-reset.sh`** | optional `[iface]` | **Reset network** (`POST /api/system/network/reset`) — DHCP renew / reconnect |
| **`/usr/local/lib/highascg/highascg-tailscale-up.sh`** | *(none — reads `config/tailscale.json`)* | WO-91 / WO-97 pinned Tailscale bring-up |
| **`/usr/bin/tailscale`** | `logout` | `src/network/tailscale-service.js` |
| **`/snap/bin/tailscale`** | `logout` | Same |

**Removed (WO-97, 2026-07-02):** `tailscale up` and `tailscale up *` NOPASSWD wildcards — use **`highascg-tailscale-up.sh`** only. **`eggs calamares --install *`** removed (build-host root task only).

**WO-66 Web UI server update** (install helper via `install-exfat-systemd-units.sh`, then sudoers):

```bash
echo 'casparcg ALL=(root) NOPASSWD: /usr/local/lib/highascg/highascg-webui-server-update.sh' | sudo tee /etc/sudoers.d/highascg-webui-server-update
sudo visudo -cf /etc/sudoers.d/highascg-webui-server-update
```

**WO-59 network helpers** (install manually until wired in `install-phase4.sh`):

```bash
sudo bash scripts/runtime/install-network-apply.sh casparcg
```

Installs **`highascg-network-apply.sh`** and **`highascg-network-reset.sh`** with matching sudoers.

**Optional power button** (short press = network reset, hold 3s = shutdown):

```bash
sudo bash scripts/setup/14-power-button-network-reset.sh
```

Uses **`evtest`** + **`logind` `HandlePowerKey=ignore`**. Only enable on kiosk/playout boxes where accidental shutdown is acceptable.

Uses **NetworkManager (`nmcli`)** on the live image (NM active; netplan files present but NM owns connections).

**Not `sudo -n` today (interactive sudo):**

- **`os-config.js`** — persisting X11 layout writes **`/etc/highascg/apply-layout.sh`** and **`/etc/X11/Xsession.d/99highascg-layout`** via **`sudo tee`** without `-n`. Operators need a password session or future passwordless rules / a small wrapper (out of scope unless you add WO-39 helpers).

---

## Settings → **system** / **decklink** / **Tailscale** (WO-39 / WO-91)

- **NVIDIA:** read-only **`GET /api/system/gpu-nvidia`** (ISO branch stamp + GPU guide). Driver switching via Settings was removed — use the correct single-driver ISO. **Screen consumer vsync:** NVIDIA **Sync to VBlank off** + Caspar **vsync on** — [reference/screen-consumer-vsync-nvidia.md](reference/screen-consumer-vsync-nvidia.md).
- **GUI launch:** **`POST /api/system/gui-launch`** spawns allow-listed apps on **`:0`** with **`XAUTHORITY`** from **`getXAuthority()`** — **no sudo** when binaries are executable for the service user.
- **Tailscale (WO-91):** **`GET /api/network/tailscale/status`**, **`POST /api/network/tailscale/login`**, **`POST /api/network/tailscale/enable`**, etc. — see [reference/tailscale-integration.md](reference/tailscale-integration.md). Requires passwordless **`sudo tailscale up`**, **`sudo tailscale logout`**, and **`systemctl … tailscaled`** / **`snap.tailscale.tailscaled`**.

---

## Operational commands that stay password-protected (examples)

These are **supposed** to stay interactive or polkit-gated:

- **`sudo apt upgrade`** (general system changes)
- **`sudo eggs produce`** (image build — run on a build host, not from the playout Web UI)

---

## Verification snippets

```bash
# Service user
id casparcg

# Non-interactive check (should succeed when rules exist)
sudo -n -u casparcg /usr/bin/true
```

---

## See also

- `tools/eggs/live-usb/build-flash-and-persist.sh` — build + flash USB (run as **root**, not via Web UI)
- `scripts/README.md` — install overview
- [reference/SUDO_UBUNTU_SETUP.md](reference/SUDO_UBUNTU_SETUP.md) — historical / audio-related sudo notes
