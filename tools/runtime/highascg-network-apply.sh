#!/usr/bin/env bash
# Apply IPv4 network settings via NetworkManager (nmcli) or systemd-networkd. WO-59 / WO-94 / WO-110.
# Usage:
#   highascg-network-apply.sh dhcp <iface>
#   highascg-network-apply.sh static <iface> <ip> <prefix> <gateway> [dns]
set -euo pipefail

MODE="${1:-}"
IFACE="${2:-}"
OPERATOR_NET=/etc/systemd/network/80-highascg-operator.network

if [[ "$MODE" != "dhcp" && "$MODE" != "static" ]]; then
	echo "Usage: $0 dhcp|static <iface> ..." >&2
	exit 2
fi

if [[ ! "$IFACE" =~ ^(eth|enp|eno)[0-9]+$ ]]; then
	echo "Rejected interface name: $IFACE" >&2
	exit 2
fi

iface_nm_state() {
	nmcli -t -f DEVICE,STATE device show "$IFACE" 2>/dev/null | awk -F: '{print $2}' | head -1 || true
}

is_networkd_managed() {
	command -v networkctl >/dev/null 2>&1 || return 1
	local state
	state="$(networkctl status "$IFACE" 2>/dev/null | awk '/State:/ {print $2; exit}')"
	[[ -n "$state" && "$state" != "unmanaged" ]]
}

should_use_networkd() {
	local nm_state
	nm_state="$(iface_nm_state)"
	if [[ "$nm_state" == "unmanaged" ]] && is_networkd_managed; then
		return 0
	fi
	if ! command -v nmcli >/dev/null 2>&1 && is_networkd_managed; then
		return 0
	fi
	return 1
}

apply_networkd_dhcp() {
	rm -f "$OPERATOR_NET"
	if command -v networkctl >/dev/null 2>&1; then
		networkctl reload 2>/dev/null || systemctl reload systemd-networkd 2>/dev/null || true
		networkctl reconfigure "$IFACE" 2>/dev/null || networkctl renew "$IFACE" 2>/dev/null || true
	fi
	echo "Applied DHCP on $IFACE (systemd-networkd; link-local via 10-live-wired.network)"
}

apply_networkd_static() {
	local ip="$1" prefix="$2" gw="$3" dns_csv="$4"
	local dns_line dns_part
	{
		echo '[Match]'
		echo "Name=${IFACE}"
		echo
		echo '[Network]'
		echo "Address=${ip}/${prefix}"
		if [[ -n "$gw" ]]; then
			echo "Gateway=${gw}"
		fi
		if [[ -n "$dns_csv" ]]; then
			IFS=',' read -r -a dns_parts <<<"$dns_csv"
			for dns_part in "${dns_parts[@]}"; do
				dns_part="$(echo "$dns_part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
				[[ -z "$dns_part" ]] && continue
				echo "DNS=${dns_part}"
			done
		fi
	} >"$OPERATOR_NET"
	chmod 644 "$OPERATOR_NET"
	networkctl reload 2>/dev/null || systemctl reload systemd-networkd 2>/dev/null || true
	networkctl reconfigure "$IFACE"
	echo "Applied static ${ip}/${prefix} on $IFACE (systemd-networkd)"
}

if should_use_networkd; then
	if [[ "$MODE" == "dhcp" ]]; then
		apply_networkd_dhcp
		exit 0
	fi
	IP="${3:-}"
	PREFIX="${4:-}"
	GW="${5:-}"
	DNS="${6:-}"
	if [[ -z "$IP" || -z "$PREFIX" ]]; then
		echo "static requires ip and prefix" >&2
		exit 2
	fi
	apply_networkd_static "$IP" "$PREFIX" "$GW" "$DNS"
	exit 0
fi

if ! command -v nmcli >/dev/null 2>&1; then
	echo "nmcli not found and $IFACE is not networkd-managed" >&2
	exit 3
fi

CONN=""
while IFS= read -r line; do
	dev="${line#*:}"
	dev="${dev%%:*}"
	name="${line%%:*}"
	if [[ "$dev" == "$IFACE" && -n "$name" ]]; then
		CONN="$name"
		break
	fi
done < <(nmcli -t -f NAME,DEVICE con show 2>/dev/null || true)

if [[ -z "$CONN" ]]; then
	CONN="highascg-${IFACE}"
	nmcli con add type ethernet ifname "$IFACE" con-name "$CONN" autoconnect yes >/dev/null
fi

if [[ "$MODE" == "dhcp" ]]; then
	# ipv4.link-local 2 = fallback when DHCP fails (WO-94)
	nmcli con mod "$CONN" ipv4.method auto ipv4.link-local 2 ipv4.addresses "" ipv4.gateway "" ipv4.dns ""
	nmcli con up "$CONN" ifname "$IFACE"
	echo "Applied DHCP on $IFACE ($CONN)"
	exit 0
fi

IP="${3:-}"
PREFIX="${4:-}"
GW="${5:-}"
DNS="${6:-}"

if [[ -z "$IP" || -z "$PREFIX" ]]; then
	echo "static requires ip and prefix" >&2
	exit 2
fi

ADDR="${IP}/${PREFIX}"
if [[ -n "$GW" ]]; then
	nmcli con mod "$CONN" ipv4.method manual ipv4.addresses "$ADDR" ipv4.gateway "$GW"
else
	nmcli con mod "$CONN" ipv4.method manual ipv4.addresses "$ADDR" ipv4.gateway ""
fi
if [[ -n "$DNS" ]]; then
	nmcli con mod "$CONN" ipv4.dns "$DNS"
else
	nmcli con mod "$CONN" ipv4.dns ""
fi
nmcli con up "$CONN" ifname "$IFACE"
echo "Applied static $ADDR on $IFACE ($CONN)"
