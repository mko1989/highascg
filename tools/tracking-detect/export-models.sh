#!/usr/bin/env bash
# WO-616 T9 / WO-1094: export Ultralytics YOLO26 weights to ONNX for tools/tracking-detect/sidecar.py.
# The YOLO26 weights and ultralytics are AGPL-3.0 (Ultralytics), so the models are not committed to the repo and never
# shipped on an ISO; each machine downloads and exports its own (the operator's Install click in Previs → Tracking →
# Detect runs this through install.sh). Exported with end2end=False, which gives the [1,84,8400] head; the sidecar
# handles both heads.
#   export-models.sh [--force] [--dry-run] [model ...]   (default: yolo26n yolo26s; also yolo26n-seg, yolo26n-pose)
# Output: $MODELS/<model>.onnx. A model already there is skipped (--force re-exports). The export venv (CPU torch from
# download.pytorch.org — the exporter needs no GPU, and the CUDA build is GBs more), the .pt downloads and pip's cache sit
# in $PREFIX/install-work: kept when the run fails or is cancelled (a re-run resumes), deleted once every model is out.
# Never run from CI (it downloads ~1 GB).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/runtime-lib.sh"

ULTRALYTICS="ultralytics==8.4.182"
ASSETS="https://github.com/ultralytics/assets/releases/download/v8.4.0"
TORCH_INDEX="${HIGHASCG_TORCH_INDEX:-https://download.pytorch.org/whl/cpu}"
FORCE=0
LIST=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--force) FORCE=1 ;;
		--dry-run) DRY=1 ;;
		-*) fail 2 "unknown option $1" ;;
		*) LIST+=("${1%.onnx}") ;;
	esac
	shift
done
[[ ${#LIST[@]} -eq 0 ]] && LIST=(yolo26n yolo26s)
trap on_term TERM INT
take_lock

TODO=()
for m in "${LIST[@]}"; do
	if [[ "$FORCE" == 1 || ! -s "$MODELS/$m.onnx" ]]; then TODO+=("$m"); else echo "ok      $MODELS/$m.onnx (already there)"; fi
done
if [[ ${#TODO[@]} -eq 0 ]]; then
	exit 0
fi

need_python
step exporter "Model exporter (Ultralytics, CPU PyTorch — temporary)"
TMPV="$WORK/export-venv"
run mkdir -p "$WORK" "$MODELS"
export PIP_CACHE_DIR="$WORK/pip-cache" YOLO_CONFIG_DIR="$WORK/ultralytics" XDG_CACHE_HOME="$WORK/cache" MPLCONFIGDIR="$WORK/mpl"
if [[ ! -x "$TMPV/bin/python" ]]; then
	run python3 -m venv --without-pip "$TMPV" || fail 12 "python3 -m venv failed for $TMPV" "sudo apt install python3-venv"
fi
bootstrap_pip "$TMPV/bin/python" "$WHEELS"
pct 5
PIP_PCT="5 60" pip_run "$TMPV/bin/python" install --index-url "$TORCH_INDEX" torch torchvision || fail 14 "pip could not install CPU PyTorch from $TORCH_INDEX"
pct 60
PIP_PCT="60 95" pip_run "$TMPV/bin/python" install "$ULTRALYTICS" onnx onnxslim onnxruntime || fail 14 "pip could not install $ULTRALYTICS"
if ! dry && ! "$TMPV/bin/python" -c 'import ultralytics' 2>"$WORK/import.err"; then
	if grep -q 'libGL\.so\|libgthread\|libglib' "$WORK/import.err"; then
		fail 13 "the exporter needs the system OpenGL / GLib libraries" "sudo apt install libgl1 libglib2.0-0t64"
	fi
	cat "$WORK/import.err" >&2
	fail 17 "ultralytics installed but does not import (see the log)"
fi
done_step exporter

for m in "${TODO[@]}"; do
	step "model:$m" "Model $m (download + export to ONNX)"
	dl "$ASSETS/$m.pt" "$WORK/$m.pt" 60
	if ! dry; then
		(cd "$WORK" && "$TMPV/bin/python" -c "from ultralytics import YOLO; YOLO('$m.pt').export(format='onnx', imgsz=640, opset=17, simplify=True, end2end=False)") \
			|| fail 17 "the ONNX export of $m failed (see the log)"
	fi
	run install -D -m 0644 "$WORK/$m.onnx" "$MODELS/$m.onnx.part"
	run mv -f "$MODELS/$m.onnx.part" "$MODELS/$m.onnx"
	dry || sha256sum "$MODELS/$m.onnx"
	done_step "model:$m"
done
run rm -rf "$WORK/export-venv" "$WORK/pip-cache" "$WORK/ultralytics" "$WORK/cache" "$WORK/mpl"
for m in "${TODO[@]}"; do run rm -f "$WORK/$m.pt" "$WORK/$m.onnx"; done
run rmdir "$WORK" 2>/dev/null || true
