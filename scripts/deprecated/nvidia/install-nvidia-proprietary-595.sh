#!/usr/bin/env bash
# DEPRECATED — use scripts/setup/03-nvidia-open-595.sh
# Install proprietary closed NVIDIA 595 via the official CUDA repository.
#
# NVIDIA docs require cuda-keyring before `apt install cuda-drivers`.
# Ubuntu-only nvidia-driver-595 does not provide cuda-drivers.
#
#   sudo bash scripts/install-nvidia-proprietary-595.sh
#
# To restore Ubuntu userspace only (when kernel modules already present):
#   sudo bash scripts/restore-nvidia-595-closed-userspace.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec bash "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-cuda-repo-595.sh"
