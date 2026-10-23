#!/usr/bin/env bash
# WO-704 — DeckLink DKMS build cache on the operator's stick: build once per kernel, not every live boot.
# Sourced by decklink-install-lib.sh (installed beside it in /usr/local/lib/highascg) and smoke tests.
#
# A live ISO boots with an empty /var/lib/dkms (WO-92: no BMD binaries ship), so desktopvideo's postinst compiled
# blackmagic + blackmagic-io on every boot (~1m53s on .64). After a successful install + load the built trees
# (/var/lib/dkms/<mod>/<dkms-ver>/<kernel>/<arch>: module/*.ko + log/) are saved to
# <stick>/decklink/dkms-cache/<kernel>/<mod>-<deb-ver>-<arch>.tar.gz (+ .sha256), the archive holding
# <dkms-ver>/<kernel>/<arch>/. The next boot puts the trees back BEFORE `dpkg -i`; the vendor postinst then runs
# `dkms add` (fresh: no source link yet), `dkms build` (DKMS 3.x maybe_build_module: "already built … skip") and
# `dkms install --force` (do_install copies the cached .ko + depmod; it builds only when module/ is missing) — no
# compile, no kernel headers needed. A real `dkms ldtarball` would ADD the module, and the postinst's
# unconditional `dkms add` then dies ("already contains") and skips build + install, so only the built tree is
# restored. The cache is the operator's own build of the package they downloaded, kept on their stick — nothing
# ships in the ISO. Missing / corrupt / other-version caches fall back to the normal compile; a cached module that
# does not load (e.g. Secure Boot with another box's key) is rebuilt and re-saved. The cache never fails an install.

DECKLINK_DKMS_MODULES="blackmagic blackmagic-io"
DECKLINK_DKMS_CACHE_KEEP=2 # kernels kept per stick
DECKLINK_DKMS_CACHE_RESTORED=0

decklink_dkms_tree() { printf '%s' "${DECKLINK_DKMS_TREE:-/var/lib/dkms}"; }
decklink_dkms_arch() { printf '%s' "${DECKLINK_DKMS_ARCH:-$(uname -m)}"; }

# Prints the cache dir on the first mounted stick (exFAT, then bridge); rc 1 when none is mounted.
decklink_dkms_cache_root() {
	if [[ -n "${DECKLINK_DKMS_CACHE_ROOT:-}" ]]; then
		printf '%s' "$DECKLINK_DKMS_CACHE_ROOT"
		return 0
	fi
	local mp
	for mp in /home/casparcg/exfat /home/casparcg/bridge; do
		if mountpoint -q "$mp" 2>/dev/null; then
			printf '%s' "${mp}/decklink/dkms-cache"
			return 0
		fi
	done
	return 1
}

