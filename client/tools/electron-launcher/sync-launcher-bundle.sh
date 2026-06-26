#!/usr/bin/env bash
# Copy runtime deps into electron-launcher/ so @electron/packager ships a self-contained app.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${HERE}/../../.." && pwd)"
PD="${ROOT}/client/tools/portable-desktop"

mkdir -p "${HERE}/lib" "${HERE}/portable-sim"

for f in webui-port.cjs webui-port.json; do
	src="${ROOT}/client/lib/${f}"
	dst="${HERE}/lib/${f}"
	[[ -f "$src" ]] || { echo "Missing $src" >&2; exit 1; }
	cp -f "$src" "$dst"
done

for f in launch-sim-from-exfat.cjs sim-app-root.cjs; do
	src="${PD}/${f}"
	dst="${HERE}/portable-sim/${f}"
	[[ -f "$src" ]] || { echo "Missing $src" >&2; exit 1; }
	cp -f "$src" "$dst"
done

echo "Synced launcher bundle → ${HERE}/lib + ${HERE}/portable-sim"
