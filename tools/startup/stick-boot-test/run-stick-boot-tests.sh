#!/usr/bin/env bash
# Run read-only QA after booting from the operator USB stick (or live ISO).
# Does not modify the system — report only.
#
# Usage (on booted playout machine):
#   bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh
#   bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh --quick
#   bash ~/highascg/tools/startup/stick-boot-test/run-stick-boot-tests.sh --list
#
# Exit: 0 if no FAIL; 1 if any FAIL (WARN alone still exits 0).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=stick-test-lib.sh
source "${HERE}/stick-test-lib.sh"

LIST_ONLY=false
while [[ $# -gt 0 ]]; do
	case "$1" in
	--quick) ST_QUICK=1 ;;
	--verbose | -v) ST_VERBOSE=1 ;;
	--list) LIST_ONLY=true ;;
	-h | --help)
		sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
	shift
done

TESTS=(
	test-01-live-identity.sh
	test-02-stick-layout.sh
	test-03-exfat-operator.sh
	test-04-drop-update.sh
	test-05-systemd-wo47.sh
	test-06-caspar-supervisor.sh
	test-07-amcp-playout.sh
	test-08-highascg-ui.sh
	test-09-openbox-wiring.sh
	test-10-boot-journal.sh
	test-11-replication-trust.sh
)

if "$LIST_ONLY"; then
	printf '%s\n' "${TESTS[@]}"
	exit 0
fi

echo "HighAsCG stick boot QA (read-only)"
echo "  host:     $(hostname)"
echo "  time:     $(date -Is)"
echo "  playout:  ${PLAYOUT}"
echo "  quick:    ${ST_QUICK}"

for t in "${TESTS[@]}"; do
	path="${HERE}/tests/${t}"
	[[ -x "$path" ]] || chmod +x "$path" 2>/dev/null || true
	if [[ ! -f "$path" ]]; then
		st_fail "missing test script: ${t}"
		continue
	fi
	# shellcheck source=/dev/null
	. "$path"
done

st_summary
exit $((ST_FAIL > 0 ? 1 : 0))
