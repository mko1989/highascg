#!/usr/bin/env bash
# Capture xrandr --query at X session start for GPU port topology (WO-76).
# Installed by scripts/setup/09-openbox-autostart.sh
set -euo pipefail

ROOT="${HIGHASCG_REPO:-${HOME}/highascg}"
OUT_DIR="${ROOT}/data/runtime"
QUERY_FILE="${OUT_DIR}/boot-xrandr-query.txt"
META_FILE="${OUT_DIR}/boot-xrandr-meta.json"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"

mkdir -p "${OUT_DIR}"

if ! command -v xrandr >/dev/null 2>&1; then
	exit 0
fi

if ! xrandr --query >"${QUERY_FILE}" 2>/dev/null; then
	rm -f "${QUERY_FILE}"
	exit 0
fi

TS="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
HOST="$(hostname 2>/dev/null || echo unknown)"
printf '%s\n' "{\"capturedAt\":\"${TS}\",\"display\":\"${DISPLAY}\",\"hostname\":\"${HOST}\"}" >"${META_FILE}"
