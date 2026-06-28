#!/usr/bin/env bash
# Check-only: host is ready for eggs produce. Does NOT install or modify the system.
#
#   sudo bash tools/eggs/live-usb/verify-eggs-prepare-host.sh
#
# To install missing pieces (separate step):
#   scripts/setup/*.sh  and/or  prepare-eggs-clone-with-exfat.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
USER_CASPAR="${USER_CASPAR:-casparcg}"
EXCLUDE="${EGGS_EXCLUDE_LIST:-/etc/penguins-eggs.d/exclude.list}"
EGGS_LIVECD="${EGGS_LIVECD:-/usr/lib/penguins-eggs/addons/eggs/theme/livecd}"
FAIL=0

fail() {
	echo "ERROR: $*" >&2
	FAIL=$((FAIL + 1))
}
ok() {
	echo "OK: $*"
}

need_pkg() {
	local pkg="$1" hint="$2"
	if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -qE '(install|hold) ok installed'; then
		ok "package ${pkg}"
	else
		fail "missing package ${pkg} — ${hint}"
	fi
}

need_path() {
	local path="$1" hint="$2"
	if [[ -e "$path" ]]; then
		ok "present: ${path}"
	else
		fail "missing: ${path} — ${hint}"
	fi
}

need_cmd() {
	local cmd="$1" hint="$2"
	if command -v "$cmd" >/dev/null 2>&1; then
		ok "command ${cmd}"
	else
		fail "missing command ${cmd} — ${hint}"
	fi
}

echo "==> Eggs prepare verify (check-only, no installs)"

need_cmd eggs "sudo bash ${REPO_ROOT}/work/setup-boot-branding-phase1.sh"
[[ -d "$EGGS_LIVECD" ]] && ok "eggs livecd theme ${EGGS_LIVECD}" \
	|| fail "missing ${EGGS_LIVECD} — install penguins-eggs"

if [[ -f /etc/highascg/pinned-kernel ]]; then
	ok "pinned kernel $(cat /etc/highascg/pinned-kernel)"
else
	fail "missing /etc/highascg/pinned-kernel — sudo bash ${REPO_ROOT}/scripts/setup/01-kernel-117.sh"
fi

if [[ "$(uname -r)" == "$(cat /etc/highascg/pinned-kernel 2>/dev/null)" ]]; then
	ok "running kernel matches pin"
else
	fail "running $(uname -r) != pin $(cat /etc/highascg/pinned-kernel 2>/dev/null) — reboot after kernel setup"
fi

need_pkg exfatprogs "sudo apt install exfatprogs (or run prepare-eggs-clone-with-exfat.sh)"
need_pkg parted "sudo apt install parted"
need_pkg python3 "sudo apt install python3"
need_pkg rsync "sudo apt install rsync"
if dpkg-query -W -f='${Status}' nginx 2>/dev/null | grep -qE '(install|hold) ok installed'; then
	ok "package nginx (port 80 proxy)"
else
	fail "missing package nginx — sudo bash ${HERE}/prepare-eggs-clone-with-exfat.sh"
fi

bash "${HERE}/verify-highascg-stick-boot.sh"

getent passwd "$USER_CASPAR" >/dev/null 2>&1 && ok "user ${USER_CASPAR}" \
	|| fail "missing user ${USER_CASPAR} — sudo bash ${REPO_ROOT}/scripts/setup/05-caspar-deps.sh"

need_path "${HIGHASCG_ROOT}/package.json" "clone HighAsCG to ${HIGHASCG_ROOT}"
need_path "${HIGHASCG_ROOT}/bin/casparcg" "restore/bake Caspar binary"
need_path "${HIGHASCG_ROOT}/lib/libcef.so" "sudo bash ${REPO_ROOT}/scripts/setup/08-caspar-cef-scanner.sh"
need_path "${HIGHASCG_ROOT}/media/drive" "sudo bash ${HERE}/ensure-empty-live-usb-dirs.sh"
need_path "${HIGHASCG_ROOT}/media/exfat" "sudo bash ${HERE}/ensure-empty-live-usb-dirs.sh"
need_path "/home/${USER_CASPAR}/exfat" "sudo bash ${HERE}/ensure-empty-live-usb-dirs.sh"

need_path /etc/highascg/exfat-sync.json \
	"sudo bash ${HERE}/prepare-eggs-clone-with-exfat.sh (or copy config/exfat-sync.json)"

for unit in \
	highascg.service \
	highascg-exfat-arrive.service \
	highascg-exfat-server-update.service; do
	[[ -f "/etc/systemd/system/${unit}" ]] && ok "systemd unit ${unit}" \
		|| fail "missing /etc/systemd/system/${unit} — sudo bash ${REPO_ROOT}/scripts/install-exfat-systemd-units.sh ${USER_CASPAR}"
