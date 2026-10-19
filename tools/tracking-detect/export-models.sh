#!/usr/bin/env bash
# WO-616 T9: one-off export of the YOLO26 person-detection weights to ONNX for tools/tracking-detect/sidecar.py.
# The YOLO26 weights and ultralytics are AGPL-3.0 (Ultralytics), so the models are not committed to the repo;
# each machine exports its own. Exported with end2end=False, which gives the [1,84,8400] head; the sidecar handles both heads.
# Usage: export-models.sh [model ...]   (default: yolo26n yolo26s). Downloads several GB; run by hand, never from CI.
# Output: ${HIGHASCG_TRACKING_MODELS:-$HOME/.local/share/highascg/models}/<model>.onnx
set -euo pipefail

MODELS="${HIGHASCG_TRACKING_MODELS:-$HOME/.local/share/highascg/models}"
WORK="$(mktemp -d)"
TMPV="$WORK/venv"

cleanup() {
    rm -rf "$WORK"
}
trap cleanup EXIT

# This box's python3 has no ensurepip, so pip is bootstrapped with get-pip.py instead.
bootstrap_pip() {
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$WORK/get-pip.py"
    "$TMPV/bin/python" "$WORK/get-pip.py"
}

if ! python3 -m venv "$TMPV"; then
    echo "python3 -m venv failed (no ensurepip); creating the venv without pip" >&2
    python3 -m venv --without-pip "$TMPV"
fi
if ! "$TMPV/bin/python" -m pip --version >/dev/null 2>&1; then
    bootstrap_pip
fi

"$TMPV/bin/python" -m pip install ultralytics==8.4.182 onnx onnxslim

if [[ $# -eq 0 ]]; then
    set -- yolo26n yolo26s
fi

for m in "$@"; do
    cd "$WORK"
    curl -fL -o "${m}.pt" "https://github.com/ultralytics/assets/releases/download/v8.4.0/${m}.pt"
    "$TMPV/bin/python" -c "from ultralytics import YOLO; YOLO('${m}.pt').export(format='onnx', imgsz=640, opset=17, simplify=True, end2end=False)"
    install -D -m 0644 "${m}.onnx" "$MODELS/${m}.onnx"
    sha256sum "$MODELS/${m}.onnx"
done
