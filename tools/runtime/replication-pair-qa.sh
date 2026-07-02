#!/usr/bin/env bash
# WO-78 replication trust QA — single box or post-pair two-box verification.
#
# Single box (smoke + local identity):
#   bash ~/highascg/tools/runtime/replication-pair-qa.sh
#
# After leader/follower connect (from either paired box):
#   REPL_QA_PEER=192.168.0.28 bash ~/highascg/tools/runtime/replication-pair-qa.sh
#
# Optional leader register rejection probe (temporarily advertises leader):
#   bash ~/highascg/tools/runtime/replication-pair-qa.sh --register-reject-test
#
# Exit: 0 if no FAIL; 1 if any FAIL (WARN alone still exits 0).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAYOUT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
API="${HIGHASCG_API:-http://127.0.0.1:4200}"
PEER="${REPL_QA_PEER:-}"
RSYNC_USER="${HIGHASCG_REPL_RSYNC_USER:-casparcg}"
REGISTER_REJECT=false

PASS=0
FAIL=0
WARN=0

while [[ $# -gt 0 ]]; do
	case "$1" in
	--peer) PEER="${2:-}"; shift 2 ;;
	--register-reject-test) REGISTER_REJECT=true; shift ;;
	-h | --help)
		sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*) echo "Unknown option: $1" >&2; exit 2 ;;
	esac
done

qa_ok() { PASS=$((PASS + 1)); echo "PASS: $*"; }
qa_fail() { FAIL=$((FAIL + 1)); echo "FAIL: $*" >&2; }
qa_warn() { WARN=$((WARN + 1)); echo "WARN: $*" >&2; }
qa_section() { echo ""; echo "=== $* ==="; }

curl_json() {
	local url="$1"
	curl -sf --connect-timeout 5 "$url" 2>/dev/null || true
}

qa_section "Local identity and smoke"
if [[ -x /usr/local/bin/highascg-replication-ssh ]]; then
	qa_ok "rsync-only SSH wrapper installed"
else
	qa_fail "install wrapper: sudo bash scripts/replication/install-replication-ssh-wrapper.sh"
fi

ping="$(curl_json "${API}/api/replication/ping")"
if [[ -n "$ping" ]] && echo "$ping" | grep -q '"appId":"highascg"'; then
	qa_ok "ping appId=highascg"
else
	qa_fail "bridge ping failed or missing appId (${API})"
fi
if [[ -n "$ping" ]] && echo "$ping" | grep -q '"hardwareId"'; then
	qa_ok "ping hardwareId present"
else
	qa_fail "ping missing hardwareId"
fi

if [[ "$(hostname)" =~ ^highascg[0-9]{4}$ ]]; then
	qa_ok "hostname $(hostname)"
else
	qa_warn "hostname $(hostname) is not highascg#### (apply with sudo hostnamectl after MAC migration)"
fi

if (
	cd "$PLAYOUT" &&
		node --test \
			tools/smoke/smoke-hardware-identity.test.js \
			tools/smoke/smoke-replication-ssh-setup.test.js \
			tools/smoke/smoke-replication-handshake.test.js \
			tools/smoke/smoke-project-hot-backup.test.js \
			>/dev/null 2>&1
); then
	qa_ok "WO-78 node smoke tests"
else
	qa_fail "WO-78 node smoke tests"
fi

if "$REGISTER_REJECT"; then
	qa_section "Non-HighAsCG register rejection (A78.3)"
	if node -e "
		const { verifyRegisterFollowerRequest } = require('${PLAYOUT}/src/replication/replication-handshake');
		const r = verifyRegisterFollowerRequest({ appId: 'foreign-app', pairId: 'qa-fake' });
		if (!r.ok && r.status === 403 && r.rejectUnknown) process.exit(0);
		console.error(JSON.stringify(r));
		process.exit(1);
	" 2>/dev/null; then
		qa_ok "handshake rejects non-HighAsCG appId (403)"
	else
		qa_fail "handshake should reject foreign appId with 403"
	fi
fi

if [[ -n "$PEER" ]]; then
	qa_section "Peer verification (${PEER}) — two-box QA"
	peer_ping="$(curl_json "http://${PEER}:4200/api/replication/ping")"
	if [[ -n "$peer_ping" ]] && echo "$peer_ping" | grep -q '"appId":"highascg"'; then
		qa_ok "peer ping appId=highascg"
	else
		qa_fail "peer ${PEER} ping failed"
	fi

	status="$(curl_json "${API}/api/replication/status")"
	if echo "$status" | grep -q '"enabled":true'; then
		qa_ok "local replication enabled (paired)"
	else
		qa_warn "local replication not enabled — connect before two-box QA"
	fi
	if echo "$status" | grep -q '"projectHotBackup"'; then
		if echo "$status" | grep -q '"peerLabel"'; then
			qa_ok "projectHotBackup.peerLabel in status (A78.5/A78.6)"
		else
			qa_warn "projectHotBackup present but peerLabel missing — re-pair on WO-78 build"
		fi
	else
		qa_warn "projectHotBackup missing — re-pair after upgrade"
	fi

	if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new \
		"${RSYNC_USER}@${PEER}" 'echo shell_ok' 2>/dev/null; then
		qa_fail "SSH shell to peer succeeded — forced-command should block interactive shell (A78.4)"
	else
		qa_ok "SSH interactive shell blocked or unreachable (A78.4)"
	fi

	rsync_out="$(node -e "
		const { testReplicationSshToPeer } = require('${PLAYOUT}/src/replication/replication-ssh-setup');
		const r = testReplicationSshToPeer('${PEER}');
		process.stdout.write(r.ok ? 'ok' : (r.stderr || r.stdout || 'fail'));
	" 2>/dev/null || echo fail)"
	if [[ "$rsync_out" == "ok" ]]; then
		qa_ok "rsync dry-run probe to peer (A78.4)"
	else
		qa_fail "rsync dry-run probe failed: ${rsync_out}"
	fi
fi

qa_section "Summary"
echo "PASS=${PASS} WARN=${WARN} FAIL=${FAIL}"
if [[ "$FAIL" -gt 0 ]]; then
	echo "Result: FAILED"
	exit 1
fi
if [[ "$WARN" -gt 0 ]]; then
	echo "Result: PASSED WITH WARNINGS"
	exit 0
fi
echo "Result: PASSED"
exit 0
