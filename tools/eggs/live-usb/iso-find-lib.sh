#!/usr/bin/env bash
# Find the newest built HighAsCG ISO in the eggs nest (WO-870 names). Split out of the retired
# flash-stick-common.sh (WO-996: sticks are Ventoy-only, the ISO is copied, never flashed).
# shellcheck shell=bash

find_latest_iso() {
	find_newest_iso_since 0 "${BASENAME:-}"
}

# Newest *.iso in the eggs nest (/home/eggs, EGGS_NEST) + its legacy mnt/, written at or after EPOCH (0 = any).
# Optional BASENAME prefix filter; both flavors' names match (WO-870): new `BASENAME-<date>.iso` (coa iso_prefix),
# legacy `BASENAME_<arch>_<date>.iso`. A coa target_dir ISO is a symlink in the nest — stat -L dates the ISO itself.
find_newest_iso_since() {
	local since="${1:-0}"
	local prefix="${2:-}"
	local nest="${EGGS_NEST:-/home/eggs}"
	local latest="" t=0 f ts dir base
	shopt -s nullglob
	for dir in "$nest" "${nest}/mnt"; do
		[[ -d "$dir" ]] || continue
		for f in "${dir}"/*.iso; do
			[[ -f "$f" ]] || continue
			if [[ -n "$prefix" ]]; then
				base="${f##*/}"
				[[ "$base" == "${prefix}-"* ]] || [[ "$base" == "${prefix}_"* ]] || continue
			fi
			ts=$(stat -L -c %Y "$f" 2>/dev/null) || continue
			((ts >= since)) || continue
			if ((ts >= t)); then
				t=$ts
				latest=$f
			fi
		done
	done
	shopt -u nullglob
	[[ -n "$latest" ]] || {
		echo "No *.iso under ${nest}/ (since epoch ${since}${prefix:+, name ${prefix}-* or ${prefix}_*})." >&2
		return 1
	}
	printf '%s' "$latest"
}

