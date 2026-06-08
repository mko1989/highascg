#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/fix/fix-highascg-no-exfat-startup-block.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fix/fix-highascg-no-exfat-startup-block.sh" "$@"
