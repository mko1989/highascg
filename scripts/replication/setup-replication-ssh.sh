#!/usr/bin/env bash
# Manual repair / pre-flight for hot-backup project media rsync (SSH keys).
#
# Normally keys exchange automatically on leader/follower Connect (register-follower).
# Run this only when pairing succeeded but rsync still fails (e.g. wiped ~/.ssh).
#   PEER=192.168.0.28 bash scripts/replication/setup-replication-ssh.sh
#   PEER=192.168.0.20 bash scripts/replication/setup-replication-ssh.sh   # on follower
#
# Optional:
#   REPL_SSH_KEY=~/.ssh/highascg_replication   (default)
#   REPL_SSH_USER=casparcg
#   INSTALL_DROPIN=1   write systemd env for IdentityFile (needs sudo)
#   --show-pubkey      print this host's replication public key and exit
#   --install-peer-key FILE   append peer pubkey to ~/.ssh/authorized_keys
set -euo pipefail

REPL_USER="${REPL_SSH_USER:-casparcg}"
KEY="${REPL_SSH_KEY:-$HOME/.ssh/highascg_replication}"
PEER="${PEER:-}"
INSTALL_DROPIN="${INSTALL_DROPIN:-0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
	echo "Usage: PEER=<leader-or-follower-ip> $0" >&2
	echo "       $0 --show-pubkey" >&2
	echo "       $0 --install-peer-key /path/to/peer.pub" >&2
	exit 1
}

ensure_key() {
	if [[ -f "$KEY" && -f "${KEY}.pub" ]]; then
		echo "==> Using existing key ${KEY}"
		return
	fi
	echo "==> Generating ${KEY} (ed25519, no passphrase — replication automation only)"
	mkdir -p "$(dirname "$KEY")"
	chmod 700 "$(dirname "$KEY")"
	ssh-keygen -t ed25519 -f "$KEY" -N '' -C "highascg-replication@$(hostname -s)"
}

install_self_in_authorized_keys() {
	mkdir -p "$HOME/.ssh"
	chmod 700 "$HOME/.ssh"
	touch "$HOME/.ssh/authorized_keys"
	chmod 600 "$HOME/.ssh/authorized_keys"
	local pub="${KEY}.pub"
	local line
	line="$(cat "$pub")"
	if grep -qF "$line" "$HOME/.ssh/authorized_keys" 2>/dev/null; then
		echo "==> Local pubkey already in authorized_keys"
	else
		echo "$line" >>"$HOME/.ssh/authorized_keys"
		echo "==> Added local replication pubkey to ~/.ssh/authorized_keys"
	fi
}

install_peer_key_file() {
	local f="${1:?peer pubkey file}"
	mkdir -p "$HOME/.ssh"
	chmod 700 "$HOME/.ssh"
	touch "$HOME/.ssh/authorized_keys"
	chmod 600 "$HOME/.ssh/authorized_keys"
	local line
	while IFS= read -r line || [[ -n "$line" ]]; do
		[[ -z "$line" || "$line" =~ ^# ]] && continue
		if grep -qF "$line" "$HOME/.ssh/authorized_keys" 2>/dev/null; then
			echo "==> Already authorized: ${line:0:60}…"
		else
			echo "$line" >>"$HOME/.ssh/authorized_keys"
			echo "==> Installed peer key: ${line:0:60}…"
		fi
	done <"$f"
}

install_systemd_dropin() {
	local dropin="/etc/systemd/system/highascg.service.d/40-replication-rsync-ssh.conf"
	local id_file
	id_file="$(readlink -f "$KEY" 2>/dev/null || echo "$KEY")"
	local opts="-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -i ${id_file}"
	if [[ "$(id -u)" -ne 0 ]]; then
		echo "==> INSTALL_DROPIN=1 requires sudo for ${dropin}" >&2
		return 1
	fi
	mkdir -p "$(dirname "$dropin")"
	cat >"$dropin" <<EOF
# HighAsCG replication rsync — passwordless SSH identity
[Service]
Environment=HIGHASCG_REPL_RSYNC_SSH_OPTS=${opts}
Environment=HIGHASCG_REPL_RSYNC_USER=${REPL_USER}
EOF
	systemctl daemon-reload
	echo "==> Wrote ${dropin} — restart highascg: sudo systemctl restart highascg"
}

copy_id_to_peer() {
	local peer="$1"
	echo "==> ssh-copy-id to ${REPL_USER}@${peer} (enter peer password once if prompted)"
	ssh-copy-id -i "${KEY}.pub" -o StrictHostKeyChecking=accept-new "${REPL_USER}@${peer}"
}

test_peer() {
	local peer="$1"
	local ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "$KEY")
	echo "==> Test SSH ${REPL_USER}@${peer}"
	ssh "${ssh_opts[@]}" "${REPL_USER}@${peer}" 'echo "SSH ok on $(hostname)"'
	echo "==> Test rsync round-trip (dry listing)"
	rsync -avzn -e "ssh ${ssh_opts[*]}" "${REPL_USER}@${peer}:${REPO_ROOT}/media/" /dev/null 2>/dev/null || true
}

if [[ "${1:-}" == "--show-pubkey" ]]; then
	ensure_key
	cat "${KEY}.pub"
	exit 0
fi

if [[ "${1:-}" == "--install-peer-key" ]]; then
	[[ -n "${2:-}" && -f "$2" ]] || usage
	install_peer_key_file "$2"
	exit 0
fi

[[ -n "$PEER" ]] || usage

ensure_key
install_self_in_authorized_keys
copy_id_to_peer "$PEER"

if [[ "$INSTALL_DROPIN" == "1" ]]; then
	sudo bash "$0" --install-dropin-internal "$KEY" "$REPL_USER" 2>/dev/null || install_systemd_dropin
fi

echo
echo "Next: run the same script on the OTHER box with PEER set to this host's IP."
echo "This host pubkey (give to peer if ssh-copy-id fails one way):"
cat "${KEY}.pub"
echo
test_peer "$PEER"
echo
echo "OK: replication rsync SSH to ${PEER} — retry media sync in Device View."
