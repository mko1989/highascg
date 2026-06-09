#!/usr/bin/env bash
# Step 7: Node.js LTS + HighAsCG npm deps + systemd unit.
#
#   sudo bash scripts/setup/07-node-highascg.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

MIN_NODE=20
PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

version_gte() {
	local a="${1#v}" b="${2#v}"
	[[ "$(printf '%s\n%s\n' "$b" "$a" | sort -V | head -1)" == "$b" ]]
}

log "Node.js LTS (NodeSource)"
need_node=false
if ! command -v node &>/dev/null; then
	need_node=true
elif ! version_gte "$(node -v | sed 's/v//')" "$MIN_NODE"; then
	need_node=true
fi

if $need_node; then
	curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
	DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
ok "node $(node -v) npm $(npm -v)"

log "Sync HighAsCG app to ${PLAYOUT}"
if [[ ! -f "${REPO_ROOT}/package.json" ]]; then
	echo "ERROR: no package.json at ${REPO_ROOT}" >&2
	exit 1
fi

apt-get install -y rsync
mkdir -p "${PLAYOUT}"
rsync -a \
	--exclude='node_modules' --exclude='.git' --exclude='work' \
	--exclude='media' --exclude='_media' --exclude='data' --exclude='bin' --exclude='lib' \
	--exclude='dist' --exclude='cef-cache' --exclude='log' --exclude='core' \
	"${REPO_ROOT}/" "${PLAYOUT}/"

chown -R "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}"
chmod -R 775 "${PLAYOUT}"

if [[ ! -f "${PLAYOUT}/highascg.config.json" && -f "${PLAYOUT}/highascg.config.example.json" ]]; then
	cp "${PLAYOUT}/highascg.config.example.json" "${PLAYOUT}/highascg.config.json"
	chown "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/highascg.config.json"
fi

log "npm install (production)"
cd "${PLAYOUT}"
sudo -u "${USER_CASPAR}" npm install --omit=dev

if [[ -f "${SCRIPTS_EXFAT}/write-highascg-systemd-unit.sh" ]]; then
	log "systemd unit highascg.service"
	bash "${SCRIPTS_EXFAT}/write-highascg-systemd-unit.sh" "${USER_CASPAR}"
	systemctl daemon-reload
	systemctl enable highascg.service 2>/dev/null || true
	systemctl restart highascg.service 2>/dev/null || systemctl start highascg.service 2>/dev/null || true
fi

if [[ -f "${SCRIPT_DIR}/12-passwordless-sudo.sh" ]]; then
	log "passwordless sudo for Web UI (nodm restart, reboot)"
	bash "${SCRIPT_DIR}/12-passwordless-sudo.sh" "${USER_CASPAR}"
fi

echo
systemctl is-active highascg.service 2>/dev/null && ok "highascg.service active" || echo "  note: start highascg after config/Caspar are ready"
echo
echo "Next:"
echo "  sudo bash ${SCRIPT_DIR}/08-caspar-cef-scanner.sh"
echo "  sudo bash ${SCRIPT_DIR}/09-openbox-autostart.sh"
echo
echo "Optional later: Tailscale / Syncthing / UFW — scripts/install-phase4.sh + install-phase5.sh"
