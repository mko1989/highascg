#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
COMPANION_HOME="${COMPANION_HOME:-/home/casparcg/companion}"
CONFIG_DIR="${CONFIG_DIR:-/home/casparcg/.config/companion}"
SERVICE_SRC="${SERVICE_SRC:-${REPO_ROOT}/tools/eggs/companion/companion.service}"
SERVICE_DST="/etc/systemd/system/companion.service"
UDEV_SRC="${CONFIG_DIR}/udev-rules/50-companion-headless.rules"
UDEV_DST="/etc/udev/rules.d/50-companion-headless.rules"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

if [[ ! -x "${COMPANION_HOME}/companion_headless.sh" ]]; then
  echo "Companion not found at ${COMPANION_HOME}/companion_headless.sh" >&2
  echo "Extract the tarball to ${COMPANION_HOME} first." >&2
  exit 1
fi

if ! getent group companion >/dev/null; then
  groupadd --system companion
  echo "Created system group: companion"
fi

if ! id -nG casparcg | grep -qw companion; then
  usermod -aG companion casparcg
  echo "Added casparcg to companion group"
fi

mkdir -p "${CONFIG_DIR}"
chown -R casparcg:casparcg "${CONFIG_DIR}"

install -m 0644 "${SERVICE_SRC}" "${SERVICE_DST}"

if [[ -f "${UDEV_SRC}" ]]; then
  install -m 0644 "${UDEV_SRC}" "${UDEV_DST}"
  udevadm control --reload-rules
  udevadm trigger
  echo "Installed udev rules for USB surfaces (Stream Deck, etc.)"
else
  echo "Note: ${UDEV_SRC} not found yet; start Companion once to generate udev rules, then re-run this script."
fi

systemctl daemon-reload
systemctl enable companion.service
if [[ "${HIGHASCG_SKIP_COMPANION_RESTART:-0}" != "1" ]]; then
	systemctl restart companion.service
else
	echo "Skipped companion restart (HIGHASCG_SKIP_COMPANION_RESTART=1)"
fi

echo ""
echo "Companion service installed."
echo "  Web UI:  http://$(hostname -I | awk '{print $1}'):8001/"
echo "           http://127.0.0.1:8001/"
echo "  Status:  systemctl status companion"
echo "  Logs:    journalctl -u companion -f"
echo ""
echo "Port 8001 is used because casparcg-scanner already binds 8000."
echo "HighAsCG companion.json should use port 8001."
