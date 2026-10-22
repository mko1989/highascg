#!/usr/bin/env bash
# WO-675: fetch the OpenCV Zoo face models for presenter recognition (tools/tracking-detect/face.py).
#   face_detection_yunet_2023mar.onnx    YuNet, MIT          (opencv_zoo/models/face_detection_yunet)
#   face_recognition_sface_2021dec.onnx  SFace, Apache-2.0   (opencv_zoo/models/face_recognition_sface)
# Not committed (37 MB); each machine fetches its own. Checksums pin the exact files verified on the box 22.10.
# Output: ${HIGHASCG_TRACKING_MODELS:-$HOME/.local/share/highascg/models}/
set -euo pipefail
MODELS="${HIGHASCG_TRACKING_MODELS:-$HOME/.local/share/highascg/models}"
BASE="https://github.com/opencv/opencv_zoo/raw/main/models"
mkdir -p "$MODELS"
fetch() {
    local rel="$1" sum="$2" out
    out="$MODELS/$(basename "$rel")"
    if [[ -f "$out" ]] && echo "$sum  $out" | sha256sum -c --status; then
        echo "ok      $out"
        return
    fi
    curl -fsSL -o "$out.part" "$BASE/$rel"
    echo "$sum  $out.part" | sha256sum -c --status || { echo "checksum mismatch: $rel" >&2; rm -f "$out.part"; exit 1; }
    mv "$out.part" "$out"
    echo "fetched $out"
}
fetch face_detection_yunet/face_detection_yunet_2023mar.onnx 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
fetch face_recognition_sface/face_recognition_sface_2021dec.onnx 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
