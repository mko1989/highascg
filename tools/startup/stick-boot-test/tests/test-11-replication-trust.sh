#!/usr/bin/env bash
# test-11-replication-trust.sh — WO-78 replication trust (read-only, single box)
st_section "11 Replication trust (WO-78)"

if [[ -x /usr/local/bin/highascg-replication-ssh ]]; then
	st_ok "rsync-only SSH wrapper installed (/usr/local/bin/highascg-replication-ssh)"
else
	st_fail "missing /usr/local/bin/highascg-replication-ssh — run: sudo bash scripts/replication/install-replication-ssh-wrapper.sh"
fi

if [[ -f "${PLAYOUT}/config/hardware-identity.json" ]]; then
	st_ok "hardware-identity.json present"
else
	st_warn "hardware-identity.json missing (created on bridge start)"
fi

if command -v node >/dev/null 2>&1 && [[ -f "${PLAYOUT}/src/system/hardware-identity.js" ]]; then
	hw_json="$(node -e "
		const h = require('${PLAYOUT}/src/system/hardware-identity');
		const id = h.getHardwareIdentity();
		process.stdout.write(JSON.stringify(id));
	" 2>/dev/null || true)"
	if [[ -n "$hw_json" ]] && echo "$hw_json" | grep -q '"hardwareId"'; then
		hwid="$(echo "$hw_json" | sed -n 's/.*"hardwareId":"\([^"]*\)".*/\1/p')"
		target_host="$(echo "$hw_json" | sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')"
		st_ok "hardware id ${hwid} → ${target_host}"
		if [[ "$(hostname)" == "$target_host" ]]; then
			st_ok "system hostname matches hardware identity"
		elif [[ "$(hostname)" =~ ^highascg[0-9]{4}$ ]]; then
			st_ok "system hostname $(hostname) (hardware target ${target_host})"
		else
			st_warn "hostname $(hostname) ≠ ${target_host} — needs root: sudo hostnamectl set-hostname ${target_host}"
		fi
	else
		st_warn "could not read hardware identity via node"
	fi
else
	st_skip "node or hardware-identity module unavailable"
fi

if command -v curl >/dev/null 2>&1; then
	ping="$(curl -s --connect-timeout 3 http://127.0.0.1:4200/api/replication/ping 2>/dev/null || true)"
	if [[ -n "$ping" ]] && echo "$ping" | grep -q '"appId":"highascg"'; then
		st_ok "GET /api/replication/ping appId=highascg"
		if echo "$ping" | grep -q '"hardwareId"'; then
			st_ok "ping includes hardwareId"
		else
			st_fail "ping missing hardwareId"
		fi
	else
		st_warn "/api/replication/ping unavailable (bridge not running?)"
	fi
else
	st_skip "curl missing — skip replication ping"
fi

if command -v node >/dev/null 2>&1 && [[ -f "${PLAYOUT}/tools/smoke/smoke-hardware-identity.test.js" ]]; then
	if (
		cd "${PLAYOUT}" &&
			node --test \
				tools/smoke/smoke-hardware-identity.test.js \
				tools/smoke/smoke-replication-ssh-setup.test.js \
				tools/smoke/smoke-replication-handshake.test.js \
				tools/smoke/smoke-project-hot-backup.test.js \
				>/dev/null 2>&1
	); then
		st_ok "WO-78 node smoke tests pass"
	else
		st_fail "WO-78 node smoke tests failed (run manually in ${PLAYOUT})"
	fi
else
	st_skip "node smoke tests unavailable"
fi
