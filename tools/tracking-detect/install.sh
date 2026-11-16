#!/usr/bin/env bash
# WO-1094: the person-detection runtime in one command — what the GUI's install job runs (src/tracking/runtime-job.js),
# and the same by hand. Everything under $HIGHASCG_TRACKING_PREFIX (default ~/.local/share/highascg, runtime-lib.sh);
# no root. Progress: "@@ <json>" lines (runtime-lib.sh).
#   install.sh [--features person,pose,seg[,face]] [--repair] [--dry-run]      online install / update / repair
#   install.sh --from DIR [--features …] [--dry-run]                          offline: from an exported bundle
#   install.sh --export-to DIR [--dry-run]                                    write a bundle for an offline machine
#   install.sh --remove [--keep-models] [--dry-run]                           delete the runtime
# Features and their models: features.json. Default features: person,pose,seg (face has its own models and licence
# terms, so it is asked for separately). The scripts it runs (setup-venv.sh, export-models.sh, fetch-face-models.sh)
# are idempotent, so a cancelled or interrupted run is resumed by running the same command again.
# A bundle ("highascg-detection-runtime/": wheels/ + models/ + manifest.json) holds the AGPL-3.0 YOLO26 weights: it is
# for the operator's own machines, and the ISO build / stick seeding / exFAT sync never carry it (WO-1094).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/runtime-lib.sh"

FEATURES="person,pose,seg"
MODE=install
REPAIR=0
KEEP_MODELS=0
DIR=""
BUNDLE_NAME="highascg-detection-runtime"
while [[ $# -gt 0 ]]; do
	case "$1" in
		--features) FEATURES="$2"; shift ;;
		--repair) REPAIR=1 ;;
		--from) MODE=from; DIR="$2"; shift ;;
		--export-to) MODE=export; DIR="$2"; shift ;;
		--remove) MODE=remove ;;
		--keep-models) KEEP_MODELS=1 ;;
		--dry-run) DRY=1 ;;
		*) fail 2 "unknown option $1" ;;
	esac
	shift
done
export HIGHASCG_TRACKING_DRY_RUN="$DRY"
trap on_term TERM INT
take_lock
SPACE="$(python3 -c 'import json,sys; s=json.load(open(sys.argv[1]))["space_mb"]; print(s["core"], s["export"], s["face"])' "$TD_HERE/features.json")"
read -r SPACE_CORE SPACE_EXPORT SPACE_FACE <<<"$SPACE"
YOLO=()
while IFS= read -r m; do [[ -n "$m" ]] && YOLO+=("${m%.onnx}"); done < <(feature_models "$FEATURES" ultralytics)
FACE=0
[[ ",$FEATURES," == *",face,"* ]] && FACE=1
CLEAR_ARG=""
[[ "$REPAIR" == 1 ]] && CLEAR_ARG="--clear"
REPO="$(cd "$TD_HERE/../.." && pwd)"

case "$MODE" in
remove)
	emit '{"plan":["remove"]}'
	step remove "Removing the detection runtime"
	for p in "$VENV" "$WHEELS" "$WORK"; do
		[[ -n "$p" && "$p" != "/" && "$p" != "$HOME" ]] && run rm -rf "$p"
	done
	[[ "$KEEP_MODELS" == 1 ]] || { [[ -n "$MODELS" && "$MODELS" != "/" && "$MODELS" != "$HOME" ]] && run rm -rf "$MODELS"; }
	done_step remove
	;;
