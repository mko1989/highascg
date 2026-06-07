#!/usr/bin/env bash
# Quick DeckLink status (no install). See 06-decklink-manual.md to install.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../install-config.sh
source "${HERE}/../install-config.sh"
# shellcheck source=../install-helpers.sh
source "${HERE}/../install-helpers.sh"

decklink_report_status
