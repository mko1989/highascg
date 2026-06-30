#!/usr/bin/env bash
# test-03-exfat-operator.sh
st_section "03 exFAT operator volume"
if st_exfat_label_mounted; then
	mp="$(findmnt -n -o TARGET -L HIGHASCGEXF)"
	st_ok "HIGHASCGEXF mounted at ${mp}"
	if mountpoint -q "${EXFAT}" 2>/dev/null; then
		st_ok "WO-47 path ${EXFAT} is a mountpoint"
	else
		st_warn "${EXFAT} not mounted (expected bind to HIGHASCGEXF)"
	fi
else
	st_fail "HIGHASCGEXF not mounted"
fi
for d in configs drop-config drop-update media templates; do
	if [[ -d "${EXFAT}/${d}" ]]; then
		st_ok "exFAT/${d}/ present"
	else
		st_warn "exFAT/${d}/ missing (starter layout)"
	fi
done
if [[ -f /etc/highascg/exfat-sync.json ]]; then
	st_ok "/etc/highascg/exfat-sync.json installed"
else
	st_fail "missing /etc/highascg/exfat-sync.json"
fi
