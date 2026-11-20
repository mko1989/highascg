#!/usr/bin/env bash
# WO-1094: shared by setup-venv.sh, export-models.sh, fetch-face-models.sh and install.sh (sourced, never run).
# Paths: everything lives under one prefix in the user's home (no root needed, outside the repo, outside every ISO —
# penguins-eggs excludes home/*/.local/share/highascg, verify-iso-detection-runtime.sh asserts it):
#   HIGHASCG_TRACKING_PREFIX   ~/.local/share/highascg
#   HIGHASCG_TRACKING_VENV     $PREFIX/tracking-venv     the sidecar's Python (not relocatable: rebuilt per machine)
#   HIGHASCG_TRACKING_MODELS   $PREFIX/models            the ONNX models
#   $PREFIX/wheels             the core wheels (pip download) — what an install-from-folder bundle carries
#   $PREFIX/install-work       downloads + the temporary export venv; kept on failure / cancel (a re-run resumes), deleted on success
# Progress for the GUI job (src/tracking/runtime-job.js): lines "@@ <json>" on stdout —
#   {"plan":[ids]} {"step":id,"label":text} {"pct":0-100} {"done":id} {"error":code,"msg":text,"apt":"sudo apt …"} {"ok":true}
# Everything else on stdout / stderr is log. HIGHASCG_TRACKING_DRY_RUN=1 (or --dry-run): print the plan and the commands,
# change nothing, check nothing over the network. Exit codes: see fail() callers (10 network, 11 disk, 12 python, 13 tool,
# 14 pip, 15 download, 16 checksum, 17 export, 20 busy, 30 bundle).

PREFIX="${HIGHASCG_TRACKING_PREFIX:-$HOME/.local/share/highascg}"
VENV="${HIGHASCG_TRACKING_VENV:-$PREFIX/tracking-venv}"
MODELS="${HIGHASCG_TRACKING_MODELS:-$PREFIX/models}"
WHEELS="$PREFIX/wheels"
WORK="$PREFIX/install-work"
TD_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY="${HIGHASCG_TRACKING_DRY_RUN:-0}"

dry() { [[ "$DRY" == "1" ]]; }

json_str() {
	local s="${1//\\/\\\\}"
	s="${s//\"/\\\"}"
	s="$(printf '%s' "$s" | tr -d '\000-\037')"
	printf '"%s"' "$s"
}

emit() { printf '@@ %s\n' "$1"; }
step() { emit "{\"step\":$(json_str "$1"),\"label\":$(json_str "$2")}"; }
pct() { emit "{\"pct\":$1}"; }
done_step() { emit "{\"done\":$(json_str "$1")}"; }

# fail CODE MESSAGE [APT-COMMAND]
fail() {
	local apt=""
	[[ -n "${3:-}" ]] && apt=",\"apt\":$(json_str "$3")"
	emit "{\"error\":$1,\"msg\":$(json_str "$2")$apt}"
	echo "ERROR: $2${3:+ — run: $3}" >&2
	exit "$1"
}

# run CMD… — the command, or its echo in a dry run
run() {
	if dry; then
		printf '+ %s\n' "$*"
		return 0
	fi
	"$@"
}

# free MiB on the filesystem that holds $1 (the nearest existing parent); HIGHASCG_TRACKING_FREE_MB fakes it (tests)
free_mb() {
	if [[ -n "${HIGHASCG_TRACKING_FREE_MB:-}" ]]; then
		echo "$HIGHASCG_TRACKING_FREE_MB"
		return
	fi
	local d="$1"
	while [[ ! -d "$d" && "$d" != "/" ]]; do d="$(dirname "$d")"; done
	df -Pm "$d" | awk 'NR==2 {print $4}'
}

