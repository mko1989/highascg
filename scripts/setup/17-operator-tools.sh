#!/usr/bin/env bash
# Install operator tools (gh, tmux, mc, magic-wormhole, v4l2loopback-utils, gpick).
#
# These tools support ISO production, live-USB troubleshooting, and media ingest:
# - gh: GitHub CLI (release uploads, repo management)
# - tmux: Terminal multiplexer (eggs build monitoring)
# - mc: Midnight Commander (file browser for exFAT)
# - magic-wormhole: Secure file transfer (air-gapped media ingest)
# - v4l2loopback-utils (+ v4l2loopback-dkms only on kernels that do not ship the module): virtual camera
# - gpick: Colour picker (github.com/thezbyg/gpick) — the operator dock's eyedropper opens it (WO-1015)
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

echo "==> Installing operator tools (gh, tmux, mc, magic-wormhole, v4l2loopback-utils, gpick)"

# Ensure apt is up to date
apt-get update -qq

# Install packages
apt-get install -y \
	gh \
	tmux \
	mc \
	magic-wormhole \
	v4l2loopback-utils \
	gpick

# v4l2loopback: Ubuntu kernels from 7.0.0-43 ship the module (ubuntu/dkms/v4l2loopback); with it present,
# v4l2loopback-dkms fails its postinst ("already installed", dpkg exit 1 — box 09.11). DKMS only when missing.
if ! modinfo v4l2loopback >/dev/null 2>&1; then
	apt-get install -y v4l2loopback-dkms
fi

echo "==> Verifying installations"
command -v gh >/dev/null && echo "  ✓ gh $(gh --version | head -1)"
command -v tmux >/dev/null && echo "  ✓ tmux $(tmux -V)"
command -v mc >/dev/null && echo "  ✓ mc $(mc --version 2>&1 | head -1)"
command -v wormhole >/dev/null && echo "  ✓ wormhole"
command -v v4l2loopback-ctl >/dev/null && echo "  ✓ v4l2loopback-utils"
modinfo v4l2loopback >/dev/null 2>&1 && echo "  ✓ v4l2loopback module (DKMS, $(uname -r))"
command -v gpick >/dev/null && echo "  ✓ gpick"

echo
echo "OK: Operator tools installed"
echo
echo "Optional next steps:"
echo "  - GitHub: gh auth login (configure credentials for release uploads)"
echo "  - Operator UI: http://<playout-ip>:4200/ (no proxy; WO-498 removed nginx)"
echo
