#!/bin/sh
# HighAsCG — offline-safe calamares l10n helper (eggs copy uses set -ex + check-language-support).
# Installed to /usr/libexec/calamares/calamares-l10n-helper.sh by fix-calamares-shellprocess.sh
set -e

if [ -f /etc/default/locale ]; then
	# shellcheck source=/dev/null
	. /etc/default/locale
fi

LANG="${LANG:-en_US.UTF-8}"
LC_TIME="${LC_TIME:-$LANG}"
without_ext=$(echo "$LANG" | cut -d. -f1)

if command -v locale-gen >/dev/null 2>&1; then
	/usr/sbin/locale-gen --keep-existing "$LANG" 2>/dev/null || true
	/usr/sbin/locale-gen --keep-existing "$LC_TIME" 2>/dev/null || true
fi

if ! command -v apt-get >/dev/null 2>&1; then
	exit 0
fi

apt-get update 2>/dev/null || true
apt-get install -y language-selector-common 2>/dev/null || true

if command -v check-language-support >/dev/null 2>&1; then
	missing=$(check-language-support --language="$without_ext" 2>/dev/null || true)
	if [ -n "${missing:-}" ]; then
		# shellcheck disable=SC2086
		apt-get install -y $missing 2>/dev/null || true
	fi
fi

exit 0
