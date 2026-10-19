#!/usr/bin/env bash
# WO-616 T9: creates or refreshes the Python venv for the person-detection sidecar (tools/tracking-detect/sidecar.py).
# The HighAsCG server spawns "$VENV/bin/python tools/tracking-detect/sidecar.py". Paths are overridable with the
# env vars HIGHASCG_TRACKING_PYTHON (interpreter the server runs) and HIGHASCG_TRACKING_MODELS (ONNX model dir).
# Safe to re-run: pip install -r is a no-op when the pins are already met.
set -euo pipefail

VENV="${HIGHASCG_TRACKING_VENV:-$HOME/.local/share/highascg/tracking-venv}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIP_TMP=""

cleanup() {
    if [[ -n "$PIP_TMP" ]]; then
        rm -rf "$PIP_TMP"
    fi
}
trap cleanup EXIT

# This box's python3 has no ensurepip, so pip is bootstrapped with get-pip.py instead.
bootstrap_pip() {
    PIP_TMP="$(mktemp -d)"
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$PIP_TMP/get-pip.py"
    "$VENV/bin/python" "$PIP_TMP/get-pip.py"
}

if [[ ! -x "$VENV/bin/python" ]]; then
    if ! python3 -m venv "$VENV"; then
        echo "python3 -m venv failed (no ensurepip); creating the venv without pip" >&2
        python3 -m venv --without-pip "$VENV"
    fi
fi

if ! "$VENV/bin/python" -m pip --version >/dev/null 2>&1; then
    bootstrap_pip
fi

"$VENV/bin/python" -m pip install -r "$HERE/requirements.txt"

"$VENV/bin/python" -c 'import numpy, cv2, onnxruntime; print("ok", onnxruntime.__version__, onnxruntime.get_available_providers())'

echo "models go in ${HIGHASCG_TRACKING_MODELS:-$HOME/.local/share/highascg/models} (see export-models.sh)"
