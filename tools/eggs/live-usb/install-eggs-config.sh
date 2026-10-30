#!/usr/bin/env bash
# WO-870 Phase 2: generate the managed penguins-eggs 26.10 config from the repo and (optionally) install it.
# Phase 3: also the boot-menu branding, branding/livecd/ (copied as-is from highascg-eggs-theme/theme/livecd). coa's
# generate-menus.sh renders our menus only when BOTH *.main.cfg exist there, and boot-assets takes the theme
# files only when splash.png exists there, so the five files travel together. {{{fullname}}} is filled in here.
#
#   bash install-eggs-config.sh --out DIR      # default: write custom.* + branding/livecd/* into DIR (no root)
#   sudo bash install-eggs-config.sh --apply   # install into /etc/penguins-eggs.d/ (root; owner runs this)
#
# Idempotent: --apply leaves a file alone when it already matches the generated content; otherwise the previous
# file is copied to <file>.bak-<timestamp> first. Package upgrades overwrite both files (WO-870 F2), so the
# build re-runs this every time; verify-eggs-config.sh is the check-only twin.
#
# Env / flags:
#   --branch NNN | HIGHASCG_NVIDIA_DRIVER   NVIDIA branch for remaster.iso_prefix (default: installed driver,
#                                           same logic as build-highascg-egg.sh via scripts/lib/nvidia-branch.sh)
#   --embed 0|1  | HIGHASCG_ISO_EMBED_SERVER  1 (default) = embed-server fragment, 0 = WO-47 exFAT-only fragment
#   EGGS_CONF_DIR                            target dir for --apply (default /etc/penguins-eggs.d)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
GEN="${HERE}/generate-eggs-config.js"
CONF_DIR="${EGGS_CONF_DIR:-/etc/penguins-eggs.d}"
THEME_LIVECD="${HERE}/highascg-eggs-theme/theme/livecd"
LIVECD=(grub.main.cfg isolinux.main.cfg grub.theme.cfg isolinux.theme.cfg splash.png)
FILES=(custom.exclude.list custom.yaml "${LIVECD[@]/#/branding/livecd/}")

OUT=""
APPLY=0
BR="${HIGHASCG_NVIDIA_DRIVER:-}"
EMBED="${HIGHASCG_ISO_EMBED_SERVER:-1}"

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
	case "$1" in
	--out) OUT="${2:?--out needs a directory}"; shift 2 ;;
	--apply) APPLY=1; shift ;;
	--branch) BR="${2:?--branch needs NNN}"; shift 2 ;;
	--embed) EMBED="${2:?--embed needs 0|1}"; shift 2 ;;
	-h | --help) usage; exit 0 ;;
	*) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
	esac
done

if [[ -z "$BR" ]]; then
	# shellcheck source=../../../scripts/lib/nvidia-branch.sh
	source "${REPO_ROOT}/scripts/lib/nvidia-branch.sh"
	BR="$(highascg_installed_nvidia_branch 2>/dev/null || true)"
fi
if [[ ! "$BR" =~ ^[0-9]{3,}$ ]]; then
	echo "install-eggs-config: no NVIDIA driver branch (set HIGHASCG_NVIDIA_DRIVER=NNN or pass --branch NNN)" >&2
	exit 1
fi
command -v node >/dev/null 2>&1 || { echo "install-eggs-config: node not found" >&2; exit 1; }

generate_into() {
	local dir="$1"
	mkdir -p "$dir"
	node "$GEN" exclude --embed "$EMBED" >"${dir}/custom.exclude.list"
	node "$GEN" yaml --branch "$BR" >"${dir}/custom.yaml"
	mkdir -p "${dir}/branding/livecd"
	for f in "${LIVECD[@]}"; do cp "${THEME_LIVECD}/${f}" "${dir}/branding/livecd/${f}"; done
	# coa renders {{{fullname}}} from the build host's os-release ("Ubuntu 26.04.1 LTS"); the menus keep the old
	# eggs name (basename-derived, "HIGHASCG NVIDIA 595 Live" on the Sept ISO), so it is filled in here.
	sed -i "s/{{{fullname}}}/HIGHASCG NVIDIA ${BR}/g" "${dir}/branding/livecd/grub.main.cfg" "${dir}/branding/livecd/isolinux.main.cfg"
}

if [[ "$APPLY" -eq 0 ]]; then
	[[ -n "$OUT" ]] || { echo "install-eggs-config: give --out DIR (write only) or --apply (install into ${CONF_DIR})" >&2; exit 2; }
	generate_into "$OUT"
	echo "Wrote ${OUT}/custom.exclude.list ($(grep -cv '^[[:space:]]*\(#\|$\)' "${OUT}/custom.exclude.list") patterns), ${OUT}/custom.yaml (branch ${BR}, embed-server=${EMBED}) and ${OUT}/branding/livecd/ (${#LIVECD[@]} files)"
	exit 0
fi

# --apply: generate into a private temp dir, then install file by file.
if [[ ! -d "$CONF_DIR" ]]; then
	echo "install-eggs-config: ${CONF_DIR} does not exist — is penguins-eggs 26.10 installed?" >&2
	exit 1
fi
if [[ ! -w "$CONF_DIR" ]]; then
	echo "install-eggs-config: ${CONF_DIR} is not writable — --apply needs root (the owner runs it with sudo)" >&2
	exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
generate_into "$TMP"
STAMP="$(date +%Y%m%d-%H%M%S)"
for f in "${FILES[@]}"; do
	dest="${CONF_DIR}/${f}"
	if [[ -f "$dest" ]] && cmp -s "${TMP}/${f}" "$dest"; then
		echo "unchanged: ${dest}"
		continue
	fi
	if [[ -f "$dest" ]]; then
		cp -p "$dest" "${dest}.bak-${STAMP}"
		echo "backup:    ${dest}.bak-${STAMP}"
	fi
	install -D -m 0644 "${TMP}/${f}" "$dest"
	echo "installed: ${dest}"
done
echo "Next: bash ${HERE}/verify-eggs-config.sh"
