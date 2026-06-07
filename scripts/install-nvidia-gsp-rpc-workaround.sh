#!/usr/bin/env bash
# Work around NVIDIA 595.x GSP RPC noise / display glitches on Blackwell (RTX PRO 4000, etc.):
#
#   NVRM: _kgspProcessRpcEvent: Attempted to process RPC event from GPU0: 0x101a
#         (PFM_REQ_HNDLR_STATE_SYNC_CALLBACK) during bootup without API lock
#
# Often followed by "GSP RM heartbeat timed out" and blank screens after GC6 wake.
# Disabling runtime dynamic power management keeps the GPU awake on a 24/7 playout box.
#
#   sudo bash scripts/install-nvidia-gsp-rpc-workaround.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

CONF=/etc/modprobe.d/highascg-nvidia-gsp-workaround.conf

cat >"$CONF" <<'EOF'
# HighAsCG playout host: avoid 595.x GSP GC6/RPC regressions (blank screen, heartbeat timeout).
# See: https://github.com/NVIDIA/open-gpu-kernel-modules/issues/1145
options nvidia NVreg_DynamicPowerManagement=0x00
EOF
chmod 0644 "$CONF"

if [[ "${HIGHASCG_SKIP_INITRAMFS:-}" != "1" ]] && command -v update-initramfs >/dev/null 2>&1; then
	update-initramfs -u -k "$(uname -r)"
fi

echo "OK: ${CONF}"
echo "     NVreg_DynamicPowerManagement=0x00 (runtime PM off — appropriate for always-on playout)"
echo "Reboot for the setting to apply. RPC/heartbeat spam should stop or greatly reduce."
