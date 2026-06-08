# Deprecated scripts

**Use [../setup/README.md](../setup/README.md) instead** for host rebuilds.

Files here remain for reference and one-off recovery; do not use on new Blackwell hosts unless you know why.

## Replacement map

| Deprecated | Use instead |
|------------|-------------|
| `pin-kernel-6.8.0-117.sh` | `setup/01-kernel-117.sh` + `setup/02-verify-kernel-117.sh` |
| `nvidia/install-nvidia-cuda-repo-595.sh` (closed) | `setup/03-nvidia-open-595.sh` |
| `nvidia/install-nvidia-cuda-repo-open-595.sh` | `setup/03-nvidia-open-595.sh` |
| `nvidia/install-nvidia-595.sh` | `setup/03-nvidia-open-595.sh` |
| `nvidia/install-nvidia-driver-595-blackwell.sh` | `setup/03-nvidia-open-595.sh` |
| `nvidia/install-nvidia-proprietary-595.sh` | `setup/03-nvidia-open-595.sh` |
| `nvidia/restore-gpu-working.sh` | `setup/03-nvidia-open-595.sh` |
| `nvidia/restore-nvidia-595-closed-userspace.sh` | `setup/03-nvidia-open-595.sh` |
| `nvidia/fix-nvidia-dkms-prebuilt-conflict.sh` | not needed with open `nvidia-open` |
| `restore-production-host.sh` | `setup/` steps 01–11 |
| `../legacy/install.sh` phases 1–5 | `setup/` steps 01–11 |

## Active infrastructure (moved out of deprecated)

| Path | Role |
|------|------|
| `../lib/install-config.sh`, `install-helpers.sh` | URLs, CEF, Caspar helpers |
| `../lib/apt-block-service-starts.sh` | apt policy-rc.d during installs |
| `../exfat/*` | WO-47/WO-52 runtime + unit installer |
| `../boot/install-host-boot-branding.sh` | Host GRUB / throbber |
| `../nvidia/disable-nvidia-multi-driver-boot.sh` | Eggs produce preflight (root stub) |
| `../deploy/dev-push.sh` | Dev tarball deploy |

## NVIDIA graveyard (`nvidia/`)

Do not run on new recovery — only **open 595 via `setup/03-nvidia-open-595.sh`** is correct for RTX PRO 4000 Blackwell:

- `install-nvidia-cuda-repo-595.sh`
- `install-nvidia-cuda-repo-open-595.sh`
- `install-nvidia-595.sh`
- `install-nvidia-driver-595-blackwell.sh`
- `install-nvidia-proprietary-595.sh`
- `install-nvidia-gsp-rpc-workaround.sh`
- `fix-nvidia-firmware-dpkg-conflict.sh`
- `fix-nvidia-dkms-prebuilt-conflict.sh`
- `restore-gpu-working.sh`
- `restore-nvidia-595-closed-userspace.sh`
