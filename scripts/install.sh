#!/bin/bash
# Legacy monolith installer — prefer scripts/setup/ for new hosts.
echo "Note: for new installs use scripts/setup/ (see scripts/setup/README.md)." >&2
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deprecated/legacy/install.sh" "$@"
