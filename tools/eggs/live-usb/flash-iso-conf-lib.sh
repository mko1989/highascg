#!/usr/bin/env bash
# Shared KEY=value parsing for tools/live-usb/flash-iso.conf
# Source from other scripts:  source "${HERE}/flash-iso-conf-lib.sh"
#
# shellcheck shell=bash

declare -gA FLASH_ISO_KV=()

flash_iso_die() {
	echo "Error: $*" >&2
	exit 1
}

flash_iso_trim() {
	local s="$1"
	s="${s#"${s%%[![:space:]]*}"}"
	s="${s%"${s##*[![:space:]]}"}"
	printf '%s' "$s"
}

flash_iso_strip_inline_comment() {
	local s="$1"
	if [[ "$s" == *"#"* ]]; then
		local q=false i=0 ch out=""
		for ((i = 0; i < ${#s}; i++)); do
			ch=${s:i:1}
			if [[ "$ch" == '"' ]]; then
				q=$([[ "$q" == false ]] && echo true || echo false)
			fi
			if [[ "$ch" == '#' && "$q" == false ]]; then
				break
			fi
			out+=$ch
		done
		s=$out
	fi
	printf '%s' "$s"
}

flash_iso_load_conf() {
	local path="$1" line key val u
	FLASH_ISO_KV=()
	[[ -f "$path" ]] || flash_iso_die "Config not found: $path"
	while IFS= read -r line || [[ -n "$line" ]]; do
		line=$(flash_iso_trim "$line")
		[[ -z "$line" ]] && continue
		[[ "$line" =~ ^# ]] && continue
		line=$(flash_iso_strip_inline_comment "$line")
		line=$(flash_iso_trim "$line")
		[[ -z "$line" ]] && continue
		[[ "$line" != *"="* ]] && flash_iso_die "Invalid line (expected KEY=value): $line"
		key=$(flash_iso_trim "${line%%=*}")
		val=$(flash_iso_trim "${line#*=}")
		if [[ "$val" == '"'*'"' ]]; then
			val=${val:1:${#val}-2}
		fi
		[[ -n "$key" ]] || flash_iso_die "Empty key in: $line"
		u=$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')
		FLASH_ISO_KV[$u]=$val
	done <"$path"
}

flash_iso_get() {
	local a u
	for a in "$@"; do
		u=$(printf '%s' "$a" | tr '[:lower:]' '[:upper:]')
		if [[ -n "${FLASH_ISO_KV[$u]+x}" ]]; then
			printf '%s' "${FLASH_ISO_KV[$u]}"
			return 0
		fi
	done
	return 1
}

flash_iso_expand_tilde() {
	local p="$1"
	if [[ "$p" == "~/"* ]]; then
		printf '%s' "${HOME}/${p:2}"
	elif [[ "$p" == "~" ]]; then
		printf '%s' "${HOME}"
	else
		printf '%s' "$p"
	fi
}

# Load path and print DEVICE (or DEV / USB / DISK / TARGET). Exits on error.
flash_iso_read_device() {
	local path="$1" d
	flash_iso_load_conf "$path"
	d=$(flash_iso_get DEVICE DEV USB DISK TARGET) || flash_iso_die "Config must set DEVICE= (or DEV= / USB= / DISK= / TARGET=) in $path"
	d=$(flash_iso_trim "$d")
	[[ -n "$d" ]] || flash_iso_die "DEVICE is empty in $path"
	printf '%s' "$d"
}
