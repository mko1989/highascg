#!/usr/bin/env bash
# Verify eggs pipeline never rm's under /home/eggs and preflight is wired correctly.
#   bash tools/eggs/live-usb/verify-eggs-safety.sh
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIVE_USB="${REPO}/tools/eggs/live-usb"
WORK="${REPO}/work"
ok=0
fail=0

check() {
	if eval "$2"; then
		echo "OK: $1"
		ok=$((ok + 1))
	else
		echo "FAIL: $1"
		fail=$((fail + 1))
	fi
}

check "clean-eggs-workspace-before-produce.sh removed" '[[ ! -f "${LIVE_USB}/clean-eggs-workspace-before-produce.sh" ]]'
check "refresh-squashfs-plymouth-branding.sh removed" '[[ ! -f "${LIVE_USB}/refresh-squashfs-plymouth-branding.sh" ]]'
check "pre-produce-preflight.sh exists" '[[ -x "${LIVE_USB}/pre-produce-preflight.sh" ]]'
check "build-highascg-egg.sh uses pre-produce-preflight" 'grep -q pre-produce-preflight "${LIVE_USB}/build-highascg-egg.sh" 2>/dev/null'
check "produce-clone-only uses pre-produce-preflight" 'grep -q pre-produce-preflight "${WORK}/run-eggs-produce-clone-only.sh" 2>/dev/null'
check "no HIGHASCG_CONFIRM_LIVEROOT_DISCARD in produce scripts" \
	'! grep -q HIGHASCG_CONFIRM_LIVEROOT_DISCARD "${LIVE_USB}/build-highascg-egg.sh" "${LIVE_USB}/pre-produce-preflight.sh" "${WORK}/run-eggs-produce-clone-only.sh" "${WORK}/run-eggs-produce-from-host.sh" 2>/dev/null'
check "no executable rm -rf under /home/eggs in produce scripts" \
	'! grep -E "^[[:space:]]*rm -rf" "${LIVE_USB}/build-highascg-egg.sh" "${LIVE_USB}/pre-produce-preflight.sh" "${WORK}/run-eggs-produce-clone-only.sh" 2>/dev/null | grep -qE "/home/eggs|liveroot"'

echo "---"
if [[ "$fail" -eq 0 ]]; then
	echo "Eggs safety checks passed (${ok})."
	exit 0
fi
echo "${fail} check(s) failed."
exit 1
