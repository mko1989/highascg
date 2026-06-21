#!/usr/bin/env bash
# Prepare checks + full eggs clone produce. NEVER deletes under /home/eggs/.
#
#   cd /home/casparcg/highascg
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-prepare-and-produce-safe.sh
#
# See work/EGGS_PRODUCE_SAFETY.md — backup operator config before running.
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo HIGHASCG_NVIDIA_DRIVER=595 $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HIGHASCG_NVIDIA_DRIVER="${HIGHASCG_NVIDIA_DRIVER:-595}"

echo "==> HighAsCG eggs prepare + produce (clone, no /home/eggs deletes)"
echo "    driver=${HIGHASCG_NVIDIA_DRIVER} repo=${REPO}"
echo "    SAFETY: never rm or umount /home/eggs — reboot if a prior produce was interrupted."
echo

bash "${REPO}/work/run-eggs-prepare-safe.sh"

echo
echo "==> Pre-produce backup reminder: casparcg.config was backed up manually before this run."
echo "==> Starting full produce (prepare is re-run inside build-highascg-egg.sh)..."
echo

exec bash "${REPO}/work/run-eggs-produce-from-host.sh"
