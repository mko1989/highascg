# Shared helpers for stick boot QA (read-only — no fixes).
# shellcheck shell=bash
# Usage: source "$(dirname "$0")/stick-test-lib.sh"

: "${ST_FAIL:=0}"
: "${ST_WARN:=0}"
: "${ST_PASS:=0}"
: "${ST_VERBOSE:=0}"
: "${ST_QUICK:=0}"

PLAYOUT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
EXFAT="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
DROP="${EXFAT}/drop-update"

st_section() {
	echo ""
	echo "=== $* ==="
}

st_ok() {
	ST_PASS=$((ST_PASS + 1))
	echo "PASS: $*"
}

st_warn() {
	ST_WARN=$((ST_WARN + 1))
	echo "WARN: $*" >&2
}

st_fail() {
	ST_FAIL=$((ST_FAIL + 1))
	echo "FAIL: $*" >&2
}

st_skip() {
	echo "SKIP: $*"
}

st_is_live_session() {
	[[ -d /run/live ]] || grep -qE 'overlay|aufs' /proc/mounts 2>/dev/null
}

st_exfat_label_mounted() {
	local mp dev
	mp="$(findmnt -n -o TARGET -L HIGHASCGEXF 2>/dev/null || true)"
	if [[ -n "$mp" ]]; then
		return 0
	fi
	if mountpoint -q "${EXFAT}" 2>/dev/null; then
		dev="$(findmnt -n -o SOURCE "${EXFAT}" 2>/dev/null || true)"
		if [[ "$dev" == *HIGHASCGEXF* ]] || blkid -s LABEL -o value "$dev" 2>/dev/null | grep -qx HIGHASCGEXF; then
			return 0
		fi
	fi
	return 1
}

st_summary() {
	echo ""
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "Stick boot test summary: PASS=${ST_PASS} WARN=${ST_WARN} FAIL=${ST_FAIL}"
	if [[ "$ST_FAIL" -gt 0 ]]; then
		echo "Result: FAILED"
		return 1
	fi
	if [[ "$ST_WARN" -gt 0 ]]; then
		echo "Result: PASSED WITH WARNINGS"
		return 0
	fi
	echo "Result: PASSED"
	return 0
}
