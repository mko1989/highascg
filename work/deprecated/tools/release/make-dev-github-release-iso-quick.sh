#!/usr/bin/env bash
# Root-only: WO-47 prep + eggs produce (no NVIDIA cache / no extra live-network apt from build-highascg-egg.sh).
# Use when the clone host is already configured; for a full imaging host run
#   tools/live-usb/build-highascg-egg.sh instead.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0" >&2
	exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
BASENAME="${BASENAME:-highascg}"

echo "==> WO-47 + eggs exclude merge (quick ISO path)"
SKIP_HIGHASCG_SYSTEMD_RESTART=1 bash "${REPO_ROOT}/tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh"

echo "==> Hostname for ISO naming (${BASENAME})"
hostnamectl set-hostname "${BASENAME}" 2>/dev/null || hostname "${BASENAME}"

echo "==> eggs produce --clone --max --excludes static --basename ${BASENAME}"
eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}"

if [[ "${SKIP_STRIP_HOST_SWAP:-0}" != "1" ]]; then
	bash "${REPO_ROOT}/tools/eggs/live-usb/strip-host-swap-for-live-iso.sh" restore
fi

echo "Done. ISO under /home/eggs/ (${BASENAME}_*.iso)."
