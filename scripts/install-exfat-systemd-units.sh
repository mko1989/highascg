#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/exfat/install-exfat-systemd-units.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/exfat/install-exfat-systemd-units.sh" "$@"
