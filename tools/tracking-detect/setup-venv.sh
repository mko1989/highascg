#!/usr/bin/env bash
# WO-616 T9 / WO-1094: creates, refreshes or repairs the Python venv for the person-detection sidecar
# (tools/tracking-detect/sidecar.py). The HighAsCG server spawns "$VENV/bin/python tools/tracking-detect/sidecar.py".
# Paths and progress lines: runtime-lib.sh. Usually run by install.sh (the GUI's install job); fine by hand too.
#   setup-venv.sh [--clear] [--wheels DIR] [--dry-run]
#     --clear       recreate the venv (repair: a venv built for another Python, missing / broken packages)
#     --wheels DIR  install offline from DIR (an install-from-folder bundle) instead of downloading
# Idempotent: the core wheels are downloaded once into $PREFIX/wheels (refreshed for this Python when online), then
# installed with --no-index; a re-run with the pins met changes nothing.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/runtime-lib.sh"

CLEAR=0
SRC=""
while [[ $# -gt 0 ]]; do
	case "$1" in
		--clear) CLEAR=1 ;;
		--wheels) SRC="$2"; shift ;;
		--dry-run) DRY=1 ;;
		*) fail 2 "unknown option $1" ;;
	esac
	shift
done
trap on_term TERM INT
take_lock

need_python
step core "Python packages (numpy, OpenCV, ONNX Runtime)"
if [[ -z "$SRC" ]]; then
	need_tool curl curl
fi
if [[ "$CLEAR" == 1 || ! -x "$VENV/bin/python" ]] || ! "$VENV/bin/python" -c 'import sys' >/dev/null 2>&1; then
	echo "creating the venv in $VENV (python3 $SYS_PY_VER)"
	run python3 -m venv --without-pip --clear "$VENV" || fail 12 "python3 -m venv failed for $VENV" "sudo apt install python3-venv"
fi
pct 10
bootstrap_pip "$VENV/bin/python" "${SRC:-$WHEELS}"
pct 20
run mkdir -p "$WHEELS"
if [[ -n "$SRC" ]]; then
	[[ "$SRC" -ef "$WHEELS" ]] || run cp -f "$SRC"/*.whl "$WHEELS"/ || fail 30 "no wheels in $SRC"
else
	# the wheelhouse for THIS interpreter (a Python upgrade makes the old cp3xx wheels useless) + pip itself for bundles
	PIP_PCT="20 70" pip_run "$VENV/bin/python" download --dest "$WHEELS" -r "$TD_HERE/requirements.txt" pip \
		|| fail 14 "pip could not download the packages (see the log above)"
fi
pct 70
PIP_PCT="70 95" pip_run "$VENV/bin/python" install --no-index --find-links "$WHEELS" -r "$TD_HERE/requirements.txt" \
	|| fail 14 "pip could not install the packages from $WHEELS — they may be for another Python (this one is $SYS_PY_VER)"
pct 95
if ! dry; then
	"$VENV/bin/python" -c 'import numpy, cv2, onnxruntime; print("ok", onnxruntime.__version__, onnxruntime.get_available_providers())' \
		|| fail 14 "the packages installed but do not import (see the log above)"
fi
done_step core
echo "models go in $MODELS (export-models.sh, fetch-face-models.sh)"
