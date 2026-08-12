#!/usr/bin/env bash
# Install operator tools (gh, tmux, mc, magic-wormhole, v4l2loopback-utils).
#
# These tools support ISO production, live-USB troubleshooting, and media ingest:
# - gh: GitHub CLI (release uploads, repo management)
# - tmux: Terminal multiplexer (eggs build monitoring)
# - mc: Midnight Commander (file browser for exFAT)
# - magic-wormhole: Secure file transfer (air-gapped media ingest)
# - v4l2loopback-utils: Virtual camera utilities (v4l2loopback kernel module)
#
# Usage:
#   sudo bash scripts/setup/17-operator-tools.sh
#
# Idempotent: yes
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

# shellcheck source=lib/install-helpers.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/install-helpers.sh"

echo "==> Installing operator tools (gh, tmux, mc, magic-wormhole, v4l2loopback-utils)"

# Ensure apt is up to date
apt-get update -qq

# Install packages
apt-get install -y \
	gh \
	tmux \
	mc \
	magic-wormhole \
	v4l2loopback-utils

echo "==> Verifying installations"
command -v gh >/dev/null && echo "  ✓ gh $(gh --version | head -1)"
command -v tmux >/dev/null && echo "  ✓ tmux $(tmux -V)"
command -v mc >/dev/null && echo "  ✓ mc $(mc --version 2>&1 | head -1)"
command -v wormhole >/dev/null && echo "  ✓ wormhole"
command -v v4l2loopback-ctl >/dev/null && echo "  ✓ v4l2loopback-utils"

echo
echo "OK: Operator tools installed"
echo
echo "Optional next steps:"
echo "  - GitHub: gh auth login (configure credentials for release uploads)"
echo "  - Operator UI: http://<playout-ip>:4200/ (no proxy; WO-498 removed nginx)"
echo
