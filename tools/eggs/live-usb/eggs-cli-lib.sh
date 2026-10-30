# penguins-eggs CLI flavor detection (WO-870 Phase 1). Source, do not execute.
#
# penguins-eggs 26.10 is a Go rewrite (`/usr/bin/eggs` -> coa): `remaster` replaced `produce`, and the
# flags --nointeractive --max --excludes --basename --theme are gone (cobra rejects unknown flags). The TypeScript
# line lives on as `eggs-legacy` (config /etc/penguins-eggs-legacy.d). Every script that runs or inspects eggs asks
# this lib which one it is talking to instead of assuming.
#
# Flavors:   new     Go rewrite (`remaster`)           legacy  TypeScript line (`produce`)      none  no usable eggs
#
# Binary choice (first hit wins):
#   HIGHASCG_EGGS_BIN, then EGGS_BIN (e.g. EGGS_BIN=eggs-legacy), then `eggs`, then `eggs-legacy` on PATH.
# Flavor probe (cheap, read-only): HIGHASCG_EGGS_FLAVOR=new|legacy|none forces the answer (tests, owner override);
#   else a binary whose realpath ends in /coa is `new`, one named eggs-legacy is `legacy`, anything else is asked
#   `--help` and classified by its command list (`remaster` -> new, `produce` -> legacy). No other eggs command is
#   ever run from here.

# Prints the resolved path of the eggs binary; returns 1 (prints nothing) when there is none.
highascg_eggs_bin() {
	local want="${HIGHASCG_EGGS_BIN:-${EGGS_BIN:-}}" found=""
	if [[ -n "$want" ]]; then
		found="$(command -v -- "$want" 2>/dev/null || true)"
	else
		found="$(command -v eggs 2>/dev/null || command -v eggs-legacy 2>/dev/null || true)"
	fi
	[[ -n "$found" ]] || return 1
	printf '%s\n' "$found"
}

# Prints new | legacy | none (always returns 0).
highascg_eggs_flavor() {
	local forced="${HIGHASCG_EGGS_FLAVOR:-}" bin real help
	case "$forced" in
	new | legacy | none)
		printf '%s\n' "$forced"
		return 0
		;;
	esac
	if ! bin="$(highascg_eggs_bin)"; then
		echo none
		return 0
	fi
	real="$(readlink -f -- "$bin" 2>/dev/null || printf '%s' "$bin")"
	case "$(basename -- "$real")" in
	coa)
		echo new
		return 0
		;;
	esac
	case "$(basename -- "$bin")" in
	eggs-legacy)
		echo legacy
		return 0
		;;
	esac
	help="$(timeout 10 "$bin" --help 2>&1 </dev/null || true)"
	if grep -Eq '^[[:space:]]+remaster[[:space:]]' <<<"$help"; then
		echo new
	elif grep -Eq '^[[:space:]]+produce[[:space:]]' <<<"$help"; then
		echo legacy
	else
		echo none
	fi
	return 0
}

# Config dir of the flavor (EGGS_CONF_DIR wins, same knob as install-eggs-config.sh).
highascg_eggs_conf_dir() {
	if [[ -n "${EGGS_CONF_DIR:-}" ]]; then
		printf '%s\n' "$EGGS_CONF_DIR"
		return 0
	fi
	local bin=""
	bin="$(highascg_eggs_bin 2>/dev/null || true)"
	if [[ "$(highascg_eggs_flavor)" == "legacy" && "$(basename -- "${bin:-}")" == "eggs-legacy" ]]; then
		echo /etc/penguins-eggs-legacy.d
	else
		echo /etc/penguins-eggs.d
	fi
}

# The nest: where the liveroot, isodir and the finished ISO live (both flavors).
highascg_eggs_nest() {
	printf '%s\n' "${EGGS_NEST:-/home/eggs}"
}

# Glob(s) of the ISO a BASENAME produces, one per line. new: BASENAME-<date>.iso (custom.yaml iso_prefix);
# legacy: BASENAME_<arch>_<date>.iso; none: both, so a finder still works.
highascg_eggs_iso_glob() {
	local b="${1:?basename}"
	case "$(highascg_eggs_flavor)" in
	new) printf '%s-*.iso\n' "$b" ;;
	legacy) printf '%s_*.iso\n' "$b" ;;
	*) printf '%s-*.iso\n%s_*.iso\n' "$b" "$b" ;;
	esac
}
