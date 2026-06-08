#!/usr/bin/env bash
# Compatibility forwarder — canonical path is scripts/deploy/dev-push.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/dev-push.sh" "$@"
