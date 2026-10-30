#!/usr/bin/env bash
# WO-848: which libcef.so does Caspar load? Read-only; no root needed (root only adds other users' /proc maps).
#
#   bash scripts/setup/check-cef-caspar.sh            # report + exit 0 (green) / 1 (FAIL)
#   bash scripts/setup/check-cef-caspar.sh --quiet    # only WARN/FAIL lines and the verdict
#
# Green = the libcef.so Caspar maps (live process) and would resolve (as run.sh starts it, and bare) is the
# playout bundle's ~/highascg/lib/libcef.so, and that file matches CEF_LIBCEF_SHA256 (install-config.sh).
# WARN = not wrong today but fragile: a RUNPATH outside the bundle (build tree, empty entry = working dir), a
# libcef in the linker cache, a /usr/lib/cef copy that differs from the bundle. Other apps' private CEF copies
# (e.g. /opt/zoom/cef) are listed for information only.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=../lib/install-config.sh
source "${REPO_ROOT}/scripts/lib/install-config.sh" 2>/dev/null || true

ROOT="${CASPAR_ROOT:-${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}}"
LIB="${CASPAR_LIB:-${ROOT}/lib}"
BIN="${CASPAR_BIN:-${ROOT}/bin/casparcg}"
WANT="${CEF_LIBCEF_SHA256:-}"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1

fails=0
warns=0
say() { [ "$QUIET" = 1 ] || echo "$*"; }
ok() { say "  OK    $*"; }
info() { say "  ..    $*"; }
warn() { echo "  WARN  $*"; warns=$((warns + 1)); }
fail() { echo "  FAIL  $*"; fails=$((fails + 1)); }
real() { readlink -f -- "$1" 2>/dev/null || echo "$1"; }
sha() { sha256sum -- "$1" 2>/dev/null | cut -d' ' -f1; }
# The libcef.so path ldd resolves for $BIN with the given LD_LIBRARY_PATH ('' = unset), or "not found".
resolve() {
	local out
	if [ -n "$1" ]; then
		out=$(cd / && LD_LIBRARY_PATH="$1" ldd "$BIN" 2>/dev/null | awk '$1 == "libcef.so" {print $3}')
	else
		out=$(cd / && env -u LD_LIBRARY_PATH ldd "$BIN" 2>/dev/null | awk '$1 == "libcef.so" {print $3}')
	fi
	echo "${out:-not found}"
}

say "== Caspar bundle"
BUNDLE_CEF="${LIB}/libcef.so"
if [ ! -f "$BUNDLE_CEF" ]; then
	fail "no ${BUNDLE_CEF} — run: sudo bash scripts/setup/reinstall-cef.sh"
	BUNDLE_SHA=""
else
	BUNDLE_SHA=$(sha "$BUNDLE_CEF")
	info "${BUNDLE_CEF} sha256 ${BUNDLE_SHA}"
	if [ -z "$WANT" ]; then
		warn "no CEF_LIBCEF_SHA256 pin in install-config.sh — bundle not verified"
	elif [ "$BUNDLE_SHA" = "$WANT" ]; then
		ok "bundle libcef.so matches the pin (CEF ${CASPAR_CEF_VERSION:-?})"
	else
		fail "bundle libcef.so differs from the pin ${WANT}"
	fi
	for f in icudtl.dat resources.pak v8_context_snapshot.bin libEGL.so libGLESv2.so; do
		[ -f "${LIB}/${f}" ] || fail "${LIB}/${f} missing (CEF starts without it, then fails)"
	done
	[ -d "${LIB}/locales" ] || fail "${LIB}/locales missing"
fi
[ -r /etc/highascg/cef-version ] && info "/etc/highascg/cef-version: $(cat /etc/highascg/cef-version)"

say "== Binary ${BIN}"
if [ ! -x "$BIN" ]; then
	fail "no executable ${BIN}"
