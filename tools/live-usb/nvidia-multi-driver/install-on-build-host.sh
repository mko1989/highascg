#!/usr/bin/env bash
# Install the multi-NVIDIA first-boot picker assets onto the *build host*
# so they get cloned into the live ISO by `eggs produce --clone`.
#
# What this does:
#   - Copies highascg-pick-nvidia.sh -> /usr/local/sbin/
#   - Copies highascg-pick-nvidia.service -> /etc/systemd/system/
#   - Enables the unit so it runs on the live image's first boot
#   - Adds ConditionPathExists gate to highascg.service so the app waits for
#     a working GPU stack before starting
#   - Leaves /opt/nvidia-pool alone (populate it separately via fetch-debs.sh)
#
# Idempotent: safe to re-run.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing /usr/local/sbin/highascg-pick-nvidia.sh"
install -m 0755 "$HERE/highascg-pick-nvidia.sh" /usr/local/sbin/highascg-pick-nvidia.sh

echo "==> Installing /etc/systemd/system/highascg-pick-nvidia.service"
install -m 0644 "$HERE/highascg-pick-nvidia.service" /etc/systemd/system/highascg-pick-nvidia.service

echo "==> Enabling highascg-pick-nvidia.service for next boot"
systemctl daemon-reload
systemctl enable highascg-pick-nvidia.service

# Ensure ubuntu-drivers-common is installed (required by the picker on the live image)
if ! dpkg -s ubuntu-drivers-common >/dev/null 2>&1; then
  echo "==> Installing ubuntu-drivers-common"
  apt-get update
  apt-get install -y --no-install-recommends ubuntu-drivers-common
fi

# Add a gate to highascg.service so it waits for the picker to finish.
# Uses a drop-in so we don't fight any future regeneration of the unit.
HIGHASCG_UNIT="/etc/systemd/system/highascg.service"
if [[ -f "$HIGHASCG_UNIT" ]]; then
  echo "==> Adding ConditionPathExists drop-in to highascg.service"
  mkdir -p /etc/systemd/system/highascg.service.d
  cat > /etc/systemd/system/highascg.service.d/10-wait-for-nvidia.conf <<'EOF'
[Unit]
After=highascg-pick-nvidia.service
Wants=highascg-pick-nvidia.service
ConditionPathExists=/var/lib/highascg/nvidia-installed
EOF
  systemctl daemon-reload
else
  echo "Note: $HIGHASCG_UNIT not present on this host; skipping drop-in." >&2
  echo "      The drop-in template is in $HERE/highascg.service.d/ if you need to install it manually on the target." >&2
fi

# Pre-create the marker dir on the build host so it lives empty in the image
mkdir -p /var/lib/highascg

cat <<EOF

OK. Build-host prep complete. Next:
  1. (If not already done) populate the offline driver cache:
       sudo NVIDIA_BRANCHES="470 580" bash $HERE/fetch-debs.sh
  2. Make sure your eggs exclude fragment does NOT exclude /opt/nvidia-pool.
  3. Build the live ISO:
       sudo eggs produce --nointeractive --clone --max --basename highascg-live

The picker will run automatically on first boot of the live image and either
stamp the marker (if loaded driver matches recommendation) or swap drivers
and reboot.
EOF