# need_space MiB DIR WHAT
need_space() {
	local have
	have="$(free_mb "$2")"
	if [[ "$have" -lt "$1" ]]; then
		fail 11 "not enough disk space for $3: needs $(($1 / 1024)).$((($1 % 1024) * 10 / 1024)) GB free in $2, has $((have / 1024)).$(((have % 1024) * 10 / 1024)) GB"
	fi
	echo "disk: $have MiB free in $2 (needs $1 for $3)"
}

need_tool() {
	command -v "$1" >/dev/null 2>&1 || fail 13 "the tool '$1' is missing" "sudo apt install $2"
}

# need_net HOST-URL… — every URL must answer (any HTTP status); honours https_proxy like pip and curl do
need_net() {
	local u why
	dry && { echo "+ check internet: $*"; return 0; }
	for u in "$@"; do
		if ! why="$(curl -sS -o /dev/null --max-time 12 -I "$u" 2>&1)"; then
			why="$(printf '%s' "$why" | tail -1)"
			fail 10 "no internet: cannot reach ${u#https://}${why:+ ($why)} — installing needs internet, or install from a folder made on another machine"
		fi
	done
	echo "internet: ok ($*)"
}

# the system Python every venv is built from: python3 ≥ 3.10
need_python() {
	command -v python3 >/dev/null 2>&1 || fail 12 "python3 is not installed" "sudo apt install python3"
	SYS_PY_VER="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
	python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || fail 12 "python3 $SYS_PY_VER is too old (3.10 or newer)" "sudo apt install python3"
	python3 -c 'import venv' 2>/dev/null || fail 12 "python3 has no venv module" "sudo apt install python3-venv"
}

# WO-1127: which core requirements file this machine gets → sets CORE_REQ + CORE_FLAVOUR (gpu | cpu).
# HIGHASCG_TRACKING_GPU=1 / 0 forces it; otherwise gpu when an offline wheel folder ($1) carries the GPU wheel, or —
# online — when the NVIDIA driver answers (nvidia-smi -L). The GPU wheels bring their own CUDA / cuDNN.
core_requirements() {
	local src="${1:-}" want="${HIGHASCG_TRACKING_GPU:-auto}"
	if [[ "$want" == auto ]]; then
		want=0
		if [[ -n "$src" ]]; then
			ls "$src"/onnxruntime_gpu-*.whl >/dev/null 2>&1 && want=1
		elif nvidia-smi -L >/dev/null 2>&1; then
			want=1
		fi
	fi
	if [[ "$want" == 1 ]]; then
		CORE_FLAVOUR=gpu
		CORE_REQ="$TD_HERE/requirements-gpu.txt"
	else
		CORE_FLAVOUR=cpu
		CORE_REQ="$TD_HERE/requirements.txt"
	fi
}

# dl URL OUT [TOP] — resumable download (OUT.part, curl -C -) with @@ pct 0…TOP (default 100) while it runs; skips an
# existing OUT
dl() {
	local url="$1" out="$2" top="${3:-100}" total sz p
	if [[ -s "$out" ]]; then
		pct "$top"
		return 0
	fi
	if dry; then
		printf '+ curl -fL -C - -o %s %s\n' "$out.part" "$url"
		return 0
	fi
	total="$(curl -sSIL --max-time 20 "$url" 2>/dev/null | tr -d '\r' | awk 'tolower($1) == "content-length:" {v = $2} END {print v + 0}')"
	curl -fL --retry 3 --retry-delay 2 -sS -C - -o "$out.part" "$url" &
	local pid=$!
	while kill -0 "$pid" 2>/dev/null; do
		if [[ "$total" -gt 0 ]]; then
			sz="$(stat -c %s "$out.part" 2>/dev/null || echo 0)"
			p=$((sz * top / total))
			pct "$((p >= top ? top - 1 : p))"
		fi
		sleep 1
	done
	wait "$pid" || fail 15 "download failed: $url (curl exit $?)"
	mv -f "$out.part" "$out"
	pct "$top"
}

