#!/usr/bin/env bash
# Apply IPv4 network settings via NetworkManager (nmcli) or systemd-networkd. WO-59 / WO-94 / WO-110.
# Usage:
#   highascg-network-apply.sh dhcp <iface>
#   highascg-network-apply.sh static <iface> <ip> <prefix> <gateway> [dns]
#   highascg-network-apply.sh wifi-scan <wl-iface>
#   highascg-network-apply.sh wifi-connect <wl-iface> <ssid>      (passphrase on stdin, empty = open network)
#   highascg-network-apply.sh wifi-disconnect <wl-iface>
#   highascg-network-apply.sh wifi-radio on|off
# WO-692: any Ethernet name systemd gives (eno1, enp3s0, enx…, the JS IFACE_RE), also a port that is down — its
# profile is saved and NetworkManager brings it up when a cable is plugged in; and Wi-Fi (the server has no session,
# so polkit denies it scanning / saving system profiles — this helper runs as root through sudoers).
set -euo pipefail

MODE="${1:-}"
IFACE="${2:-}"
NETWORKD_DIR="${HIGHASCG_NETWORKD_DIR:-/etc/systemd/network}"
SYS_NET="${HIGHASCG_SYS_NET:-/sys/class/net}"
OPERATOR_NET="${NETWORKD_DIR}/80-highascg-operator.network"

case "$MODE" in
dhcp | static | wifi-scan | wifi-connect | wifi-disconnect | wifi-radio) ;;
*)
	echo "Usage: $0 dhcp|static|wifi-scan|wifi-connect|wifi-disconnect|wifi-radio <iface> ..." >&2
	exit 2
	;;
esac

if [[ "$MODE" == "wifi-radio" ]]; then
	[[ "$IFACE" == "on" || "$IFACE" == "off" ]] || { echo "wifi-radio on|off" >&2; exit 2; }
	nmcli radio wifi "$IFACE"
	echo "Wi-Fi radio $IFACE"
	exit 0
fi

if [[ "$MODE" == wifi-* ]]; then
	if [[ ! "$IFACE" =~ ^wl[a-z0-9]+$ ]]; then
		echo "Rejected Wi-Fi interface name: $IFACE" >&2
		exit 2
	fi
	case "$MODE" in
	wifi-scan)
		nmcli radio wifi on
		nmcli dev wifi rescan ifname "$IFACE" 2>/dev/null || true # "scanning not allowed" right after one is fine
		sleep 3
		echo "Scanned on $IFACE"
		;;
	wifi-connect)
		SSID="${3:-}"
		if [[ -z "$SSID" || ${#SSID} -gt 32 ]]; then
			echo "wifi-connect needs an SSID (1-32 bytes)" >&2
			exit 2
		fi
		PSK=""
		IFS= read -r PSK || true
		nmcli radio wifi on
		# One profile per SSID, named after it; rewritten each time so a changed password takes.
		CONN="highascg-wifi-${SSID}"
		nmcli con delete "$CONN" >/dev/null 2>&1 || true
		nmcli con add type wifi ifname "$IFACE" con-name "$CONN" ssid "$SSID" autoconnect yes >/dev/null
		if [[ -n "$PSK" ]]; then
			nmcli con mod "$CONN" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK"
		fi
		if ! nmcli --wait 40 con up "$CONN" ifname "$IFACE"; then
			nmcli con delete "$CONN" >/dev/null 2>&1 || true
			echo "Could not join \"$SSID\" (wrong password or out of range)" >&2
			exit 4
		fi
		echo "Connected $IFACE to \"$SSID\""
		;;
	wifi-disconnect)
		nmcli dev disconnect "$IFACE"
		echo "Disconnected $IFACE"
		;;
	esac
	exit 0
fi

if [[ ! "$IFACE" =~ ^(eth[0-9]+|en[a-z0-9]+)$ ]]; then
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

# An inactive profile (port down) shows no DEVICE above: reuse ours by name rather than adding a duplicate (WO-692).
if [[ -z "$CONN" ]] && nmcli -t -f NAME con show 2>/dev/null | grep -Fxq "highascg-${IFACE}"; then
	CONN="highascg-${IFACE}"
fi
if [[ -z "$CONN" ]]; then
	CONN="highascg-${IFACE}"
	nmcli con add type ethernet ifname "$IFACE" con-name "$CONN" autoconnect yes >/dev/null
fi

# WO-692: a port NetworkManager leaves alone gets managed, and a port without a cable keeps the saved profile
# (autoconnect) instead of failing — it comes up with these settings when it is plugged in.
if [[ "$(iface_nm_state)" == "unmanaged" ]]; then
	nmcli dev set "$IFACE" managed yes || true
fi
# The live image also runs systemd-networkd DHCP on every en*/eth* port (10-live-wired.network, WO-94), so a port set
# here carried a second, DHCP address next to the one asked for. A port the operator sets is NetworkManager's alone:
# an earlier-sorting networkd file marks it unmanaged (first match wins), and its old addresses go before NM's.
hand_to_nm() {
	local f="${NETWORKD_DIR}/05-highascg-nm-${IFACE}.network"
	[[ -d "$NETWORKD_DIR" ]] || return 0
	if [[ ! -f "$f" ]]; then
		printf '[Match]\nName=%s\n\n[Link]\nUnmanaged=yes\n' "$IFACE" >"$f"
		chmod 644 "$f"
		networkctl reload 2>/dev/null || true
		ip -4 addr flush dev "$IFACE" 2>/dev/null || true
	fi
}
hand_to_nm
bring_up() {
	if [[ "$(cat "${SYS_NET}/${IFACE}/carrier" 2>/dev/null || echo 0)" != "1" ]]; then
		nmcli con mod "$CONN" connection.autoconnect yes
		echo "$IFACE has no link — saved; applies when a cable is connected"
		return 0
	fi
	nmcli con up "$CONN" ifname "$IFACE"
}

if [[ "$MODE" == "dhcp" ]]; then
	# ipv4.link-local 2 = fallback when DHCP fails (WO-94)
	nmcli con mod "$CONN" ipv4.method auto ipv4.link-local 2 ipv4.addresses "" ipv4.gateway "" ipv4.dns ""
	bring_up
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
bring_up
echo "Applied static $ADDR on $IFACE ($CONN)"
