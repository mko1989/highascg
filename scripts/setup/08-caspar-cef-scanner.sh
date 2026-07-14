#!/usr/bin/env bash
# Step 8: Caspar launcher, pinned CEF, media scanner.
# Requires ~/highascg/bin/casparcg (restored/baked binary — not downloaded here).
#
#   sudo bash scripts/setup/08-caspar-cef-scanner.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

export SCRIPT_DIR="${REPO_ROOT}"
# shellcheck source=../install-config.sh
source "${SCRIPTS_LIB}/install-config.sh"
# shellcheck source=../lib/install-helpers.sh
source "${SCRIPTS_LIB}/install-helpers.sh"

PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

log "Caspar launcher (bin/casparcg + run.sh)"
if ensure_highascg_caspar_launcher; then
	ok "launcher ready"
else
	echo "  note: restore ${PLAYOUT}/bin/casparcg before playout will start"
fi

# Fresh host + restored ~/highascg often has libcef.so from backup but is missing
# locales/resources or a mismatched pin — always overlay the GitHub release into lib/
# (cp -a merges; libndi.so and other non-CEF files in lib/ are left intact).
log "Pinned CEF → ${PLAYOUT}/lib/ (overlay from ${URL_CEF_BINARY_TAR})"
if [[ "${HIGHASCG_SKIP_CEF:-0}" == "1" ]]; then
	ok "HIGHASCG_SKIP_CEF=1 — skipping CEF download"
else
	if [[ -f "${PLAYOUT}/lib/libcef.so" ]]; then
		log "Existing libcef.so — overlay pinned release (keeps libndi etc.)"
		pkill -f "${PLAYOUT}/bin/casparcg" 2>/dev/null || true
		pkill -f "${PLAYOUT}/run.sh" 2>/dev/null || true
		sleep 2
		find "${PLAYOUT}/cef-cache" -mindepth 1 -delete 2>/dev/null || true
		rm -rf /tmp/.org.chromium.Chromium.* /tmp/.com.google.* 2>/dev/null || true
	fi
	DEBIAN_FRONTEND=noninteractive apt-get install -y curl wget bzip2 tar
	install_highascg_cef_binary || {
		echo "ERROR: CEF install failed — check URL_CEF_BINARY_TAR in install-config.sh" >&2
		exit 1
	}
fi

log "Media scanner (casparcg-scanner deb)"
if command -v casparcg-scanner &>/dev/null; then
	ok "casparcg-scanner already installed"
elif [[ "${HIGHASCG_FORCE_SCANNER:-0}" == "1" ]] || ! command -v casparcg-scanner &>/dev/null; then
	install_highascg_scanner_deb || {
		echo "ERROR: scanner install failed — check URL_SCANNER_DEB in install-config.sh" >&2
		exit 1
	}
fi

log "CasparCG systemd units (WO-73 — replace Openbox autostart ownership)"
if [[ -f "${SCRIPT_DIR}/13-caspar-systemd-units.sh" ]]; then
	bash "${SCRIPT_DIR}/13-caspar-systemd-units.sh" "$USER_CASPAR" || {
		echo "  note: 13-caspar-systemd-units.sh failed (non-fatal on partial install)" >&2
	}
else
	systemctl stop casparcg-server 2>/dev/null || true
	systemctl disable casparcg-server 2>/dev/null || true
fi

if [[ -f "${PLAYOUT}/media/casparcg.config.ftd" && ! -f "${PLAYOUT}/config/casparcg.config" ]]; then
	cp -a "${PLAYOUT}/media/casparcg.config.ftd" "${PLAYOUT}/config/casparcg.config"
	chown "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/config/casparcg.config"
	ok "migrated config → config/casparcg.config"
fi

# WO-162: the media scanner opens ./casparcg.config relative to its
# WorkingDirectory (the repo ROOT — distinct from the server's
# config/casparcg.config handled above); nothing else ever recreates it, so
# seed the root file from the scanner template when absent.
if [[ -f "${REPO_ROOT}/scripts/setup/templates/scanner.config" && ! -f "${PLAYOUT}/casparcg.config" ]]; then
	cp -a "${REPO_ROOT}/scripts/setup/templates/scanner.config" "${PLAYOUT}/casparcg.config"
	chown "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/casparcg.config"
	ok "seeded scanner config → ${PLAYOUT}/casparcg.config"
fi

cp /usr/lib/x86_64-linux-gnu/libndi.so.6* "${PLAYOUT}/lib/" 2>/dev/null || true
chown "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/lib"/libndi.so.6* 2>/dev/null || true
chown -R "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/lib" 2>/dev/null || true

echo
command -v casparcg-scanner &>/dev/null && ok "scanner: $(command -v casparcg-scanner)"
[[ -f "${PLAYOUT}/lib/libcef.so" ]] && ok "CEF: ${PLAYOUT}/lib/libcef.so"
echo
echo "Next: sudo bash ${SCRIPT_DIR}/09-openbox-autostart.sh"
