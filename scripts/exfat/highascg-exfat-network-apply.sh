#!/usr/bin/env bash
# Apply operator network settings from exFAT network/network.conf (WO-95).
#
# Reads /home/casparcg/exfat/network/network.conf (INI-style), validates, and
# delegates to highascg-network-apply.sh (WO-59). Idempotent via content hash.
#
# Usage:
#   highascg-exfat-network-apply.sh [--boot] [--force] [--dry-run] [--verbose]
set -euo pipefail

EXFAT_MP="/home/casparcg/exfat"
CONF="${EXFAT_MP}/network/network.conf"
STATE_DIR=/var/lib/highascg
STATE_FILE="${STATE_DIR}/last-exfat-network.hash"
SOURCE_FILE="${STATE_DIR}/network-config-source"
APPLY_SCRIPT=/usr/local/lib/highascg/highascg-network-apply.sh
LOG=/var/log/highascg/exfat-network-apply.log

BOOT=0
FORCE=0
DRY_RUN=0
VERBOSE=0

log() {
	local line="[$(date -Iseconds)] $*"
	echo "$line" | tee -a "$LOG" >&2
	logger -t highascg-exfat-network -- "$*" 2>/dev/null || true
}

vlog() {
	[[ "$VERBOSE" -eq 1 ]] && log "$@"
}

usage() {
	echo "Usage: $0 [--boot] [--force] [--dry-run] [--verbose]" >&2
	exit 2
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--boot) BOOT=1 ;;
		--force) FORCE=1 ;;
		--dry-run) DRY_RUN=1 ;;
		--verbose) VERBOSE=1 ;;
		-h | --help) usage ;;
		*) echo "Unknown option: $1" >&2; usage ;;
	esac
	shift
done

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root" >&2
	exit 1
}

mkdir -p "$(dirname "$LOG")" "$STATE_DIR"
touch "$LOG"

if ! mountpoint -q "$EXFAT_MP" 2>/dev/null; then
	log "skip: ${EXFAT_MP} not mounted"
	exit 0
fi

if [[ ! -f "$CONF" ]]; then
	log "skip: no ${CONF}"
	rm -f "$STATE_FILE" "$SOURCE_FILE" 2>/dev/null || true
	exit 0
fi

if [[ ! -x "$APPLY_SCRIPT" ]]; then
	log "error: network apply helper missing (${APPLY_SCRIPT})"
	exit 3
fi

hash_conf() {
	sha256sum "$CONF" | awk '{print $1}'
}

CUR_HASH="$(hash_conf)"
if [[ "$FORCE" -eq 0 && -f "$STATE_FILE" ]]; then
	PREV_HASH="$(tr -d '[:space:]' <"$STATE_FILE" || true)"
	if [[ -n "$PREV_HASH" && "$PREV_HASH" == "$CUR_HASH" ]]; then
		vlog "skip: ${CONF} unchanged (hash ${CUR_HASH:0:12}…)"
		exit 0
	fi
fi

# shellcheck disable=SC2034
declare -A CFG=()
UNKNOWN_KEYS=()

parse_conf() {
	local line key val
	while IFS= read -r line || [[ -n "$line" ]]; do
		line="${line%%#*}"
		line="${line%%;*}"
		line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
		[[ -z "$line" ]] && continue
		[[ "$line" != *=* ]] && continue
		key="${line%%=*}"
		val="${line#*=}"
		key="$(echo "$key" | tr '[:upper:]' '[:lower:]' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
		val="$(echo "$val" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
		case "$key" in
			mode | interface | address | prefix | gateway | dns | hostname | tailscale)
				CFG["$key"]="$val"
				;;
			*)
				UNKNOWN_KEYS+=("$key")
				;;
		esac
	done <"$CONF"
}

parse_conf

if [[ ${#UNKNOWN_KEYS[@]} -gt 0 ]]; then
	log "note: ignoring unknown keys: $(printf '%s ' "${UNKNOWN_KEYS[@]}")"
fi

MODE="${CFG[mode]:-dhcp}"
MODE="$(echo "$MODE" | tr '[:upper:]' '[:lower:]')"
IFACE="${CFG[interface]:-}"

iface_allowed() {
	[[ "${1:-}" =~ ^(eth|enp|eno)[0-9]+$ ]]
}

pick_iface() {
	if [[ -n "$IFACE" ]]; then
		iface_allowed "$IFACE" || return 1
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
	return 1
}

valid_ipv4() {
	local ip="${1:-}" parts
	[[ -n "$ip" ]] || return 1
	IFS=. read -r -a parts <<<"$ip"
	[[ ${#parts[@]} -eq 4 ]] || return 1
	local p
	for p in "${parts[@]}"; do
		[[ "$p" =~ ^[0-9]+$ ]] || return 1
		((p >= 0 && p <= 255)) || return 1
	done
	return 0
}

IFACE="$(pick_iface)" || {
	log "error: invalid or missing interface in ${CONF} (interface=${IFACE:-auto})"
	exit 4
}

if [[ "$MODE" != "dhcp" && "$MODE" != "static" ]]; then
	log "error: invalid mode=${MODE} in ${CONF} (expected dhcp or static)"
	exit 4
fi

APPLY_ARGS=()
if [[ "$MODE" == "dhcp" ]]; then
	APPLY_ARGS=(dhcp "$IFACE")
else
	ADDR="${CFG[address]:-}"
	PREFIX="${CFG[prefix]:-}"
	GW="${CFG[gateway]:-}"
	DNS="${CFG[dns]:-}"
	if [[ -z "$ADDR" || -z "$PREFIX" ]]; then
		log "error: static mode requires address= and prefix= in ${CONF}"
		exit 4
	fi
	if ! [[ "$PREFIX" =~ ^[0-9]+$ ]] || ((PREFIX < 1 || PREFIX > 32)); then
		log "error: invalid prefix=${PREFIX} in ${CONF}"
		exit 4
	fi
	if ! valid_ipv4 "$ADDR"; then
		log "error: invalid address=${ADDR} in ${CONF}"
		exit 4
	fi
	if [[ -n "$GW" ]] && ! valid_ipv4 "$GW"; then
		log "error: invalid gateway=${GW} in ${CONF}"
		exit 4
	fi
	if [[ -n "$DNS" ]]; then
		IFS=',' read -r -a dns_parts <<<"$DNS"
		for dns_part in "${dns_parts[@]}"; do
			dns_part="$(echo "$dns_part" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
			[[ -z "$dns_part" ]] && continue
			if ! valid_ipv4 "$dns_part"; then
				log "error: invalid dns entry=${dns_part} in ${CONF}"
				exit 4
			fi
		done
		DNS="$(echo "$DNS" | tr -d ' ')"
	fi
	APPLY_ARGS=(static "$IFACE" "$ADDR" "$PREFIX" "$GW" "$DNS")
fi

log "apply: mode=${MODE} iface=${IFACE} from ${CONF}"
vlog "  args: ${APPLY_SCRIPT} ${APPLY_ARGS[*]}"

if [[ "$DRY_RUN" -eq 1 ]]; then
	log "dry-run: would run ${APPLY_SCRIPT} ${APPLY_ARGS[*]}"
	exit 0
fi

if ! out="$("$APPLY_SCRIPT" "${APPLY_ARGS[@]}" 2>&1)"; then
	log "error: apply failed: ${out}"
	exit 5
fi
log "ok: ${out}"
echo "$CUR_HASH" >"$STATE_FILE"
echo exfat >"$SOURCE_FILE"
exit 0
