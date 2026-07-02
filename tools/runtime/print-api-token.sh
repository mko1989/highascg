#!/usr/bin/env bash
# Print the per-install API token for operator login (WO-96 recovery).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN_FILE="$ROOT/.private/api-token"
if [[ ! -f "$TOKEN_FILE" ]]; then
	echo "No API token file at $TOKEN_FILE" >&2
	echo "Enable auth with HIGHASCG_ENFORCE_AUTH=1 and restart the server to generate one." >&2
	exit 1
fi
tr -d '\n' <"$TOKEN_FILE"
echo
