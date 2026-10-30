'use strict'

/**
 * WO-842 — sweep 29.10 ops-script findings. Every script runs against stubs in a temp dir (fake ssh / systemctl /
 * mountpoint / dpkg / mkfs.exfat / clock); nothing here installs, mounts, formats or restarts anything.
 *  - dev-push.sh remote cleanup must not delete data/, .private/, projects/ (4k)
 *  - highascg-exfat-arrive.sh waits for the queued mount job
 *  - decklink_install_vendor_pair fails when dpkg fails twice
 *  - usb_mkfs_exfat_labeled returns non-zero when the format failed
 *  - Caspar crash-loop give-up can fire
 *  - tailscale-up with an empty hostname passes no --hostname
 *  - the power button listener checks the KEY_POWER capability bit
 *  - sweep-util request() settles on a peer that drops mid-body
 *  - md-to-html: code in link labels
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawnSync } = require('child_process')

const REPO = path.resolve(__dirname, '../..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo842-ops-'))
const w = (f, body, mode) => {
	fs.mkdirSync(path.dirname(f), { recursive: true })
	fs.writeFileSync(f, body, { mode: mode || 0o644 })
}
const stub = (dir, name, body) => w(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`, 0o755)

test('4k dev-push.sh cleanup removes only what the tarball ships; data/.private/projects/config survive', () => {
	const root = path.join(TMP, 'dp/src_root')
	const target = path.join(TMP, 'dp/target')
	const bin = path.join(TMP, 'dp/bin')
	fs.copyFileSync(path.join(REPO, 'scripts/deploy/dev-push.sh'), (w(path.join(root, 'scripts/deploy/x'), ''), path.join(root, 'scripts/deploy/dev-push.sh')))
	fs.copyFileSync(path.join(REPO, 'scripts/lib/archive-common.sh'), (w(path.join(root, 'scripts/lib/x'), ''), path.join(root, 'scripts/lib/archive-common.sh')))
	w(path.join(root, 'index.js'), 'x')
	w(path.join(root, 'package.json'), '{}')
	w(path.join(root, 'src/a.js'), 'new')
	w(path.join(root, '.private/api-token'), 'SOURCE-TOKEN')
	w(path.join(root, 'projects/src.json'), '{}')
	w(path.join(target, 'src/stale.js'), 'old')
	w(path.join(target, 'data/known.json'), 'keep')
	w(path.join(target, '.private/api-token'), 'TARGET-TOKEN')
	w(path.join(target, 'projects/mine.json'), '{}')
	w(path.join(target, 'config/general.json'), 'c')
	w(path.join(target, 'log/x.log'), 'l')
	w(path.join(target, 'applied/a'), 'a')
	w(path.join(target, 'node_modules/m/index.js'), 'm')
	// fake ssh: run the remote command locally
	stub(bin, 'ssh', 'args=("$@"); exec bash -c "${args[$((${#args[@]}-1))]}"')
	const r = spawnSync('bash', ['scripts/deploy/dev-push.sh'], {
		cwd: root,
		encoding: 'utf8',
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			HOME: TMP,
			DEPLOY_SERVER_ONLY: '1',
			DEPLOY_HOST: 'h',
			DEPLOY_USER: os.userInfo().username,
			DEPLOY_PATH: target,
			DEPLOY_REMOTE_TMP: path.join(TMP, 'dp/x.tgz'),
		},
	})
	assert.equal(r.status, 0, r.stderr + r.stdout)
	const read = (f) => fs.readFileSync(path.join(target, f), 'utf8')
	assert.equal(read('src/a.js'), 'new')
	assert.equal(fs.existsSync(path.join(target, 'src/stale.js')), false, 'stale file inside a managed dir is removed')
	assert.equal(read('data/known.json'), 'keep')
	assert.equal(read('.private/api-token'), 'TARGET-TOKEN', "source's token must not replace the target's")
	assert.equal(read('projects/mine.json'), '{}')
	assert.equal(fs.existsSync(path.join(target, 'projects/src.json')), false, "source's projects are not shipped")
	for (const f of ['config/general.json', 'log/x.log', 'applied/a', 'node_modules/m/index.js']) assert.ok(fs.existsSync(path.join(target, f)), f)
	// a bad DEPLOY_PATH is refused before any ssh
	const bad = spawnSync('bash', ['scripts/deploy/dev-push.sh'], {
		cwd: root,
		encoding: 'utf8',
		env: { PATH: `${bin}:${process.env.PATH}`, HOME: TMP, DEPLOY_SERVER_ONLY: '1', DEPLOY_PATH: '/' },
	})
	assert.notEqual(bad.status, 0)
	assert.match(bad.stderr, /DEPLOY_PATH must be an absolute path/)
})

test('highascg-exfat-arrive.sh waits for the queued (--no-block) mount before giving up', () => {
	const bin = path.join(TMP, 'arrive/bin')
	const mp = path.join(TMP, 'arrive/mp')
	const marker = path.join(TMP, 'arrive/mounted')
	const calls = path.join(TMP, 'arrive/calls')
	fs.mkdirSync(mp, { recursive: true })
	w(path.join(TMP, 'arrive/label-node'), '')
	stub(bin, 'systemctl', `echo "$*" >>"${calls}"; if [[ "$*" == *home-casparcg-exfat.mount* ]]; then (sleep 1; touch "${marker}") >/dev/null 2>&1 & fi; exit 0`)
	stub(bin, 'mountpoint', `[[ -e "${marker}" ]]`)
	const env = {
		PATH: `${bin}:${process.env.PATH}`,
		HIGHASCG_EXFAT_MP: mp,
		HIGHASCG_EXFAT_LABEL_NODE: path.join(TMP, 'arrive/label-node'),
	}
	const r = spawnSync('bash', [path.join(REPO, 'scripts/exfat/highascg-exfat-arrive.sh')], { encoding: 'utf8', env, timeout: 30000 })
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stderr, /pipeline finished/)
	assert.doesNotMatch(r.stderr, /not mounted/)
	assert.match(fs.readFileSync(calls, 'utf8'), /highascg-exfat-sync\.service/)
	// a mount that never appears still ends cleanly after the (shortened) wait
	fs.rmSync(marker)
	stub(bin, 'systemctl', `echo "$*" >>"${calls}"; exit 0`)
	const r2 = spawnSync('bash', [path.join(REPO, 'scripts/exfat/highascg-exfat-arrive.sh')], {
		encoding: 'utf8',
		env: { ...env, HIGHASCG_EXFAT_ARRIVE_MOUNT_WAIT_SEC: '1' },
		timeout: 30000,
	})
	assert.equal(r2.status, 0)
	assert.match(r2.stderr, /exFAT not mounted/)
})

function bash(script, env = {}) {
	return spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: TMP, ...env }, timeout: 30000 })
}

test('decklink_install_vendor_pair returns 1 when dpkg still fails after apt-get install -f (even under `if`)', () => {
	const bin = path.join(TMP, 'dk/bin')
	stub(bin, 'dpkg', 'exit 1')
	stub(bin, 'apt-get', 'exit 0')
	stub(bin, 'modprobe', 'exit 0')
	const deb = path.join(TMP, 'dk/desktopvideo_16.0.1a2_amd64.deb')
	w(deb, 'x')
	const lib = path.join(REPO, 'scripts/lib/decklink-install-lib.sh')
	const script = `set -e; source "${lib}"
decklink_dkms_cache_restore() { return 0; }; decklink_ensure_dkms_prereqs() { return 0; }
decklink_rebuild_blackmagic_dkms() { echo REBUILD_REACHED; }
if decklink_install_vendor_pair "${deb}" "" ""; then echo RESULT=ok; else echo RESULT=failed; fi`
	const r = bash(script, { PATH: `${bin}:${process.env.PATH}` })
	assert.match(r.stdout, /RESULT=failed/, r.stdout + r.stderr)
	assert.doesNotMatch(r.stdout, /REBUILD_REACHED/)
	// dpkg that works on the retry (after apt-get -f) is still a success
	const flag = path.join(TMP, 'dk/first')
	stub(bin, 'dpkg', `if [[ -e "${flag}" ]]; then exit 0; fi; touch "${flag}"; exit 1`)
	const r2 = bash(script, { PATH: `${bin}:${process.env.PATH}` })
	assert.match(r2.stdout, /RESULT=ok/, r2.stdout + r2.stderr)
})

test('usb_mkfs_exfat_labeled reports failure (the rc was read after the closing fi → always 0)', () => {
	const bin = path.join(TMP, 'fs/bin')
	stub(bin, 'mkfs.exfat', 'exit 3')
	const lib = path.join(REPO, 'tools/eggs/live-usb/flash-stick-common.sh')
	const r = bash(
		`source "${lib}"; usb_prepare_partition_for_mkfs() { :; }; usb_partition_has_exfat_label() { return 1; }
usb_mkfs_exfat_labeled /dev/null/fake LABEL 2>/dev/null; echo "rc=$?"`,
		{ PATH: `${bin}:${process.env.PATH}` },
	)
	assert.match(r.stdout, /rc=3/, r.stdout + r.stderr)
})

test('Caspar crash-loop give-up fires when the crashes are quick (fake clock, dash)', () => {
	const lib = path.join(REPO, 'tools/runtime/casparcg-supervisor-lib.sh')
	const state = path.join(TMP, 'sup/state')
	const inhibit = path.join(TMP, 'sup/inhibit')
	fs.mkdirSync(path.dirname(state), { recursive: true })
	const script = `
CLOCK=1000000
date() { case "$1" in +%s) echo $CLOCK ;; *) echo fake-date ;; esac; }
sleep() { CLOCK=$((CLOCK + $1)); }
. "${lib}"
caspar_supervisor_log() { :; }
n=0
while :; do
  CLOCK=$((CLOCK + 3))   # Caspar ran 3 s, then crashed (exit 139)
  n=$((n + 1))
  caspar_crash_loop_backoff 139 || break
  [ "$n" -gt 60 ] && break
done
echo "crashes=$n"`
	const r = spawnSync('dash', ['-c', script], {
		encoding: 'utf8',
		env: { PATH: process.env.PATH, CASPAR_CRASH_STATE: state, CASPAR_INHIBIT_FILE: inhibit, CASPAR_SUPERVISOR_LOG: path.join(TMP, 'sup/log') },
	})
	assert.equal(r.status, 0, r.stderr)
	assert.match(r.stdout, /crashes=18\b/, r.stdout + r.stderr)
	assert.ok(fs.existsSync(inhibit), 'inhibit file written at give-up')
})

test('highascg-tailscale-up.sh: empty hostname passes no --hostname, acceptRoutes is kept, spaces survive', () => {
	let src = fs.readFileSync(path.join(REPO, 'tools/runtime/highascg-tailscale-up.sh'), 'utf8')
	src = src.slice(0, src.indexOf('for bin in')) + 'printf "%s\\n" "${ARGS[@]}"\n'
	const sh = path.join(TMP, 'ts/ts-args.sh')
	w(sh, src)
	const run = (cfg) => {
		const f = path.join(TMP, 'ts/tailscale.json')
		w(f, JSON.stringify(cfg))
		const r = spawnSync('bash', [sh], { encoding: 'utf8', env: { PATH: process.env.PATH, HIGHASCG_TAILSCALE_CONFIG: f } })
		assert.equal(r.status, 0, r.stderr)
		return r.stdout.trim().split('\n')
	}
	assert.deepEqual(run({ hostname: '', acceptRoutes: true }), ['up', '--accept-routes'])
	assert.deepEqual(run({}), ['up'])
	assert.deepEqual(run({ hostname: 'My Box', acceptRoutes: false }), ['up', '--hostname', 'My Box'])
})

test('power button listener: the capability bitmap (KEY_POWER = 116) decides, not `evtest --query`', () => {
	const src = fs.readFileSync(path.join(REPO, 'tools/runtime/highascg-power-button-listen.sh'), 'utf8')
	const fn = src.slice(src.indexOf('INPUT_SYSFS='), src.indexOf('_find_power_events_from_proc()'))
	assert.ok(fn.includes('_event_has_key_power()'))
	const sys = path.join(TMP, 'pb/sys')
	const dev = (name, caps) => {
		w(path.join(sys, name, 'device/capabilities/key'), caps + '\n')
		w(path.join(TMP, 'pb/dev', name), '')
	}
	dev('event0', '4000 0 0') // Sleep Button: KEY_SLEEP only
	dev('event1', '8000 10000000000000 0') // Power Button: KEY_POWER (word 1, bit 52)
	const r = bash(
		`KEY_CODE=116; HIGHASCG_INPUT_SYSFS="${sys}"; ${fn}
for e in event0 event1; do if _event_has_key_power "${path.join(TMP, 'pb/dev')}/$e"; then echo "$e=yes"; else echo "$e=no"; fi; done`,
	)
	assert.match(r.stdout, /event0=no/, r.stdout + r.stderr)
	assert.match(r.stdout, /event1=yes/)
})

test('sweep-util request() settles when the peer drops mid-body', async () => {
	const { get } = require('../../tools/sweep/sweep-util')
	const srv = net.createServer((s) => {
		s.on('data', () => {
			s.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\nContent-Type: application/json\r\n\r\n{"a":')
			setTimeout(() => s.destroy(), 50)
		})
		s.on('error', () => {})
	})
	await new Promise((r) => srv.listen(0, '127.0.0.1', r))
	try {
		const out = await Promise.race([get(`http://127.0.0.1:${srv.address().port}/x`, 2000), new Promise((r) => setTimeout(() => r('HUNG'), 5000))])
		assert.notEqual(out, 'HUNG', 'request() never settled')
		assert.equal(out.status, 0)
		assert.ok(out.error)
	} finally {
		srv.close()
	}
})

test('md-to-html: code in a link label renders as code inside the link, not as escaped tags', () => {
	const { markdownToHtml } = require('../wiki/md-to-html')
	const html = markdownToHtml('See [`foo()`](a.md) and [**b**](c.md?x=1&y=2) and `a*b*c` <script>')
	assert.match(html, /<a href="a\.md"><code>foo\(\)<\/code><\/a>/)
	assert.doesNotMatch(html, /&lt;code&gt;/)
	assert.match(html, /href="c\.md\?x=1&amp;y=2"><strong>b<\/strong><\/a>/)
	assert.match(html, /<code>a\*b\*c<\/code>/)
	assert.match(html, /&lt;script&gt;/)
})
