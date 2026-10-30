# Deprecated scripts

**Use [../setup/README.md](../setup/README.md) instead** for host rebuilds.

Files here remain for reference and one-off recovery; do not use on new Blackwell hosts unless you know why.

## What is left (WO-831, 30.10)

Everything with no live caller was deleted (git history keeps it). Two things remain because something live still uses them:

| Path | Why it stays |
|------|--------------|
| `legacy/` (`install.sh`, `install-phase1..5.sh`) | `scripts/install.sh` forwards to `legacy/install.sh`; `tools/eggs/live-usb/EXFAT_DATA_ZERO_TOUCH.md` and `setup/README.md` still tell the operator to run it |
| `nvidia/install-nvidia-gsp-rpc-workaround.sh` | called by `scripts/fix/fix-host-boot-display-hang.sh` (NVIDIA 595 branch) |

For host rebuilds use [../setup/README.md](../setup/README.md): `setup/01-kernel-117.sh` + `02-verify-kernel-117.sh`, `setup/03-nvidia-open-595.sh` (the only correct Blackwell driver path), `setup/` steps 01-11.
