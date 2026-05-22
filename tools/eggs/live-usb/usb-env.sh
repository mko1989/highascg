# shellcheck shell=bash
# Sourced by stick partitioning scripts — sudo often omits /usr/sbin from PATH.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/sbin:${PATH:-/usr/bin:/bin}"
PARTED="${PARTED:-$(command -v parted 2>/dev/null || echo /usr/sbin/parted)}"
export PARTED
SFDISK="${SFDISK:-$(command -v sfdisk 2>/dev/null || echo /usr/sbin/sfdisk)}"
export SFDISK
