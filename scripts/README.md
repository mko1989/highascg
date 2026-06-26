# Production scripts

## Recommended: step-by-step setup

For clean host rebuilds (kernel → verify → NVIDIA → NDI → Caspar deps → DeckLink manual → Node):

```bash
cd ~/highascg
sudo bash scripts/setup/01-kernel-117.sh   # see scripts/setup/README.md
```

Full order: **[setup/README.md](setup/README.md)**. **Manual install guide:** **[setup/MANUAL_INSTALL.md](setup/MANUAL_INSTALL.md)**.

---

## Layout

| Folder | Purpose |
|--------|---------|
| **[setup/](setup/)** | Canonical numbered host install (`01`–`11`) |
| **[lib/](lib/)** | Shared `install-config.sh`, `install-helpers.sh`, `apt-block-service-starts.sh`, `archive-common.sh` |
| **[exfat/](exfat/)** | WO-47/WO-52 mounts, bridge/USB boot scripts, `write-highascg-systemd-unit.sh` |
| **[boot/](boot/)** | Host GRUB branding, `nvidia-persistenced` boot order |
| **[nvidia/](nvidia/)** | Active eggs helper: `disable-nvidia-multi-driver-boot.sh` |
| **[deploy/](deploy/)** | `dev-push.sh` (`npm run deploy:dev`) |
| **[eggs/](eggs/)** | Build-host cleanup (`clean-eggs-dev-host.sh`) |
| **[fix/](fix/)** | Emergency boot / exfat ordering recovery |
| **[legacy/](legacy/)** | Old monolith `install.sh` + `install-phase1`–`5` (still works via root stub) |
| **[deprecated/](deprecated/)** | Superseded NVIDIA/kernel scripts — see [deprecated/README.md](deprecated/README.md) |
| **[unused/](unused/)** | Orphans kept for reference (not called by current flows) |
| **[polkit/](polkit/)** | udisks rules installed by legacy phase 4 |

**Root stubs:** `scripts/install-exfat-systemd-units.sh`, `dev-push.sh`, `apply-bridge-label-highascgdat.sh`, etc. forward to the folders above so older docs and muscle memory still work.

---

## Common entry points

| Goal | Command |
|------|---------|
| Host setup | `scripts/setup/01-kernel-117.sh` … `11-boot-branding.sh` |
| NVIDIA Blackwell | `scripts/setup/03-nvidia-open-595.sh` |
| WO-47/52 systemd | `sudo bash scripts/install-exfat-systemd-units.sh casparcg` |
| Bridge disk label | `sudo bash scripts/apply-bridge-label-highascgdat.sh casparcg` |
| Host boot branding | `sudo bash scripts/setup/11-boot-branding.sh` |
| Dev deploy | `npm run deploy:dev` → `scripts/deploy/dev-push.sh` |
| Boot emergency | `sudo bash scripts/fix/fix-boot-emergency-recovery.sh` |

Eggs produce, stick flash, and ISO tooling: **[tools/eggs/](tools/eggs/)** and **[tools/README.md](../tools/README.md)**.

---

## Legacy monolith (still works)

```bash
sudo ./scripts/install.sh
```

Forwards to **[legacy/install.sh](legacy/install.sh)** with a note to prefer `setup/`. Phase 2 now calls **`setup/03-nvidia-open-595.sh`** for NVIDIA.

Openbox autostart reference: [**work/openbox_autostart.md**](../work/openbox_autostart.md).

**X11 input (post-install on minimal Ubuntu):** Phase 3 / setup installs **`xserver-xorg-input-all`**, **`xserver-xorg-input-libinput`**, and **`avahi-daemon`**. See main [README.md](../README.md).

**USB import on Ubuntu** — [**docs/USB_AUTO_MOUNT_UBUNTU.md**](../docs/USB_AUTO_MOUNT_UBUNTU.md). Polkit rules: `scripts/polkit/`.

---

## Dev deploy

[deploy/dev-push.sh](deploy/dev-push.sh) — **`tar`** → **`ssh`** → extract into **`DEPLOY_PATH`** (includes **`dist-web/`** when present). See [`from_client/AGENT_SERVER_CLIENT_MERGE.md`](../from_client/AGENT_SERVER_CLIENT_MERGE.md).

```bash
npm run deploy:dev
```

See comments in `dev-push.sh` for `.env.deploy`, `DEPLOY_REMOTE_SUDO`, etc.
