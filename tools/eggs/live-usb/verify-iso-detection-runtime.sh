#!/usr/bin/env bash
# WO-1094 (owner 16.11: "we cant bake anything into iso that i have no right to distribute"): the person-detection
# runtime must never be in an ISO — the Ultralytics YOLO26 weights (AGPL-3.0), the OpenCV Zoo face models (trained on
# research-only data), the tracking venv, its wheels, the install job's downloads, pip / Ultralytics caches and export
# bundles (tools/tracking-detect/runtime-lib.sh lists the paths). Each machine installs its own from the GUI.
#
# Sourced by verify-iso-squashfs-excludes.sh (detection_runtime_check, using its UNSQ / SQ / bad / ok), or run alone:
#   verify-iso-detection-runtime.sh <listing.txt>     an `unsquashfs -l` listing (or any one-path-per-line list)
#   verify-iso-detection-runtime.sh <x.squashfs>      lists it with unsquashfs
# Exit 1 and the offending paths when anything is there. Not matched on purpose: *.pt outside home/ and root/ that is
# not a YOLO weight (the ISO has usr/share/mc/hints/mc.hint.pt, Midnight Commander's Portuguese hints).

DETECTION_RUNTIME_RE='(\.onnx$|^(squashfs-root/)?(home/[^/]+|root)/.*\.pt$|/yolo[^/]*\.pt$|/\.local/share/highascg(/|$)|/tracking-venv(/|$)|/highascg-detection-runtime(/|$)|/\.cache/pip(/|$)|/\.config/Ultralytics(/|$))'

# stdin: one path per line → the offending ones on stdout
detection_runtime_offenders() {
	grep -E "$DETECTION_RUNTIME_RE" || true
}

# inside verify-iso-squashfs-excludes.sh
detection_runtime_check() {
	local hits n
	hits="$("${UNSQ[@]}" -l "$SQ" 2>/dev/null | detection_runtime_offenders)"
	if [[ -n "$hits" ]]; then
		n="$(printf '%s\n' "$hits" | wc -l)"
		bad "person-detection runtime in squashfs (WO-1094: weights / venv / bundles are not ours to distribute): ${n} path(s), e.g. $(printf '%s\n' "$hits" | head -3 | tr '\n' ' ')— re-apply install-eggs-config.sh (WO-1094 excludes)"
	else
		ok "absent (WO-1094): *.onnx, weight *.pt, tracking venv, .local/share/highascg, export bundles, pip / Ultralytics caches"
	fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	set -euo pipefail
	in="${1:?usage: $0 <listing.txt | x.squashfs>}"
	if [[ "$in" == *.squashfs ]]; then
		hits="$(unsquashfs -l "$in" 2>/dev/null | detection_runtime_offenders)"
	else
		hits="$(detection_runtime_offenders <"$in")"
	fi
	if [[ -n "$hits" ]]; then
		echo "FAIL: person-detection runtime present (WO-1094):" >&2
		printf '%s\n' "$hits" >&2
		exit 1
	fi
	echo "OK: no person-detection runtime"
fi
