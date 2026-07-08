#!/usr/bin/env bash
# Enable Syncthing for casparcg, bind GUI on LAN/Tailnet, ensure .stignore exists.
# Pairing with Mac is manual (device IDs) — see script output.
set -euo pipefail

USER_CASPAR="${1:-casparcg}"
REPO="${2:-/home/${USER_CASPAR}/highascg}"
STIGNORE="${REPO}/.stignore"

if [[ "$(id -un)" != root ]]; then
	echo "Run: sudo bash $0 [user] [repo_path]" >&2
	exit 1
fi

if ! command -v syncthing >/dev/null 2>&1; then
	echo "Installing syncthing…" >&2
	mkdir -p /etc/apt/keyrings
	curl -fsSL -o /etc/apt/keyrings/syncthing-archive-keyring.gpg https://syncthing.net/release-key.gpg
	echo "deb [signed-by=/etc/apt/keyrings/syncthing-archive-keyring.gpg] https://apt.syncthing.net/ syncthing stable" \
		> /etc/apt/sources.list.d/syncthing.list
	apt-get update -qq
	DEBIAN_FRONTEND=noninteractive apt-get install -y syncthing
fi

mkdir -p /etc/systemd/system/syncthing@.service.d
cat > /etc/systemd/system/syncthing@.service.d/highascg-gui.conf <<'EOF'
[Service]
Environment=STGUIADDRESS=0.0.0.0:8384
EOF

systemctl daemon-reload
systemctl enable "syncthing@${USER_CASPAR}"
systemctl restart "syncthing@${USER_CASPAR}"

if [[ ! -f "$STIGNORE" ]]; then
	echo "WARN: missing $STIGNORE — copy from repo or create before sharing folder" >&2
fi

PRIMARY_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
DEVICE_ID="$(sudo -u "$USER_CASPAR" syncthing --device-id 2>/dev/null | tail -1 || true)"

cat <<EOF

Syncthing enabled for ${USER_CASPAR}.

  GUI (this machine):  http://${PRIMARY_IP:-127.0.0.1}:8384/
  Device ID:           ${DEVICE_ID:-run: sudo -u ${USER_CASPAR} syncthing --device-id}

Mac setup:
  1. Install Syncthing (Syncthing.app or brew install syncthing).
  2. Add remote device → paste Linux device ID above.
  3. On Linux GUI: Actions → Show ID → add Mac device when prompted.
  4. Create/share folder on ONE side:
       Path: ${REPO}
       Folder ID: highascg   (same on both sides)
       Type: Send & Receive (or Send Only from Mac if playout is canonical)
  5. Copy the same .stignore into the folder root on both sides (already at ${STIGNORE}).

Excluded by .stignore: media, bin, cef-cache, node_modules, log, data, live config JSON, etc.

EOF
