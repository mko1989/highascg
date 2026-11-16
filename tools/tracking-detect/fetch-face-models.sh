#!/usr/bin/env bash
# WO-675 / WO-1094: fetch the OpenCV Zoo face models for presenter recognition (tools/tracking-detect/face.py, body.py).
#   face_detection_yunet_2023mar.onnx    YuNet, MIT          (opencv_zoo/models/face_detection_yunet)
#   face_recognition_sface_2021dec.onnx  SFace, Apache-2.0   (opencv_zoo/models/face_recognition_sface)
#   person_reid_youtu_2021nov.onnx       youtureid, Apache-2.0 files, research-set training (WO-675 P2, body.py)
# SFace and youtureid were trained on research-only datasets (WO-675): fetched per machine on the operator's request,
# never committed (~140 MB), never shipped on an ISO. Checksums pin the exact files verified on the box 22.10.
#   fetch-face-models.sh [--dry-run]       Output: $MODELS/ (runtime-lib.sh); a file with the right checksum is kept.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/runtime-lib.sh"
[[ "${1:-}" == "--dry-run" ]] && DRY=1
trap on_term TERM INT
take_lock
BASE="https://github.com/opencv/opencv_zoo/raw/main/models"
step face "Face models (OpenCV Zoo)"
run mkdir -p "$MODELS"
N=0
fetch() {
	local rel="$1" sum="$2" out
	out="$MODELS/$(basename "$rel")"
	N=$((N + 1))
	if [[ -f "$out" ]] && echo "$sum  $out" | sha256sum -c --status; then
		echo "ok      $out"
	elif dry; then
		printf '+ curl -fL -o %s %s/%s (sha256 %s)\n' "$out" "$BASE" "$rel" "$sum"
	else
		dl "$BASE/$rel" "$out.dl"
		echo "$sum  $out.dl" | sha256sum -c --status || { rm -f "$out.dl"; fail 16 "checksum mismatch: $rel"; }
		mv -f "$out.dl" "$out"
		echo "fetched $out"
	fi
	pct $((N * 33))
}
fetch face_detection_yunet/face_detection_yunet_2023mar.onnx 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4
fetch face_recognition_sface/face_recognition_sface_2021dec.onnx 0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79
fetch person_reid_youtureid/person_reid_youtu_2021nov.onnx 0579683334d4b9440221606dcb461656dd0dc64143b18f48faedaced9b4f580d
done_step face
