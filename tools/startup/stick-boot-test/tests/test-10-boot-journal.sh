#!/usr/bin/env bash
# test-10-boot-journal.sh
st_section "10 Boot journal (this boot)"
if [[ "${ST_QUICK:-0}" == "1" ]]; then
	st_skip "journal tail (--quick)"
else
	for u in highascg-exfat-server-update highascg-exfat-sync highascg-exfat-boot; do
		if journalctl -u "${u}.service" -b --no-pager -n 3 2>/dev/null | grep -q .; then
			state="$(systemctl is-active "${u}.service" 2>/dev/null || echo ?)"
			if [[ "$state" == "failed" ]]; then
				st_fail "${u}.service failed this boot"
				journalctl -u "${u}.service" -b --no-pager -n 8 2>/dev/null | tail -5 >&2 || true
			else
				st_ok "${u}.service boot state=${state}"
			fi
		else
			st_warn "no journal for ${u}.service this boot"
		fi
	done
fi
if [[ -f /var/log/highascg-exfat-boot.log ]]; then
	if grep -qiE 'error|fail' /var/log/highascg-exfat-boot.log 2>/dev/null; then
		st_warn "highascg-exfat-boot.log contains error/fail text"
	else
		st_ok "highascg-exfat-boot.log present (no error keywords)"
	fi
fi
