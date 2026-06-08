#!/usr/bin/env bash
# Restore working GPU on this Blackwell playout host.
#
# Fixes everything that broke in the last 48h of driver flip-flops:
#   - APT pin blocking open kernel modules (highascg-nvidia-proprietary.pref)
#   - cuda-drivers 610/595 closed (RmInit fails on 10de:2c34)
#   - apt purge nvidia* gutting userspace/modules
#   - nvidia-firmware file conflicts between CUDA and Ubuntu packages
#   - GSP RPC workaround for display stability
#
# Installs: nvidia-driver-595 + linux-modules-nvidia-595 (closed, pinned kernel 6.8.0-117)
#
#   sudo bash scripts/restore-gpu-working.sh
set -euo pipefail

exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-nvidia-driver-595-blackwell.sh"
