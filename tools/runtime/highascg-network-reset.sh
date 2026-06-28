#!/usr/bin/env bash
# Reset wired networking: DHCP renew / reconnect (NM or systemd-networkd).
# Safe when the Web UI/API is unreachable due to a bad static IP or stale lease.
#
# Usage:
#   highascg-network-reset.sh [iface]
#   highascg-network-reset.sh          # auto-pick wired NIC (carrier preferred)
set -euo pipefail

IFACE="${1:-}"

iface_allowed() {
	[[ "${1:-}" =~ ^(eth|enp|eno)[0-9]+$ ]]
}

pick_iface() {
	if [[ -n "$IFACE" ]]; then
		iface_allowed "$IFACE" || {
			echo "Rejected interface name: $IFACE" >&2
			exit 2
		}
		echo "$IFACE"
		return 0
	fi
	local name carrier
	for p in /sys/class/net/*; do
		name="$(basename "$p")"
		iface_allowed "$name" || continue
		carrier="$(cat "$p/carrier" 2>/dev/null || echo 0)"
		if [[ "$carrier" == "1" ]]; then
			echo "$name"
			return 0
		fi
	done
	for p in /sys/class/net/*; do
		name="$(basename "$p")"
		iface_allowed "$name" && {
			echo "$name"
			return 0
		}
	done
	echo "No wired interface found" >&2
	exit 2
}

nm_manages_iface() {
	command -v nmcli >/dev/null 2>&1 || return 1
	local state
	state="$(nmcli -t -f GENERAL.STATE dev show "$1" 2>/dev/null | head -1 | cut -d: -f2- || true)"
	[[ -n "$state" && "$state" != *unmanaged* ]]
}

reset_via_nmcli() {
	local dev="$1"
	echo "NetworkManager: renew $dev"
	nmcli dev disconnect "$dev" 2>/dev/null || true
	sleep 1
	nmcli dev connect "$dev" 2>/dev/null || true
	if nmcli dev reapply "$dev" 2>/dev/null; then
		echo "NetworkManager: reapply ok"
		return 0
	fi
	local conn=""
	conn="$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | awk -F: -v d="$dev" '$2==d {print $1; exit}')"
	if [[ -z "$conn" ]]; then
		conn="$(nmcli -t -f NAME,DEVICE con show 2>/dev/null | awk -F: -v d="$dev" '$2==d {print $1; exit}')"
	fi
	if [[ -n "$conn" ]]; then
		nmcli con down "$conn" 2>/dev/null || true
		nmcli con up "$conn" ifname "$dev" 2>/dev/null || true
		echo "NetworkManager: cycled connection $conn"
	fi
}

reset_via_networkd() {
	local dev="$1"
	echo "systemd-networkd: renew/reconfigure $dev"
	if command -v networkctl >/dev/null 2>&1; then
		networkctl renew "$dev" 2>/dev/null || true
		networkctl reconfigure "$dev" 2>/dev/null || true
	fi
	systemctl reload systemd-networkd 2>/dev/null || systemctl restart systemd-networkd
}

IFACE="$(pick_iface)"
echo "==> HighAsCG network reset on $IFACE"

if nm_manages_iface "$IFACE"; then
	reset_via_nmcli "$IFACE"
	nmcli networking off 2>/dev/null || true
	sleep 1
	nmcli networking on 2>/dev/null || true
	echo "NetworkManager: global cycle"
else
	reset_via_networkd "$IFACE"
fi

addr="$(ip -4 -o addr show dev "$IFACE" scope global 2>/dev/null | awk '{print $4}' | head -1 || true)"
lladdr="$(ip -4 -o addr show dev "$IFACE" scope link 2>/dev/null | awk '{print $4}' | head -1 || true)"
echo "OK: reset complete on $IFACE${addr:+ (global $addr)}${lladdr:+ (link-local $lladdr)}"