export)
	[[ -x "$VENV/bin/python" ]] || fail 30 "nothing to export: the runtime is not installed"
	OUT="$DIR/$BUNDLE_NAME"
	case "$(realpath -m "$DIR")/" in "$REPO"/*) fail 30 "a bundle never goes inside the HighAsCG folder (it syncs): pick a stick or another folder" ;; esac
	emit '{"plan":["bundle"]}'
	step bundle "Writing the bundle to $OUT"
	need_python
	MB="$(du -sm "$MODELS" 2>/dev/null | awk '{print $1}')"
	need_space "$(( ${MB:-0} + 200 ))" "$DIR" "the bundle"
	run mkdir -p "$OUT/wheels" "$OUT/models"
	if ! ls "$WHEELS"/numpy-*.whl >/dev/null 2>&1; then
		need_net https://pypi.org/simple/pip/
		PIP_PCT="5 30" pip_run "$VENV/bin/python" download --dest "$WHEELS" -r "$TD_HERE/requirements.txt" pip || fail 14 "pip could not download the wheels"
	fi
	run cp -f "$WHEELS"/*.whl "$OUT/wheels/"
	pct 30
	if ls "$MODELS"/*.onnx >/dev/null 2>&1; then run cp -f "$MODELS"/*.onnx "$OUT/models/"; fi
	pct 80
	if ! dry; then
		python3 - "$OUT" "$SYS_PY_VER" "$TD_HERE/features.json" <<'PY'
import hashlib, json, os, platform, sys, time
out, py, feats = sys.argv[1], sys.argv[2], json.load(open(sys.argv[3]))
models = {}
for f in sorted(os.listdir(os.path.join(out, "models"))):
    p = os.path.join(out, "models", f)
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for b in iter(lambda: fh.read(1 << 20), b""):
            h.update(b)
    models[f] = {"bytes": os.path.getsize(p), "sha256": h.hexdigest()}
have = [k for k, v in feats["features"].items() if v["models"] and all(m in models for m in v["models"])]
json.dump({"kind": "highascg-detection-runtime", "version": 1, "python": py, "machine": platform.machine(),
           "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "features": have, "models": models,
           "wheels": sorted(os.listdir(os.path.join(out, "wheels")))}, open(os.path.join(out, "manifest.json"), "w"), indent=1)
PY
		cat >"$OUT/README.txt" <<'TXT'
HighAsCG person-detection runtime bundle (WO-1094) — for the operator's own machines.
Install on an offline HighAsCG box: Previs → Tracking → Detect → Install from folder (or tools/tracking-detect/install.sh --from <this folder>).
models/yolo26*.onnx are Ultralytics YOLO26 weights, AGPL-3.0 (https://github.com/ultralytics/ultralytics, https://www.gnu.org/licenses/agpl-3.0.html):
passing them on means passing them on under AGPL-3.0. The face models come from the OpenCV Zoo (YuNet MIT, SFace and
youtureid Apache-2.0, trained on research-only datasets). The wheels are numpy (BSD-3-Clause), opencv-python-headless
(Apache-2.0), onnxruntime (MIT) and pip (MIT) for one Python version (manifest.json).
TXT
	fi
	done_step bundle
	;;
from)
	SRC="$DIR"
	[[ -f "$SRC/manifest.json" ]] || SRC="$DIR/$BUNDLE_NAME"
	[[ -f "$SRC/manifest.json" ]] || fail 30 "no detection bundle in $DIR (expected $BUNDLE_NAME/manifest.json)"
	need_python
	BPY="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["python"])' "$SRC/manifest.json")"
	[[ "$BPY" == "$SYS_PY_VER" ]] || fail 30 "the bundle was made for Python $BPY, this machine has $SYS_PY_VER — export it from a machine with Python $SYS_PY_VER"
	plan='"core"'
	[[ ${#YOLO[@]} -gt 0 || "$FACE" == 1 ]] && plan="$plan,\"models\""
	emit "{\"plan\":[$plan]}"
	need_space "$SPACE_CORE" "$PREFIX" "the Python packages"
	bash "$TD_HERE/setup-venv.sh" $CLEAR_ARG --wheels "$SRC/wheels"
	if [[ ${#YOLO[@]} -gt 0 || "$FACE" == 1 ]]; then
		step models "Models from the bundle"
		run mkdir -p "$MODELS"
		WANT=()
		for m in "${YOLO[@]}"; do WANT+=("$m.onnx"); done
		[[ "$FACE" == 1 ]] && while IFS= read -r m; do WANT+=("$m"); done < <(feature_models face)
		MISSING=()
		for m in "${WANT[@]}"; do
			if [[ ! -f "$SRC/models/$m" ]]; then MISSING+=("$m"); continue; fi
			sum="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["models"][sys.argv[2]]["sha256"])' "$SRC/manifest.json" "$m")"
			if ! dry; then
				echo "$sum  $SRC/models/$m" | sha256sum -c --status || fail 16 "checksum mismatch in the bundle: $m"
			fi
			run cp -f "$SRC/models/$m" "$MODELS/$m.part"
			run mv -f "$MODELS/$m.part" "$MODELS/$m"
		done
		[[ ${#MISSING[@]} -gt 0 ]] && echo "not in the bundle: ${MISSING[*]}"
		done_step models
	fi
	;;
install)
	need_python
	need_tool curl curl
	plan='"preflight","core"'
	[[ ${#YOLO[@]} -gt 0 ]] && plan="$plan,\"exporter\"$(printf ',"model:%s"' "${YOLO[@]}")"
	[[ "$FACE" == 1 ]] && plan="$plan,\"face\""
	emit "{\"plan\":[$plan]}"
	step preflight "Checking internet and disk space"
	if [[ "$REPAIR" == 1 ]] && ! (need_net https://pypi.org/simple/pip/) >/dev/null 2>&1 && ls "$WHEELS"/numpy-*.whl >/dev/null 2>&1; then
		echo "offline: repairing from the local wheels in $WHEELS (models are left as they are)"
		done_step preflight
		bash "$TD_HERE/setup-venv.sh" --clear --wheels "$WHEELS"
		emit '{"ok":true}'
		exit 0
	fi
	need_net https://pypi.org/simple/pip/ https://github.com/ultralytics/assets/releases
	TODO=0
	for m in "${YOLO[@]}"; do [[ -s "$MODELS/$m.onnx" ]] || TODO=1; done
	need_space "$(( SPACE_CORE + TODO * SPACE_EXPORT + FACE * SPACE_FACE ))" "$PREFIX" "the detection runtime"
	done_step preflight
	bash "$TD_HERE/setup-venv.sh" $CLEAR_ARG
	if [[ ${#YOLO[@]} -gt 0 ]]; then
		bash "$TD_HERE/export-models.sh" "${YOLO[@]}"
		for m in "${YOLO[@]}"; do done_step "model:$m"; done
		done_step exporter
	fi
	[[ "$FACE" == 1 ]] && bash "$TD_HERE/fetch-face-models.sh"
	;;
esac
emit '{"ok":true}'
