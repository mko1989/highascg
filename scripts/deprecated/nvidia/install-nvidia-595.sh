#!/usr/bin/env bash
# DEPRECATED — use scripts/setup/03-nvidia-open-595.sh
# Install working NVIDIA 595 for this host.
#
#   sudo bash scripts/install-nvidia-595.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if lspci -nn 2>/dev/null | grep -iE 'vga.*nvidia' | grep -qE '\[10de:(2c34|2c18|2c19|2b[0-9a-f]{2})\]'; then
	exec bash "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-driver-595-blackwell.sh"
else
	exec bash "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-cuda-repo-595.sh"
fi
