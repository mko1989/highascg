#!/usr/bin/env bash
# Post-boot health checks for live stick / playout host (read-only).
# Baked into squashfs under tools/startup/ — safe to run over SSH after boot.
#
# Usage (on booted machine):
#   bash ~/highascg/tools/startup/run-health-checks.sh
#   bash ~/highascg/tools/startup/run-health-checks.sh --quick
#   bash ~/highascg/tools/startup/run-health-checks.sh --stick-only
#   bash ~/highascg/tools/startup/run-health-checks.sh --sudo-only
#
# Options forwarded to stick-boot-test: --quick --verbose --list
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STICK_ONLY=false
QA_ONLY=false
SUDO_ONLY=false
STICK_ARGS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
	--stick-only) STICK_ONLY=true ;;
	--qa-only) QA_ONLY=true ;;
	--sudo-only) SUDO_ONLY=true ;;
	--quick | --verbose | -v | --list) STICK_ARGS+=("$1") ;;
	-h | --help)
		sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*) echo "Unknown option: $1 (try --help)" >&2; exit 2 ;;
	esac
	shift
done

MODE_COUNT=0
"$STICK_ONLY" && MODE_COUNT=$((MODE_COUNT + 1))
"$QA_ONLY" && MODE_COUNT=$((MODE_COUNT + 1))
"$SUDO_ONLY" && MODE_COUNT=$((MODE_COUNT + 1))
if [[ "$MODE_COUNT" -gt 1 ]]; then
	echo "Use only one of --stick-only, --qa-only, --sudo-only" >&2
	exit 2
fi

FAIL=0
banner() {
	echo ""
	echo "########################################"
	echo "# $*"
	echo "########################################"
}

run_verify_caspar_autostart() {
	banner "Caspar autostart (systemd)"
	bash "${HERE}/verify-caspar-autostart.sh" || FAIL=$((FAIL + 1))
}

run_verify_passwordless_sudo() {
	banner "Passwordless sudo (Tailscale, Calamares, Caspar)"
	bash "${HERE}/verify-passwordless-sudo.sh" || FAIL=$((FAIL + 1))
}

run_verify_live_stick() {
	banner "Live stick: persistence, exFAT, branding, Calamares"
	bash "${HERE}/verify-live-stick.sh" || FAIL=$((FAIL + 1))
}

run_stick_boot_qa() {
	banner "Stick boot QA modules"
	bash "${HERE}/stick-boot-test/run-stick-boot-tests.sh" "${STICK_ARGS[@]}" || FAIL=$((FAIL + 1))
}

echo "HighAsCG post-boot health checks"
echo "  host: $(hostname)"
echo "  time: $(date -Is)"
echo "  root: ${HERE}"

if "$QA_ONLY"; then
	run_stick_boot_qa
elif "$SUDO_ONLY"; then
	run_verify_passwordless_sudo
elif "$STICK_ONLY"; then
	run_verify_live_stick
else
	run_verify_passwordless_sudo
	run_verify_caspar_autostart
	run_verify_live_stick
	run_stick_boot_qa
fi

echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "Health checks FAILED (${FAIL} suite(s) reported errors)."
	exit 1
fi
echo "Health checks complete."
exit 0
