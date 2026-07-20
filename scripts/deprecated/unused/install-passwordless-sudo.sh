#!/usr/bin/env bash
# Deprecated wrapper — use scripts/setup/12-passwordless-sudo.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "${SCRIPT_DIR}/../setup/12-passwordless-sudo.sh" "$@"
