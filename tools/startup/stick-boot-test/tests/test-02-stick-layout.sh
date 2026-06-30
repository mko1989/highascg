#!/usr/bin/env bash
# test-02-stick-layout.sh
st_section "02 Stick block layout"
if ! lsblk -f 2>/dev/null | grep -q HIGHASCGEXF; then
	st_fail "no block device LABEL=HIGHASCGEXF"
else
	st_ok "LABEL=HIGHASCGEXF present"
	if [[ "${ST_VERBOSE:-0}" == "1" ]]; then
		lsblk -f 2>/dev/null | grep -E 'NAME|HIGHASCG|iso9660|exfat|vfat' | sed 's/^/      /' || true
	fi
fi
if blkid -L HIGHASCGEXF &>/dev/null; then
	dev="$(blkid -L HIGHASCGEXF)"
	st_ok "HIGHASCGEXF device ${dev}"
else
	st_fail "blkid cannot resolve HIGHASCGEXF"
fi
