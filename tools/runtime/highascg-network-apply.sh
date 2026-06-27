#!/usr/bin/env bash
# Apply IPv4 network settings via NetworkManager (nmcli). WO-59.
# Usage:
#   highascg-network-apply.sh dhcp <iface>
#   highascg-network-apply.sh static <iface> <ip> <prefix> <gateway> [dns]
set -euo pipefail

MODE="${1:-}"
IFACE="${2:-}"

if [[ "$MODE" != "dhcp" && "$MODE" != "static" ]]; then
	echo "Usage: $0 dhcp|static <iface> ..." >&2
	exit 2
fi

if [[ ! "$IFACE" =~ ^(eth|enp|eno)[0-9]+$ ]]; then
	echo "Rejected interface name: $IFACE" >&2
	exit 2
fi

if ! command -v nmcli >/dev/null 2>&1; then
	echo "nmcli not found" >&2
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
	nmcli con mod "$CONN" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns ""
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
