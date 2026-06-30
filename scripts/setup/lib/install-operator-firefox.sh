#!/usr/bin/env bash
# Install operator Firefox (firefox-esr .deb via Mozilla Team PPA).
#
# Stock Ubuntu Noble+ has no firefox-esr candidate until ppa:mozillateam/ppa is added.
# Sourced by scripts/setup/05-caspar-deps.sh and work/bootstrap-remote-after-sync.sh.
set -euo pipefail

mozillateam_ppa_configured() {
	local f
	for f in /etc/apt/sources.list.d/mozillateam-ubuntu-ppa-*.sources; do
		[[ -f "$f" ]] && return 0
	done
	grep -rsq 'mozillateam/ppa' /etc/apt/sources.list.d/ 2>/dev/null
}

firefox_esr_candidate_from_mozilla_ppa() {
	apt-cache policy firefox-esr 2>/dev/null | grep -q 'ppa.launchpadcontent.net/mozillateam'
}

ensure_mozillateam_firefox_ppa() {
	if mozillateam_ppa_configured; then
		log "Mozilla Team PPA already configured"
		return 0
	fi

	log "Mozilla Team PPA (ppa:mozillateam/ppa) for firefox-esr"
	DEBIAN_FRONTEND=noninteractive apt-get install -y software-properties-common ca-certificates gnupg

	if [[ ! -f /etc/apt/preferences.d/mozillateam-firefox ]]; then
		cat >/etc/apt/preferences.d/mozillateam-firefox <<'EOF'
Package: firefox*
Pin: release o=LP-PPA-mozillateam
Pin-Priority: 1001

Package: firefox*
Pin: release o=Ubuntu
Pin-Priority: -1
EOF
		ok "apt pin → /etc/apt/preferences.d/mozillateam-firefox"
	fi

	DEBIAN_FRONTEND=noninteractive add-apt-repository -y ppa:mozillateam/ppa
	ok "added ppa:mozillateam/ppa"
}

install_operator_firefox_launchers() {
	local playout="${1:?playout dir}"
	local user_caspar="${2:?user}"

	mkdir -p /usr/local/lib/highascg
	local runtime="${playout}/tools/runtime"
	for _name in \
		highascg-operator-snap-home.sh \
		highascg-launch-operator-firefox.sh \
		highascg-clean-firefox-snap-leftovers.sh \
		highascg-tailscale-up.sh; do
		if [[ -f "${runtime}/${_name}" ]]; then
			install -m 0755 -o root -g root "${runtime}/${_name}" "/usr/local/lib/highascg/${_name}"
		fi
	done
	/usr/local/lib/highascg/highascg-operator-snap-home.sh "/home/${user_caspar}" 2>/dev/null || true
	if [[ -x /usr/local/lib/highascg/highascg-clean-firefox-snap-leftovers.sh ]]; then
		/usr/local/lib/highascg/highascg-clean-firefox-snap-leftovers.sh "/home/${user_caspar}" || true
	fi
	ok "operator firefox launcher → /usr/local/lib/highascg/highascg-launch-operator-firefox.sh"
}

# Install firefox-esr for Settings → Open browser. Falls back to snap when PPA unavailable.
install_operator_firefox() {
	local playout="${1:-/home/casparcg/highascg}"
	local user_caspar="${2:-casparcg}"

	if command -v firefox-esr &>/dev/null || command -v firefox &>/dev/null; then
		ok "firefox already available"
		install_operator_firefox_launchers "$playout" "$user_caspar"
		return 0
	fi

	if ! firefox_esr_candidate_from_mozilla_ppa; then
		ensure_mozillateam_firefox_ppa
		DEBIAN_FRONTEND=noninteractive apt-get update -y
	fi

	if firefox_esr_candidate_from_mozilla_ppa; then
		log "Install firefox-esr (Mozilla Team PPA)"
		DEBIAN_FRONTEND=noninteractive apt-get install -y firefox-esr
	elif command -v snap &>/dev/null; then
		log "Mozilla PPA unavailable — snap fallback"
		if ! snap list firefox 2>/dev/null | grep -qE '^firefox '; then
			snap install firefox || echo "  note: snap install firefox failed — run manually on operator box"
		fi
	else
		log "Install firefox package (last resort)"
		DEBIAN_FRONTEND=noninteractive apt-get install -y firefox || true
	fi

	if command -v firefox &>/dev/null || command -v firefox-esr &>/dev/null; then
		ok "firefox available"
		install_operator_firefox_launchers "$playout" "$user_caspar"
	else
		echo "  note: install Firefox manually (ppa:mozillateam/ppa or snap) for Settings → Open browser"
	fi
}
