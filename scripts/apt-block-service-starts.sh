#!/usr/bin/env bash
# Block systemd service starts during apt/dpkg (nvidia-persistenced hangs without GPU).
# Source and call highascg_apt_block_service_starts / highascg_apt_unblock_service_starts.
set -euo pipefail

HIGHASCG_POLICY_RC=/usr/sbin/policy-rc.d

highascg_apt_block_service_starts() {
	if [[ -x "$HIGHASCG_POLICY_RC" ]]; then
		return 0
	fi
	cat >"$HIGHASCG_POLICY_RC" <<'EOF'
#!/bin/sh
# HighAsCG: skip service starts during NVIDIA driver package install
exit 101
EOF
	chmod 0755 "$HIGHASCG_POLICY_RC"
	systemctl mask nvidia-persistenced 2>/dev/null || true
}

highascg_apt_unblock_service_starts() {
	rm -f "$HIGHASCG_POLICY_RC"
	systemctl unmask nvidia-persistenced 2>/dev/null || true
}
