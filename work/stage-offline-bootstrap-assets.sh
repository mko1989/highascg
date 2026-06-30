#!/usr/bin/env bash
# Cache GitHub-only install artifacts on THIS machine for offline bootstrap on peers.
#
#   bash work/stage-offline-bootstrap-assets.sh
#
# Writes to vendor/offline-bootstrap/ (included in mirror rsync).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/lib/install-config.sh
source "${REPO}/scripts/lib/install-config.sh"

OUT="${REPO}/vendor/offline-bootstrap"
mkdir -p "$OUT"

scanner_deb="${OUT}/casparcg-scanner_${SCANNER_PIN_VERSION:-1.4.0}-ubuntu1_amd64.deb"
scanner_url="${HIGHASCG_SCANNER_DEB_URL:-${URL_SCANNER_DEB:-}}"

if [[ -f "$scanner_deb" ]]; then
	echo "OK: $(basename "$scanner_deb") already staged ($(du -h "$scanner_deb" | cut -f1))"
elif [[ -n "$scanner_url" ]]; then
	echo "→ download scanner deb"
	if command -v curl >/dev/null 2>&1; then
		curl -fL --retry 2 -o "$scanner_deb" "$scanner_url"
	else
		wget -q -O "$scanner_deb" "$scanner_url"
	fi
	echo "   $(du -h "$scanner_deb" | cut -f1) → $scanner_deb"
else
	echo "WARN: no scanner URL configured — remote bootstrap needs casparcg-scanner deb in ${OUT}/" >&2
fi

manifest="${OUT}/manifest.txt"
{
	echo "# staged $(date -Is) on $(hostname)"
	echo "scanner_deb=$(basename "$scanner_deb")"
	[[ -f "$scanner_deb" ]] && echo "scanner_sha256=$(sha256sum "$scanner_deb" | awk '{print $1}')"
} >"$manifest"

echo "Offline bootstrap assets ready under ${OUT}/"
