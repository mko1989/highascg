#!/usr/bin/env bash
# apt-get update/install tolerant of dead penguins-eggs.net apt sources on produce hosts.
#
# Usage:
#   source tools/eggs/live-usb/apt-with-stale-eggs-repo-fallback.sh
#   highascg_apt_update
#   highascg_apt_install exfatprogs parted nginx
#
set -euo pipefail

highascg_disable_stale_eggs_apt_sources() {
	local f disabled=0
	for f in /etc/apt/sources.list.d/*eggs* /etc/apt/sources.list.d/*penguins*; do
		[[ -f "$f" ]] || continue
		[[ "$f" == *.disabled-by-highascg* ]] && continue
		mv "$f" "${f}.disabled-by-highascg-apt"
		echo "  disabled stale apt source: ${f}" >&2
		disabled=1
	done
	[[ "$disabled" -eq 1 ]]
}

highascg_apt_update() {
	export DEBIAN_FRONTEND=noninteractive
	if apt-get update -qq; then
		return 0
	fi
	echo "WARN: apt-get update failed — disabling stale eggs apt sources and retrying" >&2
	highascg_disable_stale_eggs_apt_sources || true
	apt-get update -qq
}

highascg_apt_install() {
	export DEBIAN_FRONTEND=noninteractive
	if [[ $# -eq 0 ]]; then
		return 0
	fi
	if apt-get install -y --no-install-recommends "$@"; then
		return 0
	fi
	echo "WARN: apt-get install failed — refreshing indexes without stale eggs repo" >&2
	highascg_apt_update
	apt-get install -y --no-install-recommends "$@"
}
