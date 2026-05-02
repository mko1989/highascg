#!/usr/bin/env bash
set -euo pipefail

# Capture GPU mapping evidence for WO-35 reboot regression.
# Usage:
#   DISPLAY=:0 ./tools/gpu-map-reboot-capture.sh

OUT_DIR="${OUT_DIR:-/tmp/highascg-gpu-map-regression}"
TS="$(date +%F_%H%M%S)"
RUN_DIR="${OUT_DIR}/${TS}"

mkdir -p "${RUN_DIR}"

echo "[gpu-map] writing capture to: ${RUN_DIR}"

{
  echo "timestamp=${TS}"
  echo "hostname=$(hostname)"
  echo "kernel=$(uname -a)"
  echo "display=${DISPLAY:-unset}"
} > "${RUN_DIR}/meta.txt"

if command -v xrandr >/dev/null 2>&1; then
  xrandr --query > "${RUN_DIR}/xrandr-query.txt" 2>&1 || true
  xrandr --verbose > "${RUN_DIR}/xrandr-verbose.txt" 2>&1 || true
fi

if [ -d /sys/class/drm ]; then
  ls -1 /sys/class/drm | rg "^card[0-9]+-" > "${RUN_DIR}/drm-connector-list.txt" || true
  for s in /sys/class/drm/card*-*/status; do
    [ -e "$s" ] || continue
    echo "=== ${s} ===" >> "${RUN_DIR}/drm-status.txt"
    cat "$s" >> "${RUN_DIR}/drm-status.txt"
  done
  for e in /sys/class/drm/card*-*/enabled; do
    [ -e "$e" ] || continue
    echo "=== ${e} ===" >> "${RUN_DIR}/drm-enabled.txt"
    cat "$e" >> "${RUN_DIR}/drm-enabled.txt"
  done
  for ed in /sys/class/drm/card*-*/edid; do
    [ -e "$ed" ] || continue
    if [ -s "$ed" ]; then
      sha1sum "$ed" >> "${RUN_DIR}/drm-edid-sha1.txt"
    else
      echo "${ed} no-edid" >> "${RUN_DIR}/drm-edid-sha1.txt"
    fi
  done
fi

if command -v nvidia-settings >/dev/null 2>&1; then
  nvidia-settings -q dpys -q gpus -t > "${RUN_DIR}/nvidia-dpys-gpus.txt" 2>&1 || true
  nvidia-settings -q CurrentMetaMode -t > "${RUN_DIR}/nvidia-current-metamode.txt" 2>&1 || true
fi

if command -v curl >/dev/null 2>&1; then
  curl -fsS "http://127.0.0.1:8080/api/device-view/gpu-map-debug" > "${RUN_DIR}/gpu-map-debug.json" 2>/dev/null || true
fi

echo "[gpu-map] done: ${RUN_DIR}"
