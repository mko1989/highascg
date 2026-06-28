#!/usr/bin/env bash
# Run ON the backup box after scp of highascg-backup-box.tgz from the leader.
# Overlay extract — does NOT delete bin/, lib/, media/, etc.
#
#   scp casparcg@<leader-ip>:~/highascg-backup-box.tgz /tmp/
#   bash /tmp/extract-backup-box-local.sh /tmp/highascg-backup-box.tgz
#
set -euo pipefail

TGZ="${1:-/tmp/highascg-backup-box.tgz}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/casparcg/highascg}"
USER="${USER:-casparcg}"

mkdir -p "${DEPLOY_PATH}"

env -u TAR_OPTIONS tar -m -xzf "${TGZ}" -C "${DEPLOY_PATH}"
chown -R "${USER}:${USER}" "${DEPLOY_PATH}"
test -f "${DEPLOY_PATH}/index.js"

echo "Overlay extracted to ${DEPLOY_PATH} (bin/lib/media untouched if not in tarball)"
echo "If replication.json missing: copy from leader config/replication.json"
echo "Restart: sudo systemctl restart highascg"
