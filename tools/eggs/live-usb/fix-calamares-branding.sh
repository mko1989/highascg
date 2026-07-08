#!/usr/bin/env bash
# eggs 26.6.2 writes branding.desc → highascg-eggs-theme-logo.png but only copies eggs-logo.png.
# Idempotent: copy fallback so Calamares can start (build host + live stick).
set -euo pipefail

BRAND="${CALAMARES_BRAND_DIR:-/etc/calamares/branding/highascg-eggs-theme}"
DESC="${BRAND}/branding.desc"

[[ -f "$DESC" ]] || exit 0

icon="$(awk -F': *' '/^[[:space:]]*productIcon:/{print $2; exit}' "$DESC" | tr -d ' \"')"
logo="$(awk -F': *' '/^[[:space:]]*productLogo:/{print $2; exit}' "$DESC" | tr -d ' \"')"

for want in "$icon" "$logo"; do
	[[ -n "$want" ]] || continue
	[[ -f "${BRAND}/${want}" ]] && continue
	for fallback in eggs-logo.png welcome.png; do
		if [[ -f "${BRAND}/${fallback}" ]]; then
			cp -a "${BRAND}/${fallback}" "${BRAND}/${want}"
			echo "Calamares branding: installed ${want} from ${fallback}" >&2
			break
		fi
	done
	[[ -f "${BRAND}/${want}" ]] || {
		echo "Calamares branding: missing ${want} in ${BRAND}" >&2
		exit 1
	}
done
