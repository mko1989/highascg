# System Dependency Audit — 2026-07 (WO-142)

Goal: reconcile everything installed on this playout machine against what `scripts/setup/` installs,
so a fresh server provisioned by the suite matches this box. Owner statement: **only Zoom is removable**
(test-only); everything else is intentional.

**How to use:** run each command below (some need sudo) and paste its output into the empty code block
under it. Then hand the file back — the analysis section at the bottom gets filled in from the pastes.

---

## 1. Manually installed apt packages

```bash
apt-mark showmanual
```

```
(paste output here)
```

## 2. Largest installed packages (top 40)

```bash
dpkg-query -W -f='${Package}\t${Installed-Size}\n' | sort -k2 -rn | head -40
```

```
(paste output here)
```

## 3. Snaps

```bash
snap list
```

```
(paste output here)
```

## 4. Enabled services

```bash
sudo systemctl list-unit-files --state=enabled
```

```
(paste output here)
```

## 5. Failed units

```bash
sudo systemctl list-units --failed
```

```
(paste output here)
```

## 6. Global npm packages

```bash
npm ls -g --depth=0
```

```
(paste output here)
```

## 7. Python packages

```bash
pip3 list 2>/dev/null; pipx list 2>/dev/null
```

```
(paste output here)
```

## 8. Flatpaks

```bash
flatpak list 2>/dev/null
```

```
(paste output here)
```

## 9. What installers dropped into /usr/local

```bash
ls /usr/local/bin /usr/local/lib/highascg 2>/dev/null
```

```
(paste output here)
```

## 10. Passwordless-sudo entries

```bash
sudo ls /etc/sudoers.d/
```

```
(paste output here)
```

## 11. DKMS modules (decklink / v4l2loopback / nvidia)

```bash
dkms status
```

```
(paste output here)
```

---

## Analysis (filled in after paste)

### Verdict table

| Package / unit | Why it's here | Installed by setup suite? | Verdict |
|---|---|---|---|
| _(pending paste)_ | | | |

### Zoom removal

Exact command depends on how it was installed (visible from sections 1/3):
- snap: `sudo snap remove zoom-client`
- apt/deb: `sudo apt purge zoom && sudo apt autoremove`

```
(paste removal confirmation here)
```

### Gaps to feed back into scripts/setup/

_(pending analysis — anything present on the box but not installed by any `scripts/setup/` step gets
either a new/extended setup script or a "machine-local, do not provision" note here.)_
