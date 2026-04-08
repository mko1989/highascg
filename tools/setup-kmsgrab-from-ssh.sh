#!/usr/bin/env bash
# Run on the Caspar / HighAsCG machine over SSH (needs sudo).
# Adds the HighAsCG user to video+render, shows /dev/dri, prints test + restart commands.
#
#   curl -fsSL .../setup-kmsgrab-from-ssh.sh | sudo bash
#   sudo bash /opt/highascg/tools/setup-kmsgrab-from-ssh.sh
#
# After this: sudo systemctl restart highascg
# You do NOT need SSH to have a DISPLAY; kmsgrab uses DRM nodes under /dev/dri, not X11.

set -euo pipefail

USER_NAME="${USER_NAME:-casparcg}"

if [[ $(id -u) -ne 0 ]]; then
	echo "Run as root: sudo bash $0"
	exit 1
fi

echo "=== Groups video + render for user: $USER_NAME ==="
if ! id "$USER_NAME" &>/dev/null; then
	echo "User $USER_NAME does not exist."
	exit 1
fi

for g in video render; do
	if ! getent group "$g" &>/dev/null; then
		echo "WARNING: group '$g' is missing on this system."
	fi
done

if ! id -nG "$USER_NAME" | tr ' ' '\n' | grep -qx video; then
	usermod -aG video "$USER_NAME"
	echo "Added $USER_NAME to group: video"
else
	echo "Already in group: video"
fi

if ! id -nG "$USER_NAME" | tr ' ' '\n' | grep -qx render; then
	usermod -aG render "$USER_NAME"
	echo "Added $USER_NAME to group: render"
else
	echo "Already in group: render"
fi

echo ""
echo "=== /dev/dri (DRM nodes; kmsgrab needs a card + access) ==="
if [[ ! -d /dev/dri ]]; then
	echo "No /dev/dri — no DRM stack (VM without GPU, or drivers missing)."
	exit 1
fi
ls -la /dev/dri/

mapfile -t DRM_CARDS < <(ls /dev/dri/card[0-9] 2>/dev/null || true)
if [[ ${#DRM_CARDS[@]} -eq 0 ]]; then
	echo "No /dev/dri/cardN found. Check GPU drivers (nvidia, amdgpu, i915)."
	exit 1
fi

DRM_DEV="${DRM_CARDS[0]}"
echo ""
echo "DRM cards found: ${DRM_CARDS[*]}"
echo "Suggested drmDevice to try first: \"$DRM_DEV\""

echo ""
echo "=== ffmpeg kmsgrab test (each card, 1 frame to null) ==="
BEST_DEV=""
BEST_RC=99
for card in "${DRM_CARDS[@]}"; do
	echo "--- $card ---"
	set +e
	ERR=$(mktemp)
	sudo -u "$USER_NAME" ffmpeg -hide_banner -nostats -loglevel error \
		-device "$card" -framerate 15 -f kmsgrab -i - \
		-frames:v 1 -f null - 2>"$ERR"
	RC=$?
	if [[ -s "$ERR" ]]; then
		head -5 "$ERR" | sed 's/^/  /'
	fi
	rm -f "$ERR"
	set -e
	if [[ "$RC" -eq 0 ]]; then
		echo "  -> OK"
		BEST_DEV="$card"
		BEST_RC=0
		break
	else
		echo "  -> failed (exit $RC)"
		if [[ "$RC" -lt "$BEST_RC" ]] || [[ -z "$BEST_DEV" ]]; then
			BEST_DEV="$card"
			BEST_RC=$RC
		fi
	fi
done

DRM_DEV="$BEST_DEV"
if [[ -z "$DRM_DEV" ]]; then
	DRM_DEV="${DRM_CARDS[0]}"
fi

echo ""
if [[ "$BEST_RC" -eq 0 ]]; then
	echo "kmsgrab: working on \"$DRM_DEV\""
else
	echo "kmsgrab: FAILED on all tried cards (best guess device: \"$DRM_DEV\")."
	echo ""
	echo "  \"No usable planes found\" usually means:"
	echo "    - Proprietary NVIDIA often has no KMS planes for standard kmsgrab (use SRT/NDI from Caspar instead)."
	echo "    - Wrong GPU (monitor on another card) — plug monitor into the GPU you capture, or try the other card*."
	echo "    - No active framebuffer (headless / no display)."
	echo ""
	echo "  Recommended for Caspar + HighAsCG live preview:"
	echo "    In highascg.config.json set:"
	echo "      \"captureMode\": \"srt\""
	echo "    and caspar.host to 127.0.0.1 so go2rtc pulls SRT from Caspar (no screen grab)."
	echo ""
	echo "  Alternative: \"localCaptureDevice\": \"x11grab\" with DISPLAY=:0 if a local X session draws the desktop"
	echo "    (systemd may need XAUTHORITY — more fragile than SRT)."
fi

echo ""
echo "=== Next steps (only if kmsgrab test succeeded above) ==="
if [[ "$BEST_RC" -eq 0 ]]; then
	echo "1) In /opt/highascg/highascg.config.json under \"streaming\":"
	echo "     \"localCaptureDevice\": \"kmsgrab\","
	echo "     \"drmDevice\": \"$DRM_DEV\""
	echo "2) sudo systemctl restart highascg"
	echo "3) Check /opt/highascg/go2rtc.yaml uses -device $DRM_DEV"
else
	echo "Skip kmsgrab; switch streaming.captureMode to \"srt\" (or fix GPU/planes), then:"
	echo "  sudo systemctl restart highascg"
fi
