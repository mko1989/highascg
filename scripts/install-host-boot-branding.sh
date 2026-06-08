#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/boot/install-host-boot-branding.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/boot/install-host-boot-branding.sh" "$@"