# @param ver krel — restores every cached module tree; sets DECKLINK_DKMS_CACHE_RESTORED; rc 0 when all came back
decklink_dkms_cache_restore() {
	local ver="${1:-}" krel="${2:-}" root tree arch mod tgz tmp want got built dver total=0
	DECKLINK_DKMS_CACHE_RESTORED=0
	[[ -n "$ver" && -n "$krel" ]] || return 1
	root="$(decklink_dkms_cache_root)" || return 1
	tree="$(decklink_dkms_tree)"
	arch="$(decklink_dkms_arch)"
	for mod in $DECKLINK_DKMS_MODULES; do
		total=$((total + 1))
		tgz="${root}/${krel}/${mod}-${ver}-${arch}.tar.gz"
		[[ -f "$tgz" && -f "${tgz}.sha256" ]] || continue
		want="$(awk '{print $1; exit}' "${tgz}.sha256" 2>/dev/null || true)"
		got="$(sha256sum "$tgz" 2>/dev/null | awk '{print $1}' || true)"
		if [[ -z "$want" || "$want" != "$got" ]]; then
			echo "decklink dkms cache: ${tgz} checksum mismatch — compiling instead" >&2
			continue
		fi
		tmp="$(mktemp -d "${TMPDIR:-/tmp}/decklink-dkms-cache.XXXXXX")" || continue
		# exactly one <dkms-ver>/<krel>/<arch>/module/*.ko* inside, nothing else at the top
		built=""
		if tar -xzf "$tgz" -C "$tmp" --no-same-owner 2>/dev/null; then
			built="$(compgen -G "${tmp}/*/${krel}/${arch}/module/*.ko*" | head -1 || true)"
		fi
		dver=""
		[[ -n "$built" && "$(find "$tmp" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 ]] &&
			dver="$(basename "$(dirname "$(dirname "$(dirname "$(dirname "$built")")")")")"
		if [[ -z "$dver" ]]; then
			echo "decklink dkms cache: ${tgz} unusable — compiling instead" >&2
		elif [[ -e "${tree}/${mod}/${dver}" ]]; then
			: # DKMS already knows this version (installed box) — never touch its tree
		elif mkdir -p "${tree}/${mod}/${dver}" && mv "${tmp}/${dver}/${krel}" "${tree}/${mod}/${dver}/${krel}"; then
			DECKLINK_DKMS_CACHE_RESTORED=$((DECKLINK_DKMS_CACHE_RESTORED + 1))
			echo "decklink dkms cache: restored ${mod} ${dver} for ${krel} (no compile)" >&2
		else
			rmdir "${tree}/${mod}/${dver}" "${tree}/${mod}" 2>/dev/null || true
		fi
		rm -rf "${tmp:?}"
	done
	[[ "$DECKLINK_DKMS_CACHE_RESTORED" -gt 0 && "$DECKLINK_DKMS_CACHE_RESTORED" -eq "$total" ]]
}

# @param ver krel [force] — saves each installed module tree for krel (force: replace an existing cache entry),
# then keeps the newest DECKLINK_DKMS_CACHE_KEEP kernels
decklink_dkms_cache_save() {
	local ver="${1:-}" krel="${2:-}" force="${3:-0}" root tree arch mod built dver tgz tmp
	[[ -n "$ver" && -n "$krel" ]] || return 1
	root="$(decklink_dkms_cache_root)" || return 1
	tree="$(decklink_dkms_tree)"
	arch="$(decklink_dkms_arch)"
	mkdir -p "${root}/${krel}" 2>/dev/null || return 1
	for mod in $DECKLINK_DKMS_MODULES; do
		tgz="${root}/${krel}/${mod}-${ver}-${arch}.tar.gz"
		[[ "$force" != 1 && -f "$tgz" && -f "${tgz}.sha256" ]] && continue
		dver="$(decklink_dkms_active_version "$mod" "$krel")" || continue
		built="${tree}/${mod}/${dver}/${krel}/${arch}"
		[[ "$(readlink -f "${tree}/${mod}/kernel-${krel}-${arch}")" == "$(readlink -f "$built")" ]] || continue
		compgen -G "${built}/module/*.ko*" >/dev/null || continue
		# exFAT: plain files only (no owners / modes kept) — write beside, then rename into place
		tmp="${tgz}.tmp.$$"
		if tar -czf "$tmp" --owner=0 --group=0 -C "${tree}/${mod}" "${dver}/${krel}/${arch}" 2>/dev/null &&
			sha256sum "$tmp" | awk -v n="$(basename "$tgz")" '{print $1 "  " n}' >"${tmp}.sha256" &&
			mv -f "$tmp" "$tgz" && mv -f "${tmp}.sha256" "${tgz}.sha256"; then
			echo "decklink dkms cache: saved ${mod} ${dver} for ${krel}" >&2
		else
			rm -f "$tmp" "${tmp}.sha256"
			echo "decklink dkms cache: could not save ${mod} to ${root}" >&2
		fi
	done
	printf 'desktopvideo=%s\nkernel=%s\narch=%s\nsaved=%s\n' "$ver" "$krel" "$arch" "$(date -Iseconds)" \
		>"${root}/${krel}/manifest.txt.tmp" 2>/dev/null &&
		mv -f "${root}/${krel}/manifest.txt.tmp" "${root}/${krel}/manifest.txt" 2>/dev/null
	decklink_dkms_cache_prune "$root" "$krel"
	return 0
}

# Keeps keep_krel + the newest other kernel dirs up to DECKLINK_DKMS_CACHE_KEEP; only kernel-named dirs are touched.
decklink_dkms_cache_prune() {
	local root="${1:-}" keep_krel="${2:-}" d name kept=1
	[[ -d "$root" ]] || return 0
	while IFS= read -r d; do
		name="$(basename "$d")"
		[[ "$name" =~ ^[0-9]+\.[0-9]+[A-Za-z0-9._+-]*$ ]] || continue
		[[ "$name" == "$keep_krel" ]] && continue
		if [[ "$kept" -lt "$DECKLINK_DKMS_CACHE_KEEP" ]]; then
			kept=$((kept + 1))
			continue
		fi
		rm -rf "${root:?}/${name:?}"
		echo "decklink dkms cache: pruned kernel ${name}" >&2
	done < <(ls -1dt "$root"/*/ 2>/dev/null || true)
}

# True when both DeckLink modules are loaded (sysfs; DECKLINK_SYS_MODULE for tests).
decklink_modules_loaded() {
	local sys="${DECKLINK_SYS_MODULE:-/sys/module}"
	[[ -d "${sys}/blackmagic_io" && -d "${sys}/blackmagic" ]]
}

# @param mod krel → the DKMS version DKMS made active for krel (kernel-<krel>-<arch> → <ver>/<krel>/<arch>)
decklink_dkms_active_version() {
	local built
	built="$(readlink -f "$(decklink_dkms_tree)/${1:-}/kernel-${2:-}-$(decklink_dkms_arch)" 2>/dev/null || true)"
	[[ -n "$built" ]] || return 1
	basename "$(dirname "$(dirname "$built")")"
}

# A restored module that does not load (e.g. signed with another box's Secure Boot key) → compile it here after all.
decklink_dkms_cache_rebuild() {
	local krel="${1:-}" mod dver
	echo "decklink dkms cache: cached module did not load — rebuilding for ${krel}" >&2
	decklink_ensure_dkms_prereqs || return 1
	for mod in blackmagic-io blackmagic; do
		dver="$(decklink_dkms_active_version "$mod" "$krel")" || continue
		dkms build --force -m "$mod" -v "$dver" -k "$krel" 2>/dev/null || true
		dkms install --force -m "$mod" -v "$dver" -k "$krel" 2>/dev/null || true
	done
	modprobe blackmagic_io 2>/dev/null || true
	modprobe blackmagic 2>/dev/null || true
	decklink_modules_loaded
}
