'use strict'
/**
 * WO-692 — tools/runtime/highascg-network-apply.sh against fake nmcli / ip / networkctl (a temp PATH, networkd dir and
 * sysfs): any Ethernet name, a port without a cable saved instead of failing, an inactive profile reused (no
 * duplicate), the port taken away from the live image's networkd DHCP, and Wi-Fi with the passphrase on stdin.
 */
const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const SCRIPT = path.join(__dirname, '../runtime/highascg-network-apply.sh')

let root
let log

function fake(name, body) {
	const p = path.join(root, 'bin', name)
	fs.writeFileSync(p, `#!/usr/bin/env bash\necho "${name} $*" >>"${log}"\n${body || ''}\n`)
	fs.chmodSync(p, 0o755)
}

/** @param {{ profiles?: string, devices?: string, carrier?: string, upFails?: boolean }} st */
function setup(st) {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo692-'))
	log = path.join(root, 'calls.log')
	fs.mkdirSync(path.join(root, 'bin'))
	fs.mkdirSync(path.join(root, 'networkd'))
	fs.mkdirSync(path.join(root, 'sys', 'enp3s0'), { recursive: true })
	fs.writeFileSync(path.join(root, 'sys', 'enp3s0', 'carrier'), st.carrier ?? '1')
	fs.writeFileSync(path.join(root, 'profiles'), st.profiles ?? '')
	fs.writeFileSync(path.join(root, 'devices'), st.devices ?? 'enp3s0:connected')
	fake(
		'nmcli',
		`case "$*" in
  "-t -f NAME,DEVICE con show") cat "${root}/profiles" ;;
  "-t -f NAME con show") cut -d: -f1 "${root}/profiles" ;;
  "-t -f DEVICE,STATE device show"*) cat "${root}/devices" ;;
  *"con up"*) ${st.upFails ? 'exit 4' : 'exit 0'} ;;
esac`,
	)
	fake('ip')
	fake('networkctl', 'exit 1')
	fake('sleep')
}

function run(args, input) {
	const r = spawnSync('bash', [SCRIPT, ...args], {
		encoding: 'utf8',
		input: input || '',
		env: {
			PATH: `${path.join(root, 'bin')}:/usr/bin:/bin`,
			HIGHASCG_NETWORKD_DIR: path.join(root, 'networkd'),
			HIGHASCG_SYS_NET: path.join(root, 'sys'),
		},
	})
	const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []
	return { ...r, calls }
}

describe('WO-692 network apply helper', () => {
	afterEach(() => {
		if (root) fs.rmSync(root, { recursive: true, force: true })
		root = null
	})

	it('a PCI-named port without a cable: profile saved with the static address, no activation', () => {
		setup({ carrier: '0', devices: 'enp3s0:unavailable' })
		const r = run(['static', 'enp3s0', '10.0.0.5', '24', '', ''])
		assert.equal(r.status, 0, r.stderr)
		assert.match(r.stdout, /no link — saved/)
		assert.ok(r.calls.includes('nmcli con add type ethernet ifname enp3s0 con-name highascg-enp3s0 autoconnect yes'))
		assert.ok(r.calls.some((c) => c.includes('ipv4.method manual ipv4.addresses 10.0.0.5/24')))
		assert.ok(!r.calls.some((c) => c.includes('con up')), r.calls.join('\n'))
		const nd = fs.readFileSync(path.join(root, 'networkd', '05-highascg-nm-enp3s0.network'), 'utf8')
		assert.match(nd, /Name=enp3s0[\s\S]*Unmanaged=yes/)
	})

	it('an inactive profile of ours is reused, not duplicated; a port with a cable comes up', () => {
		setup({ profiles: 'highascg-enp3s0:\nWired connection 1:eno1\n' })
		const r = run(['dhcp', 'enp3s0'])
		assert.equal(r.status, 0, r.stderr)
		assert.ok(!r.calls.some((c) => c.includes('con add')), r.calls.join('\n'))
		assert.ok(r.calls.includes('nmcli con up highascg-enp3s0 ifname enp3s0'))
		assert.ok(r.calls.includes('ip -4 addr flush dev enp3s0'))
	})

	it('an unmanaged port is handed to NetworkManager', () => {
		setup({ devices: 'enp3s0:unmanaged', profiles: 'highascg-enp3s0:enp3s0\n' })
		const r = run(['dhcp', 'enp3s0'])
		assert.equal(r.status, 0, r.stderr)
		assert.ok(r.calls.includes('nmcli dev set enp3s0 managed yes'))
	})

	it('rejects names outside en*/eth* for wired and wl* for Wi-Fi', () => {
		setup({})
		assert.equal(run(['dhcp', 'wlp0s20f3']).status, 2)
		assert.equal(run(['dhcp', 'lo']).status, 2)
		assert.equal(run(['wifi-scan', 'enp3s0']).status, 2)
		assert.equal(run(['bogus', 'enp3s0']).status, 2)
	})

	it('wifi-connect: passphrase from stdin, profile per SSID; a failed join removes it', () => {
		setup({})
		const ok = run(['wifi-connect', 'wlp0s20f3', 'Studio Net'], 'hunter2hunter2\n')
		assert.equal(ok.status, 0, ok.stderr)
		assert.ok(ok.calls.includes('nmcli con add type wifi ifname wlp0s20f3 con-name highascg-wifi-Studio Net ssid Studio Net autoconnect yes'))
		assert.ok(ok.calls.some((c) => c.endsWith('wifi-sec.key-mgmt wpa-psk wifi-sec.psk hunter2hunter2')))
		setup({ upFails: true })
		const bad = run(['wifi-connect', 'wlp0s20f3', 'Studio Net'], 'wrongpass\n')
		assert.equal(bad.status, 4)
		assert.match(bad.stderr, /Could not join "Studio Net"/)
		assert.equal(bad.calls.filter((c) => c === 'nmcli con delete highascg-wifi-Studio Net').length, 2)
	})

	it('an open network sets no security; radio and disconnect', () => {
		setup({})
		const r = run(['wifi-connect', 'wlp0s20f3', 'Guest'], '')
		assert.equal(r.status, 0, r.stderr)
		assert.ok(!r.calls.some((c) => c.includes('wifi-sec')))
		assert.equal(run(['wifi-radio', 'off']).status, 0)
		assert.ok(fs.readFileSync(log, 'utf8').includes('nmcli radio wifi off'))
		assert.equal(run(['wifi-radio', 'maybe']).status, 2)
		assert.equal(run(['wifi-disconnect', 'wlp0s20f3']).status, 0)
	})
})
