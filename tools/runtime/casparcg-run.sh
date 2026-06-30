#!/bin/sh
# Dev-tree entry point — installed playout uses ~/highascg/run.sh (repo root copy).
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
exec "${ROOT}/run.sh" "$@"
