#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/fix/fix-host-boot-display-hang.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fix/fix-host-boot-display-hang.sh" "$@"
