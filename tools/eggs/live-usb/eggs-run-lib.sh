# Version-gated ISO build step (WO-870 Phase 1). Source, do not execute.
#
#   source eggs-run-lib.sh
#   highascg_eggs_build_iso BASENAME THEME_DIR
#
# new     apply the managed config (install-eggs-config.sh --apply), verify it (verify-eggs-config.sh), then
#         `eggs remaster --clone --anonymous` [+ `--stop-after STEP` when HIGHASCG_EGGS_STOP_AFTER is set: the dry runs].
#         BASENAME / THEME_DIR are not passed: they live in custom.yaml (iso_prefix) and the branding dir.
# legacy  the pre-26.10 `produce` line, unchanged.
# none    refuses.
#
# Test seams: HIGHASCG_EGGS_INSTALL_CONFIG / HIGHASCG_EGGS_VERIFY_CONFIG (script paths), HIGHASCG_EGGS_LOG (tee target).

_EGGS_RUN_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=eggs-cli-lib.sh
source "${_EGGS_RUN_LIB_DIR}/eggs-cli-lib.sh"

# Sets HIGHASCG_EGGS_ARGV to the full argv (binary first). Returns 1 with a message when no usable eggs, 2 when a
# knob does not apply to the flavor.
highascg_eggs_build_argv() {
	local basename="${1:?basename}" theme="${2:-}" flavor bin
	HIGHASCG_EGGS_ARGV=()
	flavor="$(highascg_eggs_flavor)"
	bin="$(highascg_eggs_bin 2>/dev/null || true)"
	if [[ -z "$bin" || "$flavor" == "none" ]]; then
		echo "ERROR: no usable penguins-eggs (flavor '${flavor}', binary '${bin:-none}')." >&2
		return 1
	fi
	case "$flavor" in
	new)
		HIGHASCG_EGGS_ARGV=("$bin" remaster --clone --anonymous)
		if [[ -n "${HIGHASCG_EGGS_STOP_AFTER:-}" ]]; then
			HIGHASCG_EGGS_ARGV+=(--stop-after "${HIGHASCG_EGGS_STOP_AFTER}")
		fi
		;;
	legacy)
		if [[ -n "${HIGHASCG_EGGS_STOP_AFTER:-}" ]]; then
			echo "ERROR: HIGHASCG_EGGS_STOP_AFTER is only supported by the 26.10 'remaster' flavor." >&2
			return 2
		fi
		HIGHASCG_EGGS_ARGV=("$bin" produce --nointeractive --clone --max --excludes static --basename "${basename}" --theme "${theme}")
		;;
	esac
}

# After a failure or interruption: anything still mounted under the nest means a half-torn-down liveroot.
highascg_eggs_failure_report() {
	local nest mounts
	nest="$(highascg_eggs_nest)"
	mounts="$("${HIGHASCG_FINDMNT:-findmnt}" -rn -o TARGET 2>/dev/null | awk -v r="${nest%/}" '$1 == r || index($1, r "/") == 1' || true)"
	if [[ -n "$mounts" ]]; then
		echo "ERROR: eggs left mounts under ${nest}:" >&2
		"${HIGHASCG_FINDMNT:-findmnt}" -R "$nest" >&2 2>&1 || printf '%s\n' "$mounts" >&2
		echo "       reboot, do not rm. 'rm -rf ${nest}/liveroot' or 'umount -R' through these binds erases the LIVE /usr" >&2
		echo "       (RECOVER_DESTROYED_USR.md). One eggs run per boot." >&2
	else
		echo "NOTE: no mounts left under ${nest}." >&2
	fi
}

highascg_eggs_build_iso() {
	local basename="${1:?basename}" theme="${2:-}" flavor rc=0 here="${_EGGS_RUN_LIB_DIR}" pipefail_was
	flavor="$(highascg_eggs_flavor)"
	highascg_eggs_build_argv "$basename" "$theme" || return $?

	if [[ "$flavor" == "new" ]]; then
		local inst="${HIGHASCG_EGGS_INSTALL_CONFIG:-${here}/install-eggs-config.sh}"
		local ver="${HIGHASCG_EGGS_VERIFY_CONFIG:-${here}/verify-eggs-config.sh}"
		if [[ -n "${HIGHASCG_NVIDIA_DRIVER:-}" && "$basename" != "highascg-nvidia-${HIGHASCG_NVIDIA_DRIVER}" ]]; then
			echo "WARN: BASENAME '${basename}' is not passed to the new eggs; custom.yaml iso_prefix decides the ISO name." >&2
		fi
		echo "==> eggs ${flavor}: apply managed config (package upgrades overwrite custom.*)"
		bash "$inst" --apply || {
			echo "ERROR: install-eggs-config.sh --apply failed — not running eggs." >&2
			return 1
		}
		bash "$ver" || {
			echo "ERROR: verify-eggs-config.sh failed — not running eggs." >&2
			return 1
		}
	fi

	printf '==> %s' "eggs ${flavor} build:"
	printf ' %q' "${HIGHASCG_EGGS_ARGV[@]}"
	printf '\n'

	# Interrupted runs are the dangerous ones: report what is still mounted before bash exits.
	trap 'highascg_eggs_failure_report; trap - INT TERM; exit 130' INT TERM
	pipefail_was="$(set -o | awk '$1 == "pipefail" {print $2}')"
	set -o pipefail
	if [[ -n "${HIGHASCG_EGGS_LOG:-}" ]]; then
		if "${HIGHASCG_EGGS_ARGV[@]}" 2>&1 | tee -a "${HIGHASCG_EGGS_LOG}"; then rc=0; else rc=$?; fi
	else
		if "${HIGHASCG_EGGS_ARGV[@]}"; then rc=0; else rc=$?; fi
	fi
	[[ "$pipefail_was" == "on" ]] || set +o pipefail
	trap - INT TERM

	if [[ "$rc" -ne 0 ]]; then
		echo "ERROR: eggs ${flavor} exited ${rc}." >&2
		highascg_eggs_failure_report
	fi
	return "$rc"
}