done

need_path "$EXCLUDE" \
	"sudo HIGHASCG_EGGS_EXCLUDE_FRAGMENT=${HERE}/penguins-eggs-exclude-highascg-embed-server.list bash ${HERE}/merge-penguins-eggs-exclude-highascg.sh --replace"

# install-eggs-live-grub-theme.sh writes repo theme + eggs.yaml — does not replace /usr/.../livecd/
THEME_ROOT="${HERE}/highascg-eggs-theme"
THEME_LIVE="${THEME_ROOT}/theme/livecd"
EGGS_YAML="${EGGS_YAML:-/etc/penguins-eggs.d/eggs.yaml}"
if [[ -f "${THEME_LIVE}/grub.main.cfg" && -f "${THEME_LIVE}/splash.png" && -f "${THEME_LIVE}/grub.theme.cfg" ]] \
	&& [[ -f "$EGGS_YAML" ]] && grep -qE '^theme:[[:space:]]+.*highascg-eggs-theme' "$EGGS_YAML"; then
	ok "eggs GRUB theme ready (${THEME_ROOT}; eggs.yaml theme: set)"
else
	fail "eggs GRUB theme not ready — sudo bash ${HERE}/install-eggs-live-grub-theme.sh"
fi

if [[ -d "${HIGHASCG_ROOT}/node_modules" ]]; then
	ok "node_modules present (embed-server ISO)"
else
	fail "missing ${HIGHASCG_ROOT}/node_modules — sudo bash ${REPO_ROOT}/scripts/setup/07-node-highascg.sh"
fi

EMBED_CALAMARES="${HIGHASCG_ISO_EMBED_CALAMARES:-1}"
if [[ "$EMBED_CALAMARES" == "1" ]]; then
	if command -v calamares >/dev/null 2>&1 && [[ -x /usr/bin/calamares ]]; then
		ok "Calamares /usr/bin/calamares ($(calamares --version 2>/dev/null | head -1 || echo installed))"
	else
		fail "Calamares missing — sudo bash ${HERE}/install-eggs-calamares.sh (eggs produce warns without it)"
	fi
	if dpkg-query -W -f='${Status}' calamares 2>/dev/null | grep -qE '(install|hold) ok installed'; then
		ok "dpkg calamares"
	else
		fail "dpkg calamares not installed — sudo bash ${HERE}/install-eggs-calamares.sh"
	fi
	[[ -d /etc/calamares ]] && ok "/etc/calamares" \
		|| fail "missing /etc/calamares — sudo bash ${HERE}/install-eggs-calamares.sh"
else
	ok "HIGHASCG_ISO_EMBED_CALAMARES=0 — skipping Calamares checks"
fi

if ss -tln 2>/dev/null | grep -q ':5250 '; then
	# CEF forks reuse the casparcg binary name (--type=zygote/gpu/utility). Count AMCP parent only.
	n_main=0
	n_run=0
	for _pid in $(pgrep -f "${HIGHASCG_ROOT}/bin/casparcg" 2>/dev/null || true); do
		_args="$(tr '\0' ' ' <"/proc/${_pid}/cmdline" 2>/dev/null || true)"
		[[ "$_args" == *"--type="* ]] && continue
		[[ "$_args" == *"config/casparcg.config"* ]] && n_main=$((n_main + 1))
	done
	for _pid in $(pgrep -f "run\.sh" 2>/dev/null || true); do
		_args="$(tr '\0' ' ' <"/proc/${_pid}/cmdline" 2>/dev/null || true)"
		[[ "$_args" == *run.sh* ]] || continue
		_cwd="$(readlink -f "/proc/${_pid}/cwd" 2>/dev/null || true)"
		[[ "$_cwd" == "$HIGHASCG_ROOT" ]] && n_run=$((n_run + 1))
	done
	if [[ "$n_main" -gt 1 || "$n_run" -gt 1 ]]; then
		fail "duplicate Caspar supervisors (main=${n_main}, run.sh=${n_run}) on :5250 — stop extras before produce"
	else
		ok "Caspar AMCP :5250 (main=${n_main}, run.sh=${n_run}; CEF children ignored)"
	fi
else
	ok "Caspar AMCP :5250 free (or not started)"
fi

echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "Prepare verify FAILED (${FAIL} error(s)). Install missing pieces, then re-run." >&2
	echo "  Host setup: ${REPO_ROOT}/scripts/setup/README.md" >&2
	echo "  One-shot: sudo bash ${REPO_ROOT}/work/install-eggs-host-prereqs.sh" >&2
	echo "  Or: sudo bash ${HERE}/prepare-eggs-clone-with-exfat.sh ${USER_CASPAR}" >&2
	exit 1
fi
echo "Prepare verify passed — host looks ready for eggs produce."
exit 0
