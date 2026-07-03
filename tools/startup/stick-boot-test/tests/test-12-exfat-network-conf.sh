#!/usr/bin/env bash
# test-12-exfat-network-conf.sh — WO-95 stick network.conf (read-only)
st_section "12 exFAT network.conf (WO-95)"
if ! st_exfat_label_mounted; then
	st_warn "HIGHASCGEXF not mounted — skip network.conf checks"
	exit 0
fi
if [[ -f "${EXFAT}/network/network.conf" ]]; then
	st_ok "exFAT/network/network.conf present"
	if grep -qE '^mode=(dhcp|static)' "${EXFAT}/network/network.conf" 2>/dev/null; then
		st_ok "network.conf has mode=dhcp|static"
	else
		st_warn "network.conf missing mode=dhcp|static line"
	fi
else
	st_warn "exFAT/network/network.conf missing (optional until operator sets IP)"
fi
if systemctl cat highascg-exfat-network-apply.service &>/dev/null; then
	en="$(systemctl is-enabled highascg-exfat-network-apply.service 2>/dev/null || echo unknown)"
	st_ok "highascg-exfat-network-apply.service enabled=${en}"
else
	st_warn "highascg-exfat-network-apply.service not installed"
fi
if [[ -f /var/lib/highascg/last-exfat-network.hash ]]; then
	st_ok "exFAT network apply stamp present"
fi
