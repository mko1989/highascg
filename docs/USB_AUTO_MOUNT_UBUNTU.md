# Ubuntu: auto-mount USB drives for the `casparcg` user (HighAsCG import)

This walkthrough is for a **playout** machine where:

- Linux user **`casparcg`** owns **`/home/casparcg/highascg`**, runs **CasparCG** (and usually X / displays), and runs the **HighAsCG** `systemd` service.
- You plug in a **USB stick** and want it **mounted without manual `sudo`**, at a path the **HighAsCG** process (running as `casparcg`) can read, so the web UI can **browse** the volume and **import** files into **`/home/casparcg/highascg/media/`**.

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

---

## 2. Polkit: allow `casparcg` to mount / unmount / power-off without a password

The repo ships a rule for **`plugdev`** users who have an **“active”** polkit session (typical of desktop logins). On a **headless** or service-only box, `subject.active` is often **false** when you `ssh` in or when only `systemd` user sessions run. Then you also need the **headless** rule.

1. **Base rule (desktop-friendly)** — from the repo:

   ```text
   scripts/polkit/50-highascg-udisks.rules
   ```

   Install:

   ```bash
   sudo cp /home/casparcg/highascg/scripts/polkit/50-highascg-udisks.rules /etc/polkit-1/rules.d/
   sudo chmod 644 /etc/polkit-1/rules.d/50-highascg-udisks.rules
   ```

2. **Headless / dedicated `casparcg` rule (recommended on servers)** — does **not** require `subject.active` but only allows the service user (default **`casparcg`**) in **`plugdev`**:

   ```text
   scripts/polkit/51-highascg-udisks-casparcg-headless.rules
   ```

   The production **Phase 4** install copies this file, substitutes **`USER_CASPAR`**, and restarts polkit. For a **manual** install, copy the file and ensure `subject.user == 'casparcg'` matches the user that runs HighAsCG, then set mode `644`.

3. Reload polkit (or reboot):

   ```bash
   sudo systemctl restart polkit
   ```

---

## 3. Systemd “linger” (often fixes empty mount list on first plug)

For **user** `casparcg`, allow user services and a stable session:

```bash
sudo loginctl enable-linger casparcg
```

---

## 4. What path will the stick use?

On current Ubuntu, udisks usually mounts removable volumes under:

- `/media/casparcg/<LABEL-or-uuid>/`
- `/run/media/casparcg/<LABEL-or-uuid>/`

---

## 5. Verify as `casparcg` (before using the web UI)

List block devices and mounts:

```bash
sudo -u casparcg -- lsblk -J -o NAME,LABEL,SIZE,TYPE,MOUNTPOINT,FSTYPE,RM,TRAN
```

If the stick is inserted but **MOUNTPOINT** is empty, try mounting the partition manually:

```bash
sudo -u casparcg -- udisksctl mount -b /dev/sdX1
```

---

## 6. HighAsCG: import destination

- Default Caspar **media** tree is **`/home/casparcg/highascg/media`**.
- Files land under **`/home/casparcg/highascg/media/`** (or a subfolder per your `usbIngest` settings).

If imports fail with permission errors, fix ownership of the media folder:

```bash
sudo chown -R casparcg:casparcg /home/casparcg/highascg/media
sudo chmod -R 775 /home/casparcg/highascg/media
```

---

## 7. Quick checklist

| Step | Action |
|------|--------|
| 1 | `apt install udisks2 policykit-1` |
| 2 | `usermod -aG plugdev casparcg` |
| 3 | Install polkit rules from `scripts/polkit/` |
| 4 | `loginctl enable-linger casparcg` |
| 5 | Test: `sudo -u casparcg udisksctl mount -b /dev/sdX1` |
| 6 | Open HighAsCG **Import from USB** and refresh drives |
