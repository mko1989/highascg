# Ubuntu: auto-mount USB drives for the `casparcg` user (HighAsCG import)

This walkthrough is for a **playout** machine where:

- Linux user **`casparcg`** owns **`/opt/casparcg`** and **`/opt/highascg`**, runs **CasparCG** (and usually X / displays), and runs the **HighAsCG** `systemd` service.
- You plug in a **USB stick** and want it **mounted without manual `sudo`**, at a path the **HighAsCG** process (running as `casparcg`) can read, so the web UI can **browse** the volume and **import** files into **`/opt/casparcg/media/`**.

The HighAsCG app does **not** implement its own block-device driver. It lists volumes via **`lsblk`** (and related logic in `src/media/usb-drives.js`) and only sees devices that already have a **`MOUNTPOINT`**. So the OS must **mount** the stick (almost always via **udisks2** on Ubuntu).

---

## 1. Install packages and groups (once)

On Ubuntu:

```bash
sudo apt update
sudo apt install -y udisks2 policykit-1
```

Ensure **`casparcg`** is in **`plugdev`** (the production installer does this in `scripts/install-phase4.sh`):

```bash
sudo usermod -aG plugdev casparcg
```

Log out and back in **or** start a new session so group membership applies to running services. After changing groups, **restart** the HighAsCG service so the worker picks up the new supplementary groups if it was already running:

```bash
sudo systemctl restart highascg
```

(Exact unit name may differ; check `systemctl list-units '*highascg*'`.)

---

## 2. Polkit: allow `casparcg` to mount / unmount / power-off without a password

The repo ships a rule for **`plugdev`** users who have an **“active”** polkit session (typical of desktop logins). On a **headless** or service-only box, `subject.active` is often **false** when you `ssh` in or when only `systemd` user sessions run. Then you also need the **headless** rule.

1. **Base rule (desktop-friendly)** — from the repo:

   ```text
   scripts/polkit/50-highascg-udisks.rules
   ```

   Install:

   ```bash
   sudo cp /opt/highascg/scripts/polkit/50-highascg-udisks.rules /etc/polkit-1/rules.d/
   sudo chmod 644 /etc/polkit-1/rules.d/50-highascg-udisks.rules
   ```

2. **Headless / dedicated `casparcg` rule (recommended on servers)** — does **not** require `subject.active` but only allows the service user (default **`casparcg`**) in **`plugdev`**:

   ```text
   scripts/polkit/51-highascg-udisks-casparcg-headless.rules
   ```

   The production **Phase 4** install copies this file, substitutes **`USER_CASPAR`** (from [install-config.sh](../scripts/install-config.sh)), and restarts polkit. For a **manual** install, copy the file and ensure `subject.user == 'casparcg'` (or your service account name) matches the user that runs HighAsCG, then set mode `644`.

3. Reload polkit (or reboot):

   ```bash
   sudo systemctl restart polkit
   # or: sudo systemctl try-restart polkit.service
   ```

---

## 3. Systemd “linger” (often fixes empty mount list on first plug)

For **user** `casparcg`, allow user `@` services and a stable session so udev/udisks can attach mounts to that user (especially if nobody logs in on the console):

```bash
sudo loginctl enable-linger casparcg
```

Reboot once after this if udisks still does not list mounts for that user.

---

## 4. What path will the stick use?

On current Ubuntu, udisks usually mounts removable volumes under one of:

- `/media/casparcg/<LABEL-or-uuid>/`
- `/run/media/casparcg/<LABEL-or-uuid>/`

HighAsCG’s USB module only allows paths under those prefixes (see `isAllowedMountpoint` in `src/media/usb-drives.js`). If your distro uses only `/run/media/...`, that is already accepted.

---

## 5. Verify as `casparcg` (before using the web UI)

List block devices and mounts:

```bash
sudo -u casparcg -- lsblk -J -o NAME,LABEL,SIZE,TYPE,MOUNTPOINT,FSTYPE,RM,TRAN
```

If the stick is inserted but **MOUNTPOINT** is empty, try mounting the partition manually **as the same user** the service uses:

```bash
sudo -u casparcg -- udisksctl mount -b /dev/sdX1
```

Replace `/dev/sdX1` with the correct partition. If that succeeds, polkit and permissions are in good shape; auto-mount on hotplug may still depend on the next section.

Eject / power when done (optional):

```bash
sudo -u casparcg -- udisksctl unmount -b /dev/sdX1
sudo -u casparcg -- udisksctl power-off -b /dev/sdX
```

---

## 6. If the stick still does not auto-mount on insert

1. **Confirm udisks is running:** `systemctl status udisks2` (or `udisksd` depending on the release).
2. **Kernel / uaccess:** most consumer USB storage gets a `TAGS` including `uaccess` so udisks is allowed to mount. Exotic or broken devices may need a different port or a manual mount once to test.
3. **Keep using manual mount** for debugging: as long as **`casparcg`** runs `udisksctl mount` (or the desktop auto-mounts to `/run/media/casparcg/...`), HighAsCG will list the path after **refresh** in the UI.
4. **Do not** point Caspar or HighAsCG at raw `/dev/sd* paths** — the app is built around **directory** paths on a **mounted** filesystem.

---

## 7. HighAsCG: import destination

- Default Caspar **media** tree is **`/opt/casparcg/media`**. The installer chowns that tree to **`casparcg`**.
- In the web app: **Settings → Media (USB)** — enable import if needed; the copy target comes from the configured media path (same as Caspar’s media folder for imports).
- **Sources → + → Import from USB…** — browse the mounted volume, select files, import. Files land under **`/opt/casparcg/media/`** (or a subfolder per your `usbIngest` settings).

If imports fail with permission errors, fix ownership of **`/opt/casparcg/media`**, not the USB (USB is only read for copy):

```bash
sudo chown -R casparcg:casparcg /opt/casparcg/media
sudo chmod -R 775 /opt/casparcg/media
```

---

## 8. Quick checklist

| Step | Action |
|------|--------|
| 1 | `apt install udisks2 policykit-1` |
| 2 | `usermod -aG plugdev casparcg` + restart service / re-login |
| 3 | Install polkit rules **50** and, on headless, **51** from `scripts/polkit/` |
| 4 | `loginctl enable-linger casparcg` (recommended) |
| 5 | Test: `sudo -u casparcg udisksctl mount -b /dev/sdX1` and check `MOUNTPOINT` in `lsblk` |
| 6 | Open HighAsCG **Import from USB** and refresh drives |

---

## 9. Related files in this repository

| File | Role |
|------|------|
| `scripts/polkit/50-highascg-udisks.rules` | Base udisks2 allow for `plugdev` (active session) |
| `scripts/polkit/51-highascg-udisks-casparcg-headless.rules` | Headless: service user + `plugdev`, no `active` requirement |
| `scripts/install-phase4.sh` | Installs packages, `plugdev`, copies **50** and **51**, `USER_CASPAR` rewrite, `polkit` restart |
| `src/media/usb-drives.js` | Detection, path sandbox, copy to media folder |
| `config/default.js` `usbIngest` | App-side toggles (not the same as OS auto-mount) |

*Last updated: 2026-04-22 (aligned with `USER_CASPAR="casparcg"` in `scripts/install-config.sh`.)*
