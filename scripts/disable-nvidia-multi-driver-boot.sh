#!/usr/bin/env bash
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/nvidia/disable-nvidia-multi-driver-boot.sh" "$@"
