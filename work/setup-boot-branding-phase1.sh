#!/usr/bin/env bash
# Phase 1: Install boot branding on THIS host (GRUB theme vendor + Plymouth 4-frame throbber).
# Phase 2: eggs produce — run separately after this succeeds.
#
#   cd /home/casparcg/highascg
#   sudo bash work/setup-boot-branding-phase1.sh
#
# Then:
#   sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
#
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO="/home/casparcg/highascg"
LIVE_USB="${REPO}/tools/eggs/live-usb"
export DEBIAN_FRONTEND=noninteractive

install_penguins_eggs() {
	local keyring=/usr/share/keyrings/penguins-eggs-repos.gpg
	local sources=/etc/apt/sources.list.d/penguins-eggs-repos.list
	local key_tmp

	echo "==> Installing penguins-eggs via official apt repo (penguins-eggs.net)"
	key_tmp="$(mktemp)"
	trap 'rm -f "$key_tmp"' RETURN
	curl -fsSL https://penguins-eggs.net/repos/KEY.asc -o "$key_tmp"
	[[ -s "$key_tmp" ]] || {
		echo "ERROR: eggs repo GPG key download is empty" >&2
		return 1
	}
	gpg --dearmor <"$key_tmp" >"$keyring"
	chmod 0644 "$keyring"
	printf 'deb [signed-by=%s] https://penguins-eggs.net/repos/deb stable main\n' "$keyring" >"$sources"
	apt-get update
	apt-get install -y penguins-eggs
}

install_penguins_eggs_deb() {
	local deb ver url

	echo "==> Installing penguins-eggs from GitHub release .deb (apt repo fallback)"
	ver="$(curl -fsSL https://api.github.com/repos/pieroproietti/penguins-eggs/releases/latest \
		| sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"
	[[ -n "$ver" ]] || {
		echo "ERROR: could not resolve latest penguins-eggs release tag" >&2
		return 1
	}
	deb="penguins-eggs_${ver#v}-1_$(dpkg --print-architecture).deb"
	url="https://github.com/pieroproietti/penguins-eggs/releases/download/${ver}/${deb}"
	curl -fsSL -o "/tmp/${deb}" "$url"
	[[ -s "/tmp/${deb}" ]] || {
		echo "ERROR: failed to download ${url}" >&2
		return 1
	}
	apt-get install -y "/tmp/${deb}" || {
		dpkg -i "/tmp/${deb}" || true
		apt-get install -f -y
	}
	rm -f "/tmp/${deb}"
}

echo "==> Phase 1: boot branding on $(hostname) ($(date -Is))"

if ! command -v eggs >/dev/null 2>&1; then
	# Old PPA KEY.gpg is empty (0 bytes) — do not use pieroproietti.github.io/penguins-eggs-ppa.
	rm -f /usr/share/keyrings/penguins-eggs.gpg /etc/apt/sources.list.d/penguins-eggs.list 2>/dev/null || true
	if ! install_penguins_eggs; then
		echo "WARN: apt repo install failed — trying GitHub .deb" >&2
		install_penguins_eggs_deb
	fi
	command -v eggs >/dev/null 2>&1 || {
		echo "ERROR: eggs binary missing after penguins-eggs install" >&2
		exit 1
	}
fi

if [[ ! -f /etc/penguins-eggs.d/eggs.yaml ]]; then
	echo "==> Initialise eggs configuration"
	eggs dad -d
fi

echo "==> Prepare assets + install GRUB theme + Plymouth (4 throbber frames)"
bash "${LIVE_USB}/install-eggs-live-grub-theme.sh"

echo "==> Verify host branding"
bash "${LIVE_USB}/finalize-boot-branding-for-eggs-produce.sh"

nthrob="$(find /usr/share/plymouth/themes/highascg -maxdepth 1 -name 'throbber-*.png' 2>/dev/null | wc -l)"
nthrob="${nthrob//[[:space:]]/}"
echo
echo "OK: Phase 1 complete"
echo "     Plymouth throbber frames: ${nthrob} (expect 4 from animation 1,2,29,30)"
echo "     GRUB splash: ${LIVE_USB}/highascg-eggs-theme/theme/livecd/splash.png"
echo "     eggs theme: $(grep '^theme:' /etc/penguins-eggs.d/eggs.yaml)"
echo
echo "Next — Phase 2 (ISO build, ~20–60 min):"
echo "  sudo HIGHASCG_NVIDIA_DRIVER=595 bash ${REPO}/work/run-eggs-produce-from-host.sh"
