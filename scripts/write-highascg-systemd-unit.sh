#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/exfat/write-highascg-systemd-unit.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/exfat/write-highascg-systemd-unit.sh" "$@"
