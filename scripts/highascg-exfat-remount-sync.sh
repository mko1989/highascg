#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/exfat/highascg-exfat-remount-sync.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/exfat/highascg-exfat-remount-sync.sh" "$@"
