#!/usr/bin/env bash
# Quick DeckLink / Desktop Video status (no install).
# Usage: bash scripts/check-decklink.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=install-config.sh
source "${HERE}/install-config.sh"
# shellcheck source=install-helpers.sh
source "${HERE}/install-helpers.sh"

decklink_report_status
