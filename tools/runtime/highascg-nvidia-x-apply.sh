#!/bin/bash
# HighAsCG NVIDIA playout display policy (run after xrandr layout — not before).
#
# Verified vsync stack for Caspar screen consumers on NVIDIA:
#   - Sync to VBlank OFF (driver must not double-sync with Caspar consumer vsync)
#   - Force Full Composition Pipeline ON for every connected output (MetaMode)
#   - Caspar <vsync>true</vsync> on screen consumers
#
# xrandr resets CurrentMetaMode and clears ForceFullCompositionPipeline; this script
# must run after apply-layout.sh (and retries until MetaMode is populated).
#
# Install: scripts/setup/09-openbox-autostart.sh → /usr/local/bin/highascg-nvidia-x-apply.sh
#
#   DISPLAY=:0 XAUTHORITY=/home/casparcg/.Xauthority highascg-nvidia-x-apply.sh

set -f

command -v nvidia-settings >/dev/null 2>&1 || exit 0

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME}/.Xauthority}"

_retries="${HIGHASCG_NVIDIA_APPLY_RETRIES:-12}"
_delay="${HIGHASCG_NVIDIA_APPLY_RETRY_SEC:-2}"

for _g in 0 1 2 3; do
	nvidia-settings -q "[gpu:${_g}]/GPUPowerMizerMode" &>/dev/null || continue
	nvidia-settings -a "[gpu:${_g}]/GPUPowerMizerMode=2" 2>/dev/null ||
		nvidia-settings -a "[gpu:${_g}]/GPUPowerMizerMode=1" 2>/dev/null || true
done

for _g in 0 1 2 3; do
	nvidia-settings -q "[gpu:${_g}]/SyncToVBlank" &>/dev/null || continue
	nvidia-settings -a "[gpu:${_g}]/SyncToVBlank=0" 2>/dev/null || true
done
nvidia-settings -a "[gpu:0]/SyncToVBlank=0" 2>/dev/null || true
nvidia-settings -a "[screen:0]/SyncToVBlank=0" 2>/dev/null || true

_patch_metamode() {
	_raw_meta=$(nvidia-settings -q CurrentMetaMode -t 2>/dev/null) || _raw_meta=""
	[ -n "$_raw_meta" ] || return 1
	command -v python3 >/dev/null 2>&1 || return 1
	_new_meta=$(printf '%s' "$_raw_meta" | python3 <<'PY'
import re, sys
raw = sys.stdin.read().strip()
if not raw:
    sys.exit(1)
prefix = ""
meta = raw
if " :: " in raw:
    prefix, meta = raw.split(" :: ", 1)
    prefix += " :: "

def patch_block(m):
    body = m.group(1)
    if "ForceFullCompositionPipeline=On" in body:
        return "{" + body + "}"
    body = body.strip().rstrip(",")
    add = "ForceFullCompositionPipeline=On"
    if body:
        body = body + ", " + add
    else:
        body = add
    return "{" + body + "}"

patched = re.sub(r"\{([^}]*)\}", patch_block, meta)
print(prefix + patched)
PY
) || return 1
	if [ -z "$_new_meta" ] || [ "$_new_meta" = "$_raw_meta" ]; then
		echo "$_raw_meta" | grep -q 'ForceFullCompositionPipeline=On'
		return $?
	fi
	nvidia-settings --assign "CurrentMetaMode=${_new_meta}" 2>/dev/null || return 1
	return 0
}

_try=1
while [ "$_try" -le "$_retries" ]; do
	if _patch_metamode; then
		exit 0
	fi
	if [ "$_try" -ge "$_retries" ]; then
		break
	fi
	sleep "$_delay"
	_try=$((_try + 1))
done

exit 0
