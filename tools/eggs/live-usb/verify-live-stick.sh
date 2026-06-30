#!/usr/bin/env bash
# Moved to tools/startup/ (included in squashfs). This wrapper keeps old paths working on the build host.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/tools/startup/verify-live-stick.sh" "$@"
