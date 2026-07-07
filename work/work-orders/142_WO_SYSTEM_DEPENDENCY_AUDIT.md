# WO-142 — System dependency audit (user-paste workflow)

**Status:** Analysis done (2026-07-07) — awaiting owner actions: Zoom purge (G1), tailscale snap removal (G2); suite gaps G3/G4 handed to WO-143
**Priority:** Medium
**Date:** 2026-07-07
**Depends on:** none — can run anytime, in parallel with everything.

---

## 1. Goal

Audit every dependency installed on this playout machine against what the provisioning suite (`scripts/setup/`) actually installs, so that (a) a fresh server provisioned by the suite matches this machine, and (b) cruft is identified. Owner statement: **only Zoom is removable** (test-only); everything else is intentional.

Some commands need sudo → the agent prepares `work/SYSTEM_DEPENDENCY_AUDIT_2026-07.md` with paste-slots; the OWNER runs the commands and pastes outputs; the agent then analyzes.

## 2. Tasks

- [ ] T142.1 Create `work/SYSTEM_DEPENDENCY_AUDIT_2026-07.md` with each command below followed by an empty ```` ``` ````paste block:
  ```bash
  apt-mark showmanual
  dpkg-query -W -f='${Package}\t${Installed-Size}\n' | sort -k2 -rn | head -40
  snap list
  sudo systemctl list-unit-files --state=enabled
  sudo systemctl list-units --failed
  npm ls -g --depth=0
  pip3 list 2>/dev/null; pipx list 2>/dev/null
  flatpak list 2>/dev/null
  ls /usr/local/bin /usr/local/lib/highascg 2>/dev/null
  sudo ls /etc/sudoers.d/
  dkms status
  ```
- [ ] T142.2 OWNER: run commands, paste outputs into the file.
- [ ] T142.3 Cross-reference pasted outputs against `scripts/setup/01-*` … `16-*` installs; produce a verdict table: package → why present → keep / remove / add-to-setup-suite.
- [ ] T142.4 Provide exact removal commands for Zoom (snap vs apt determined from paste); OWNER executes.
- [ ] T142.5 Anything present but NOT installed by `scripts/setup/` → file follow-up items: add to the provisioning suite (coordinate with WO-143's `scripts/README.md`) or document as machine-local.

## 3. Acceptance criteria

- [ ] A142.1 `work/SYSTEM_DEPENDENCY_AUDIT_2026-07.md` contains all pasted outputs + a complete verdict table.
- [ ] A142.2 Zoom removed (confirmation output pasted).
- [ ] A142.3 Every provisioning gap is either a `scripts/setup/` addition (committed) or a documented machine-local note.

## 4. Work log

- 2026-07-07 — WO created.
- 2026-07-07 — T142.1 done (template with paste slots); owner ran all 11 commands same day (T142.2).
- 2026-07-07 — T142.3 analysis complete in `work/SYSTEM_DEPENDENCY_AUDIT_2026-07.md`: verdict table grouped by concern; every package traced to its setup step except gaps G1–G6. Notable findings: **zoom is the largest package on the box (942 MB)** — apt purge command provided (T142.4, owner to run); **tailscale installed twice** (apt daemon active + orphan snap); 3 platform snaps likely orphaned; nginx installer not in the numbered setup flow (G3 → WO-143); gh/tmux/mc/magic-wormhole/v4l2loopback-utils unprovisioned (G4 → WO-143); v4l2loopback module verified to ship inside the pinned `linux-modules` package (no dkms gap); `apt-daily-upgrade.timer` failed state confirmed intentional/benign.
- 2026-07-07 — T142.5: G3+G4 handed to WO-143 (setup-suite additions); G5/G6 owner decisions documented in the audit file.
