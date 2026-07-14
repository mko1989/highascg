#!/usr/bin/env bash
# WO-193: System time wrapper — status, NTP toggle, and manual time setting.
# Strict arg validation before any privileged call.
# Usage: highascg-set-system-time.sh [status|ntp on|ntp off|set <YYYY-MM-DD> <HH:MM[:SS]>]
set -euo pipefail

usage() {
	echo "Usage: $0 [status|ntp on|ntp off|set <YYYY-MM-DD> <HH:MM[:SS]>]" >&2
	exit 2
}

# Validate args FIRST, before root check
if [[ $# -eq 0 ]]; then
	usage
fi

cmd="$1"

case "$cmd" in
	status)
		# status: no extra args validation needed
		;;
	ntp)
		if [[ $# -ne 2 ]]; then
			usage
		fi
		mode="$2"
		if [[ "$mode" != "on" && "$mode" != "off" ]]; then
			echo "Invalid NTP mode: $mode (expected 'on' or 'off')" >&2
			exit 2
		fi
		;;
	set)
		if [[ $# -lt 3 || $# -gt 4 ]]; then
			usage
		fi
		date_arg="$2"
		time_arg="$3"

		# Validate date format: YYYY-MM-DD
		if ! [[ "$date_arg" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
			echo "Invalid date format (expected YYYY-MM-DD): $date_arg" >&2
			exit 2
		fi

		# Validate time format: HH:MM or HH:MM:SS
		if ! [[ "$time_arg" =~ ^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$ ]]; then
			echo "Invalid time format (expected HH:MM or HH:MM:SS): $time_arg" >&2
			exit 2
		fi
		;;
	*)
		echo "Unknown command: $cmd" >&2
		usage
		;;
esac

# Now check for root (after arg validation)
[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root" >&2
	exit 1
}

# Execute the validated command
case "$cmd" in
	status)
		timedatectl show
		exit 0
		;;
	ntp)
		mode="$2"
		if [[ "$mode" == "on" ]]; then
			timedatectl set-ntp true
		else
			timedatectl set-ntp false
		fi
		exit 0
		;;
	set)
		date_arg="$2"
		time_arg="$3"

		# If time doesn't have seconds, add :00
		if ! [[ "$time_arg" =~ : ]]; then
			time_arg="${time_arg}:00"
		fi

		# Combine date and time
		datetime="${date_arg} ${time_arg}"

		# First, turn off NTP so we can set the time manually
		timedatectl set-ntp false

		# Set the time
		timedatectl set-time "$datetime"
		exit 0
		;;
esac
