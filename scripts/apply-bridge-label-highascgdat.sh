#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/exfat/apply-bridge-label-highascgdat.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/exfat/apply-bridge-label-highascgdat.sh" "$@"
