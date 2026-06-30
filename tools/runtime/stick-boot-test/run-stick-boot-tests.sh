#!/usr/bin/env bash
# Moved to tools/startup/stick-boot-test/ (included in squashfs). Wrapper for old paths.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/startup/stick-boot-test/run-stick-boot-tests.sh" "$@"