# pip_progress [LO HI] — pip output with --progress-bar raw ("Progress <n> of <total>", per file) turned into @@ pct
# within LO..HI of the step (the job keeps a step's percent from going back when the next file starts)
pip_progress() {
	local line lo="${1:-0}" hi="${2:-100}"
	while IFS= read -r line; do
		if [[ "$line" =~ ^Progress\ ([0-9]+)\ of\ ([0-9]+) ]]; then
			[[ "${BASH_REMATCH[2]}" -gt 0 ]] && pct "$((lo + BASH_REMATCH[1] * (hi - lo) / BASH_REMATCH[2]))"
		else
			printf '%s\n' "$line"
		fi
	done
}

# pip_run PYTHON ARGS… — pip with progress (within PIP_PCT="LO HI" of the step), its exit code kept (PIPESTATUS)
pip_run() {
	local py="$1"
	shift
	if dry; then
		printf '+ %s -m pip %s\n' "$py" "$*"
		return 0
	fi
	# shellcheck disable=SC2086 # PIP_PCT is two numbers
	"$py" -m pip "$@" --progress-bar raw --disable-pip-version-check 2>&1 | pip_progress ${PIP_PCT:-}
	return "${PIPESTATUS[0]}"
}

# bootstrap_pip PYTHON [WHEEL-DIR] — pip into a venv made --without-pip: ensurepip (python3-venv), else pip's own wheel
# from WHEEL-DIR (offline), else get-pip.py (this box's python3 has no ensurepip)
bootstrap_pip() {
	local py="$1" wh="${2:-}" whl
	if dry; then
		echo "+ bootstrap pip into $py"
		return 0
	fi
	"$py" -m pip --version >/dev/null 2>&1 && return 0
	"$py" -m ensurepip --upgrade >/dev/null 2>&1 && return 0
	whl="$(ls "$wh"/pip-*.whl 2>/dev/null | sort -V | tail -1 || true)"
	if [[ -n "$whl" ]]; then
		"$py" "$whl/pip" install --no-index --find-links "$wh" pip || fail 14 "pip could not be installed from $whl"
		return 0
	fi
	mkdir -p "$WORK"
	curl -fsSL --retry 3 https://bootstrap.pypa.io/get-pip.py -o "$WORK/get-pip.py" || fail 15 "download failed: get-pip.py (bootstrap.pypa.io)"
	"$py" "$WORK/get-pip.py" --disable-pip-version-check || fail 14 "get-pip.py could not install pip"
	rm -f "$WORK/get-pip.py"
}

# features.json → the model files of the features named in $1 ("person,pose"), one per line
feature_models() {
	python3 - "$TD_HERE/features.json" "$1" "${2:-}" <<'PY'
import json, sys
spec = json.load(open(sys.argv[1]))
want = [f for f in sys.argv[2].split(",") if f]
src = sys.argv[3]
for f in want:
    feat = spec["features"].get(f)
    if feat is None:
        sys.stderr.write("unknown feature: %s\n" % f)
        sys.exit(2)
    if src and feat.get("source") != src:
        continue
    for m in feat["models"] + feat.get("optional", []):
        print(m)
PY
}

on_term() {
	trap - TERM INT
	emit '{"cancelled":true}'
	pkill -TERM -P $$ 2>/dev/null # the running pip / curl (never `kill 0`: a non-interactive caller can share our group)
	exit 143
}

# one install at a time per prefix (the GUI job and a shell run alike)
# (install.sh takes it; the scripts it runs inherit it — HIGHASCG_TRACKING_LOCKED — and take it themselves when run alone)
take_lock() {
	dry && return 0
	[[ "${HIGHASCG_TRACKING_LOCKED:-}" == "$PREFIX" ]] && return 0
	mkdir -p "$PREFIX"
	exec 9>"$PREFIX/.install.lock"
	flock -n 9 || fail 20 "another install is already running for $PREFIX"
	export HIGHASCG_TRACKING_LOCKED="$PREFIX"
}
