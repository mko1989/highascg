#!/usr/bin/env bash
# Ensure tools/startup exists on the clone host before eggs produce (baked into squashfs).
#
#   bash tools/eggs/live-usb/verify-startup-on-host.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
STARTUP="${HIGHASCG_ROOT}/tools/startup"
FAIL=0

fail() { echo "ERROR: $*" >&2; FAIL=$((FAIL + 1)); }
ok() { echo "OK: $*"; }

echo "==> tools/startup on clone host (must be in squashfs after produce)"

for req in \
	run-health-checks.sh \
	verify-live-stick.sh \
	verify-passwordless-sudo.sh \
	stick-boot-test/run-stick-boot-tests.sh; do
	if [[ -f "${STARTUP}/${req}" ]]; then
		ok "${STARTUP}/${req}"
	else
		fail "missing ${STARTUP}/${req} — sync/pull highascg repo before prepare + produce"
	fi
done

if [[ "$FAIL" -gt 0 ]]; then
	echo "tools/startup host verify FAILED." >&2
	exit 1
fi
echo "tools/startup host verify passed."
exit 0
