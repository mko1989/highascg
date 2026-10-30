#!/usr/bin/env bash
# WO-870 Phase 2: check-only twin of install-eggs-config.sh. Compares the sha256 of the installed
# /etc/penguins-eggs.d/{custom.exclude.list,custom.yaml} with freshly generated content.
# PASS/FAIL per file with a one-line reason; exit 1 on any mismatch. Runs as non-root (files are world-readable).
# Same --branch / --embed / env knobs as install-eggs-config.sh; EGGS_CONF_DIR overrides the directory.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONF_DIR="${EGGS_CONF_DIR:-/etc/penguins-eggs.d}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if ! bash "${HERE}/install-eggs-config.sh" --out "$TMP" "$@" >"${TMP}/gen.log" 2>&1; then
	echo "FAIL generator: $(tail -1 "${TMP}/gen.log")"
	exit 1
fi

rc=0
for f in custom.exclude.list custom.yaml; do
	want="$(sha256sum "${TMP}/${f}" | cut -d' ' -f1)"
	have_file="${CONF_DIR}/${f}"
	if [[ ! -r "$have_file" ]]; then
		echo "FAIL ${f}: ${have_file} missing or unreadable"
		rc=1
		continue
	fi
	have="$(sha256sum "$have_file" | cut -d' ' -f1)"
	if [[ "$have" == "$want" ]]; then
		echo "PASS ${f}: matches generated content (sha256 ${have:0:12})"
		continue
	fi
	rc=1
	if [[ "$f" == custom.exclude.list ]]; then
		if ! grep -qxF 'home/casparcg/highascg/media/*' "$have_file"; then
			why="installed list has no home/casparcg/highascg/media/* line"
		else
			why="differs from generated ($(grep -cv '^[[:space:]]*\(#\|$\)' "$have_file") vs $(grep -cv '^[[:space:]]*\(#\|$\)' "${TMP}/${f}") patterns)"
		fi
	else
		why="differs from generated (installed iso_prefix: $(sed -n 's/^[[:space:]]*iso_prefix:[[:space:]]*//p' "$have_file" | head -1))"
		[[ -z "$(sed -n 's/^[[:space:]]*iso_prefix:.*/x/p' "$have_file")" ]] && why="differs from generated (installed file has no iso_prefix)"
	fi
	echo "FAIL ${f}: ${why}; sha256 ${have:0:12} != ${want:0:12}"
done
[[ "$rc" -eq 0 ]] || echo "Fix: sudo bash ${HERE}/install-eggs-config.sh --apply"
exit "$rc"
