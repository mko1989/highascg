#!/usr/bin/env bash
# WO-1103 — OWNER-RUN: build Epic's OpenRigLogic DNA library (MIT, "Copyright (c) 2026 Epic Games, Inc.") with its
# Python bindings, so tools/people/dna_to_glb.py can read a MetaHuman DNA file (e.g. Fab "OpenRigLogic Sample
# Content") on THIS machine. Agents do not clone or build external projects; the owner runs this once:
#
#   sudo apt install git cmake g++ swig python3-dev        # build tools (if missing)
#   tools/people/openriglogic_build.sh                     # ~5–10 min; nothing needs root
#
# Fetches the pinned commit of the stable 5.8 branch (no character data — the repository holds only the libraries),
# builds the static DNA library + the `dna` Python module (RigLogic itself is not needed for a neutral puppet), runs
# Epic's own DNA Python test, and installs into ~/.local/share/highascg/openriglogic/ (per machine, never shipped:
# the ISO excludes ~/.local/share/highascg). Re-running rebuilds. Remove with: rm -rf ~/.local/share/highascg/openriglogic
set -euo pipefail

REPO=https://github.com/EpicGames/OpenRigLogic.git
COMMIT=d3d329bbd6992ac38adc1c1b24203ceb998f75c0 # branch 5.8 ("Production-Ready") on 16.11.2026
PREFIX="${HIGHASCG_OPENRIGLOGIC:-$HOME/.local/share/highascg/openriglogic}"
WORK="${PREFIX}/build-work"

for t in git cmake g++ swig python3; do
	command -v "$t" >/dev/null || { echo "missing: $t — sudo apt install git cmake g++ swig python3-dev" >&2; exit 1; }
done
PYV=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
python3 -c 'import sysconfig, os, sys; sys.exit(0 if os.path.exists(os.path.join(sysconfig.get_paths()["include"], "Python.h")) else 1)' ||
	{ echo "missing: Python headers — sudo apt install python3-dev" >&2; exit 1; }

mkdir -p "$WORK"
if [ ! -d "$WORK/src/.git" ]; then
	git -C "$WORK" clone --filter=blob:none --no-checkout "$REPO" src
fi
git -C "$WORK/src" fetch --depth 1 origin "$COMMIT"
git -C "$WORK/src" -c advice.detachedHead=false checkout --force "$COMMIT"
echo "OpenRigLogic at $(git -C "$WORK/src" rev-parse HEAD)"

cmake -S "$WORK/src" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
	-DRL_BUILD_PYTHON_WRAPPER="$PYV" -DREAD_ONLY_SOURCE_TREE=ON -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
	-DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib
cmake --build "$WORK/build" -j"$(nproc)"
cmake --install "$WORK/build"

PYTHONPATH="$PREFIX/lib" python3 - "$WORK/src/python/dna/tests/test_dna.py" <<'PY'
import runpy, sys
import dna  # the module this build installed
print("dna module:", dna.__file__)
sys.argv = [sys.argv[1]]
runpy.run_path(sys.argv[0], run_name="__main__")
PY
cp "$WORK/src/LICENSE" "$PREFIX/LICENSE"
echo "$COMMIT" > "$PREFIX/COMMIT"
echo "OK: $PREFIX/lib holds the dna module — HighAsCG converts a MetaHuman DNA folder in"
echo "    ~/.local/share/highascg/puppets/<name>/ when you pick it in Test people ▸ Look (or: tools/people/dna_to_glb.py <folder>)"
