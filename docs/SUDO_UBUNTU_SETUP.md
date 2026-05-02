# HighAsCG sudo (no-password) setup on Ubuntu

This guide configures **only the minimum commands** that HighAsCG may run as root without a password when the app runs as `casparcg:casparcg`.

Use this for the web UI "Nuclear" actions:

- restart window manager (`nodm`)
- reboot host

## 1) Verify service user

```bash
ps -o user= -p "$(pgrep -f highascg | head -n1)"
```

Expected user: `casparcg`

## 2) Create a dedicated sudoers file

Use `visudo` (never edit sudoers with a regular editor):

```bash
sudo visudo -f /etc/sudoers.d/highascg
```

Add:

```sudoers
# HighAsCG privileged actions (strict allowlist)
casparcg ALL=(root) NOPASSWD: /bin/systemctl restart nodm, /usr/bin/systemctl restart nodm, /sbin/reboot, /usr/sbin/reboot, /bin/systemctl reboot, /usr/bin/systemctl reboot
```

Save and exit.

## 3) Set correct permissions

```bash
sudo chown root:root /etc/sudoers.d/highascg
sudo chmod 0440 /etc/sudoers.d/highascg
```

## 4) Test as `casparcg`

```bash
sudo -u casparcg sudo -n /bin/systemctl restart nodm
sudo -u casparcg sudo -n /sbin/reboot
```

Notes:

- `-n` means non-interactive (fail immediately instead of prompting for password).
- Reboot command will reboot immediately if permission is correct.

## 5) HighAsCG behavior

HighAsCG calls sudo non-interactively (`sudo -n`).  
If sudoers is missing or too strict, API calls fail with permission errors.

## Security recommendations

- Keep this list **narrow** (only exact command paths).
- Do **not** allow broad patterns like `systemctl *`.
- Keep the file in `/etc/sudoers.d/` with mode `0440`.
- Review this file after OS updates (binary paths can differ by distro).

