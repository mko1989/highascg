# Work order: Single NVIDIA driver per live ISO (no multi-driver pool)

## Goal

Stop baking **three** NVIDIA branches (535 / 580 / 595) into one live image. Ship **separate ISOs**, each with **one** driver series installed at clone time. Optionally help operators pick the right ISO via a **read-only GPU → branch guide** in the API.

## Strategy

| Item | Policy |
|------|--------|
| **ISO variants** | `highascg-nvidia-535`, `highascg-nvidia-580`, `highascg-nvidia-595` (basename bikeshed OK) |
| **Build host** | Set `HIGHASCG_NVIDIA_DRIVER=535\|580\|595` before `install.sh` / `eggs produce` |
| **On image** | `/etc/highascg/nvidia-iso-driver` = baked branch; **no** `/opt/nvidia-pool` |
| **First boot** | **No** `highascg-pick-nvidia.service`; **no** `nvidia-installed` gate on `highascg.service` |
| **Settings UI** | **No** driver switch / pool apply — `GET /api/system/gpu-nvidia` = status + recommendation only |
| **Wrong ISO** | Operator must re-flash or `apt` on networked rig — not in-app branch swap |

## Removed (purge)

- `tools/eggs/live-usb/nvidia-multi-driver/fetch-debs.sh` (do not restore)
- `/opt/nvidia-pool` population during `eggs:build`
- `highascg-pick-nvidia.service` + `/usr/local/sbin/highascg-pick-nvidia.sh`
- `highascg.service.d/10-wait-for-nvidia.conf`
- `nvidia-apply-from-pool.sh` + sudoers + Settings **Apply** for branch change
- `nvidia-pool-lib.sh` install from phase4

## Build workflow (operator)

```bash
# On the machine that will be cloned (install stack + target driver first)
export HIGHASCG_NVIDIA_DRIVER=595   # or 580, 535
sudo -E ./scripts/install.sh        # phase2 installs nvidia-driver-${BR}

# Before eggs produce (disables pick-nvidia, stamps iso driver)
sudo HIGHASCG_NVIDIA_DRIVER=595 npm run eggs:build
```

## Optional: GPU recommendation guide

`data/nvidia-driver-guide.json` — substring rules on `nvidia-smi` GPU name → suggested branch + notes. Exposed in `GET /api/system/gpu-nvidia` as `recommendedBranch` / `guideNote` (does **not** install anything).

## Acceptance criteria

1. Fresh `eggs:build` with `HIGHASCG_NVIDIA_DRIVER=595` does **not** create or require `/opt/nvidia-pool`.
2. Booted stick: no `highascg-pick-nvidia` in `systemctl list-dependencies multi-user.target`.
3. `highascg.service` starts without waiting on `/var/lib/highascg/nvidia-installed`.
4. `GET /api/system/gpu-nvidia` returns `isoDriver: 595` and recommendation fields.
5. `POST /api/system/gpu-nvidia/apply` returns **410** with message to use the correct ISO.

## Work log

### 2026-05-27 — Agent

**Repo:** WO + `data/nvidia-driver-guide.json`, `scripts/disable-nvidia-multi-driver-boot.sh`, `tools/eggs/live-usb/build-highascg-egg.sh`, phase2/phase4 updates, `system-hardware-nvidia.js` read-only, removed pool apply script/sudoers.

**Docs (same day):** `ISO_CONTENTS.md`, `LIVE_USB_IMAGE.md`, `HIGHASCG_PASSWORDLESS_SUDO.md`, `tools/README.md`, `39_WO` superseded note, `write-highascg-systemd-unit.sh` drops `10-wait-for-nvidia.conf`.

**Field:** Run `sudo bash scripts/disable-nvidia-multi-driver-boot.sh` on existing rigs; rebuild three ISOs (`HIGHASCG_NVIDIA_DRIVER=535|580|595`).