else
	RUNPATH=$(readelf -d "$BIN" 2>/dev/null | sed -n 's/.*(\(RUNPATH\|RPATH\)).*\[\(.*\)\]/\2/p')
	if [ -z "$RUNPATH" ]; then
		info "no RUNPATH — libcef only via LD_LIBRARY_PATH (run.sh)"
	elif [ "$RUNPATH" = '$ORIGIN/../lib' ]; then
		ok "RUNPATH \$ORIGIN/../lib (the bundle, wherever it is started from)"
	else
		warn "RUNPATH [${RUNPATH}] points outside the bundle$(case ":${RUNPATH}:" in *::*) echo ' and has an empty entry (= the working directory)' ;; esac); rebuild with ~/caspar-build/build-26.sh (WO-848)"
	fi
	R_RUN=$(resolve "$LIB")
	if [ "$(real "$R_RUN")" = "$(real "$BUNDLE_CEF")" ]; then
		ok "as run.sh starts it (LD_LIBRARY_PATH=${LIB}): ${R_RUN}"
	else
		fail "as run.sh starts it, libcef.so resolves to ${R_RUN}, not ${BUNDLE_CEF}"
	fi
	R_BARE=$(resolve "")
	if [ "$(real "$R_BARE")" = "$(real "$BUNDLE_CEF")" ]; then
		ok "started bare (no LD_LIBRARY_PATH): ${R_BARE}"
	elif [ "$R_BARE" = "not found" ]; then
		warn "started bare (no LD_LIBRARY_PATH) libcef.so is not found — only run.sh can start it"
	else
		warn "started bare (no LD_LIBRARY_PATH) libcef.so resolves to ${R_BARE} (outside the bundle)"
	fi
fi

say "== Running Caspar"
found=0
for pid in $(pgrep -x casparcg 2>/dev/null); do
	tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null | grep -q -- '--type=' && continue # CEF helper processes
	exe=$(readlink "/proc/${pid}/exe" 2>/dev/null) || continue
	maps=$(grep -o '/[^ ]*libcef\.so[^ ]*' "/proc/${pid}/maps" 2>/dev/null | sort -u)
	[ -n "$maps" ] || continue
	found=1
	for m in $maps; do
		if [ "$(real "$m")" = "$(real "$BUNDLE_CEF")" ]; then
			ok "pid ${pid} (${exe}) maps ${m}"
		else
			fail "pid ${pid} (${exe}) maps ${m} — not the bundle's libcef.so"
		fi
	done
done
[ "$found" = 1 ] || info "no running casparcg with libcef mapped"

say "== Other libcef.so on this host"
if ldconfig -p 2>/dev/null | grep -q 'libcef\.so'; then
	warn "libcef.so is in the linker cache (a binary without RUNPATH/LD_LIBRARY_PATH would take it):"
	ldconfig -p | grep 'libcef\.so' | sed 's/^/        /'
else
	ok "no libcef.so in the linker cache (ldconfig -p)"
fi
for c in /usr/lib/cef/*/*/libcef.so /usr/lib/casparcg-cef-*/libcef.so /usr/local/lib/*/libcef.so /opt/*/libcef.so /opt/*/*/libcef.so; do
	[ -e "$c" ] || continue
	[ "$(real "$c")" = "$(real "$BUNDLE_CEF")" ] && { info "${c} -> the bundle (symlink)"; continue; }
	owner=$(dpkg -S "$c" 2>/dev/null | cut -d: -f1)
	s=$(sha "$c")
	case "$c" in
	/usr/lib/cef/* | /usr/lib/casparcg-cef-*)
		if [ -n "$BUNDLE_SHA" ] && [ "$s" = "$BUNDLE_SHA" ]; then
			info "${c} = copy of the bundle (not on Caspar's loader path)"
		else
			warn "${c} differs from the bundle${owner:+ (package ${owner})} — not loaded by Caspar, stale"
		fi
		;;
	*) info "${c}${owner:+ (package ${owner})} — another app's private CEF, ignored" ;;
	esac
done

echo
if [ "$fails" -gt 0 ]; then
	echo "CEF check: FAIL (${fails} fail, ${warns} warn)"
	exit 1
fi
echo "CEF check: OK (${warns} warn)"
exit 0
