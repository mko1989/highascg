#!/usr/bin/env bash
# Bring a playout host online after mirror rsync from a leader (no GitHub on target).
#
# Run ON THE REMOTE BOX after DEPLOY_MODE=mirror push:
#   cd ~/highascg
#   sudo bash work/bootstrap-remote-after-sync.sh
#
# What it does (offline-safe where possible):
#   - apt packages: firefox-esr (Mozilla Team PPA), thunar, python3-xlib, Caspar runtime libs, nodm/openbox
#   - casparcg-scanner from vendor/offline-bootstrap/*.deb (no GitHub)
#   - skips CEF download when lib/libcef.so already synced
#   - npm install --omit=dev only if node_modules looks incomplete
#   - systemd: highascg.service + casparcg-scanner + casparcg-server (WO-73)
#   - Openbox autostart refresh (pointer confine, NVIDIA helpers)
#
# Does NOT: kernel pin, NVIDIA driver install, DeckLink — handle those separately if needed.
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="${REPO}/scripts/setup"
OFFLINE="${REPO}/vendor/offline-bootstrap"
USER_CASPAR="${USER_CASPAR:-casparcg}"
PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

log() { echo "==> $*"; }
ok() { echo "   OK: $*"; }

log "Remote bootstrap after mirror sync"
log "Repo: ${REPO}"
log "User: ${USER_CASPAR}"

[[ -f "${REPO}/package.json" ]] || {
	echo "ERROR: ${REPO}/package.json missing — run mirror rsync first." >&2
	exit 1
}

for need in apt-get systemctl; do
	command -v "$need" >/dev/null || {
		echo "ERROR: missing ${need}" >&2
		exit 1
	}
done

log "Step 1/6: apt packages (firefox, thunar, python3-xlib, Caspar libs, nodm/openbox)"
bash "${SETUP}/05-caspar-deps.sh"

log "Step 2/6: casparcg-scanner (offline deb)"
if command -v casparcg-scanner >/dev/null 2>&1; then
	ok "casparcg-scanner already installed: $(command -v casparcg-scanner)"
else
	deb=""
	if [[ -d "$OFFLINE" ]]; then
		deb="$(find "$OFFLINE" -maxdepth 1 -name 'casparcg-scanner_*.deb' | sort -V | tail -1)"
	fi
	if [[ -z "$deb" || ! -f "$deb" ]]; then
		echo "ERROR: casparcg-scanner not installed and no deb in ${OFFLINE}/" >&2
		echo "On the leader: bash work/stage-offline-bootstrap-assets.sh && re-run mirror rsync" >&2
		exit 1
	fi
	log "dpkg -i $(basename "$deb")"
	DEBIAN_FRONTEND=noninteractive dpkg -i "$deb" || DEBIAN_FRONTEND=noninteractive apt-get install -f -y
	command -v casparcg-scanner >/dev/null || {
		echo "ERROR: scanner install failed" >&2
		exit 1
	}
	ok "casparcg-scanner installed"
fi

log "Step 3/6: Node.js + npm (offline-friendly)"
MIN_NODE=20
need_node=false
if ! command -v node >/dev/null 2>&1; then
	need_node=true
elif ! [[ "$(node -v | sed 's/v//')" =~ ^[0-9] ]]; then
	need_node=true
else
	leader_ver="$(node -v | sed 's/v//')"
	if [[ "$(printf '%s\n%s\n' "$MIN_NODE" "$leader_ver" | sort -V | head -1)" != "$MIN_NODE" ]]; then
		need_node=true
	fi
fi

if $need_node; then
	if apt-cache show nodejs 2>/dev/null | grep -q '^Version:'; then
		log "apt install nodejs (may be older than ${MIN_NODE} — check after)"
		DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm || true
	fi
	if ! command -v node >/dev/null 2>&1; then
		echo "ERROR: node not found and cannot download NodeSource (no GitHub/internet)." >&2
		echo "Install Node ${MIN_NODE}+ manually, then re-run this script." >&2
		exit 1
	fi
fi
ok "node $(node -v) npm $(npm -v 2>/dev/null || echo '?')"

if [[ ! -d "${PLAYOUT}/node_modules/ws" ]]; then
	log "npm install --omit=dev (node_modules incomplete after rsync)"
	cd "${PLAYOUT}"
	sudo -u "${USER_CASPAR}" npm install --omit=dev
else
	ok "node_modules present — skip npm install"
fi

log "Step 4/6: Caspar launcher + CEF overlay (skip GitHub when lib/ synced)"
export HIGHASCG_SKIP_CEF=1
if [[ -f "${PLAYOUT}/lib/libcef.so" ]]; then
	ok "lib/libcef.so present from mirror — HIGHASCG_SKIP_CEF=1"
fi
bash "${SETUP}/08-caspar-cef-scanner.sh"

log "Step 5/6: systemd units (highascg + casparcg-scanner + casparcg-server)"
if [[ -f "${REPO}/scripts/exfat/write-highascg-systemd-unit.sh" ]]; then
	bash "${REPO}/scripts/exfat/write-highascg-systemd-unit.sh" "${USER_CASPAR}"
	systemctl daemon-reload
	systemctl enable highascg.service 2>/dev/null || true
fi
bash "${SETUP}/13-caspar-systemd-units.sh" "${USER_CASPAR}"

if [[ -f "${SETUP}/12-passwordless-sudo.sh" ]]; then
	log "passwordless sudo for Web UI"
	bash "${SETUP}/12-passwordless-sudo.sh" "${USER_CASPAR}" || true
fi

log "Step 6/6: Openbox autostart (WO-73 — no Caspar in autostart when systemd owns it)"
bash "${SETUP}/09-openbox-autostart.sh"

chown -R "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}" 2>/dev/null || true

log "Start services"
systemctl daemon-reload
systemctl enable nodm.service 2>/dev/null || true
systemctl restart nodm.service 2>/dev/null || systemctl start nodm.service 2>/dev/null || true
sleep 2

systemctl enable casparcg-scanner.service 2>/dev/null || true
systemctl restart casparcg-scanner.service 2>/dev/null || systemctl start casparcg-scanner.service 2>/dev/null || true

if [[ -x "${PLAYOUT}/run.sh" && -f "${PLAYOUT}/config/casparcg.config" ]]; then
	systemctl enable casparcg-server.service 2>/dev/null || true
	systemctl restart casparcg-server.service 2>/dev/null || systemctl start casparcg-server.service 2>/dev/null || true
else
	echo "  note: casparcg-server not started — need run.sh + config/casparcg.config"
fi

systemctl restart highascg.service 2>/dev/null || systemctl start highascg.service 2>/dev/null || true

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Bootstrap complete: $(date -Is)"
echo
echo "Check:"
echo "  systemctl status highascg casparcg-scanner casparcg-server nodm"
echo "  curl -s http://127.0.0.1:4200/api/replication/ping | python3 -m json.tool"
echo "  curl -s http://127.0.0.1:5250/version"
echo "  command -v firefox firefox-esr thunar python3"
echo
echo "If Node was too old from apt-only, install Node ${MIN_NODE}+ and:"
echo "  cd ~/highascg && sudo -u casparcg npm install --omit=dev && sudo systemctl restart highascg"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
