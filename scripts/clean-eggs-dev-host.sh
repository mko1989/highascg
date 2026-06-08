#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/eggs/clean-eggs-dev-host.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/eggs/clean-eggs-dev-host.sh" "$@"
