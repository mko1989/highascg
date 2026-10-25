'use strict'
/**
 * WO-702 — live-boot defects seen on .64 (22.10 ISO): exfat network apply died after "apply:" (vlog under
 * set -e) and picked a NIC with no carrier; hardware hostname looped through sudo as root while D-Bus was not up;
 * NoMachine's unit shipped without NoMachine (failed unit every boot); USB auto-mount retried the device-mapper-held
 * Ventoy boot partition all day.
 */
const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const NET_APPLY = 'scripts/exfat/highascg-exfat-network-apply.sh'

/** The named bash functions out of the network-apply script (top-level code needs root + a mounted stick). */
function netFns(names) {
	const src = read(NET_APPLY)
	return names
		.map((n) => {
			const m = src.match(new RegExp(`^${n}\\(\\) \\{\\n[\\s\\S]*?\\n\\}$`, 'm'))
			assert.ok(m, `${n}() in ${NET_APPLY}`)
			return m[0]
		})
		.join('\n')
}

function bash(script, env = {}) {
	return execFileSync('bash', ['-c', `set -euo pipefail\n${script}`], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
		timeout: 20000,
	})
}

describe('WO-702 exfat network apply', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo702-'))
	after(() => fs.rmSync(tmp, { recursive: true, force: true }))
	const fns = netFns(['log', 'vlog', 'iface_allowed', 'pick_iface'])
	const pre = `LOG=${tmp}/apply.log\nIFACE=""\n${fns}\n`

	it('vlog when not verbose does not end the script under set -e', () => {
		assert.equal(bash(`${pre}VERBOSE=0\nvlog "  args: x"\necho after`).trim(), 'after')
		assert.match(bash(`${pre}VERBOSE=1\nvlog "shown" 2>&1\necho after`), /shown[\s\S]*after/)
	})

	it('waits for a carrier instead of taking the first NIC (.64: eno2 picked, enp5s0 came up a moment later)', () => {
		const net = path.join(tmp, 'net')
		for (const n of ['eno2', 'enp5s0', 'lo']) {
			fs.mkdirSync(path.join(net, n), { recursive: true })
			fs.writeFileSync(path.join(net, n, 'carrier'), '0\n')
		}
		const later = `(sleep 1; echo 1 > ${net}/enp5s0/carrier) &\n`
		const env = { HIGHASCG_SYS_CLASS_NET: net }
		const vars = `SYS_NET=${net}\n`
		assert.equal(bash(`${pre}${vars}CARRIER_WAIT_S=4\n${later}pick_iface`, env).trim(), 'enp5s0')
		fs.writeFileSync(path.join(net, 'enp5s0', 'carrier'), '0\n')
		assert.equal(bash(`${pre}${vars}CARRIER_WAIT_S=0\npick_iface`, env).trim(), 'eno2', 'no carrier: first allowed')
		assert.equal(bash(`${pre}${vars}CARRIER_WAIT_S=4\nIFACE=enp5s0\npick_iface`, env).trim(), 'enp5s0')
	})

	it('accepts predictable PCI names like the Node rule (enp5s0 was rejected, so .64 could only pick eno2)', () => {
		const { isAllowedEthernetIface } = require('../../src/config/network-settings')
		for (const n of ['enp5s0', 'enp0s31f6', 'eno1', 'ens3', 'eth0', 'lo', 'wlp2s0', 'docker0', 'enp5s0;x']) {
			let ok = true
			try {
				bash(`${pre}iface_allowed '${n}'`)
			} catch {
				ok = false
			}
			assert.equal(ok, isAllowedEthernetIface(n), n)
		}
		for (const rel of ['tools/runtime/highascg-network-reset.sh', NET_APPLY])
			assert.ok(read(rel).includes('=~ ^(eth[0-9]+|en[a-z0-9]+)$ ]]'), rel)
	})

	it('the script reads the sysfs root and wait from the environment; bash -n is clean', () => {
		const src = read(NET_APPLY)
		assert.match(src, /^SYS_NET="\$\{HIGHASCG_SYS_CLASS_NET:-\/sys\/class\/net\}"$/m)
		assert.match(src, /^CARRIER_WAIT_S="\$\{HIGHASCG_CARRIER_WAIT_S:-10\}"$/m)
		execFileSync('bash', ['-n', path.join(ROOT, NET_APPLY)])
	})
})

describe('WO-702 hardware hostname', () => {
	const { applySystemHostname } = require('../../src/system/hardware-identity')
	const recorder = (failing) => {
		const calls = []
		const exec = (cmd, args) => {
			calls.push([cmd, ...args].join(' '))
			if (failing.includes(cmd)) throw new Error('Failed to connect to bus: No such file or directory')
			return ''
		}
		return { calls, exec }
	}

	it('as root with no D-Bus: never sudo, sets the name directly', () => {
		const { calls, exec } = recorder(['hostnamectl'])
		const written = []
		const r = applySystemHostname('highascg5867', null, {
			exec,
			isRoot: true,
			current: 'highascg-nvidia-595',
			writeEtcHostname: (n) => written.push(n),
		})
		assert.deepEqual(r, { ok: true, applied: true, hostname: 'highascg5867' })
		assert.deepEqual(calls, ['hostnamectl set-hostname highascg5867', 'hostname highascg5867'])
		assert.deepEqual(written, ['highascg5867'])
	})

	it('as root when everything fails: a bounded failure, still no sudo', () => {
		const { calls, exec } = recorder(['hostnamectl', 'hostname'])
		const r = applySystemHostname('highascg5867', null, { exec, isRoot: true, current: 'x' })
		assert.equal(r.ok, false)
		assert.ok(!calls.some((c) => c.startsWith('sudo')), calls.join(' | '))
	})

	it('unprivileged keeps the sudo path (the allowlisted helper last)', () => {
		const { calls, exec } = recorder(['hostnamectl', 'sudo'])
		applySystemHostname('highascg5867', null, { exec, isRoot: false, current: 'x' })
		assert.deepEqual(calls, [
			'hostnamectl set-hostname highascg5867',
			'sudo -n hostnamectl set-hostname highascg5867',
			'sudo -n /usr/local/lib/highascg/highascg-apply-hardware-hostname.sh',
		])
	})

	it('the unit waits for D-Bus', () => {
		const unit = read('scripts/systemd/highascg-hardware-hostname.service')
		assert.match(unit, /^Wants=dbus\.socket$/m)
		assert.match(unit, /^After=.*\bdbus\.socket\b.*\bdbus\.service\b/m)
	})
})

describe('WO-702 NoMachine unit does not ship', () => {
	const lines = [
		'usr/lib/systemd/system/nxserver.service',
		'etc/systemd/system/multi-user.target.wants/nxserver.service',
	]
	for (const list of [
		'tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list',
		'tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list',
	]) {
		it(path.basename(list), () => {
			const rows = read(list).split('\n')
			for (const l of lines) assert.ok(rows.includes(l), `${l} in ${list}`)
			assert.ok(!rows.includes('lib/systemd/system/nxserver.service'), 'merged-usr: no bare lib/ line')
		})
	}
	it('the squashfs verifier asserts they are absent', () => {
		const v = read('tools/eggs/live-usb/verify-iso-squashfs-excludes.sh')
		for (const l of ['usr/NX', ...lines]) assert.ok(v.includes(`'${l}'`), l)
	})
})

describe('WO-702 USB auto-mount skips device-mapper-held devices', () => {
	const { startUsbAutoMount, sysfsHolders } = require('../../src/media/usb-automount')
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

	it('the Ventoy boot partition (held by dm-0) is never mounted and logged once; other drives mount', async () => {
		const mounts = []
		const logs = []
		const stop = startUsbAutoMount(
			{},
			{
				force: true,
				intervalMs: 10,
				inhibitFile: '/nonexistent/wo702-inhibit',
				listCandidates: async () => [
					{ blockDevice: '/dev/sda1', label: 'Ventoy', fsType: 'exfat' },
					{ blockDevice: '/dev/sdb1', label: 'MEDIA', fsType: 'exfat' },
				],
				listMounted: async () => [],
				holdersOf: (dev) => (dev === '/dev/sda1' ? ['dm-0'] : []),
				mount: async (dev) => {
					mounts.push(dev)
					return { ok: true, mountpoint: `/media/casparcg/${dev}` }
				},
				log: (m) => logs.push(m),
			}
		)
		await sleep(120)
		stop()
		assert.deepEqual(mounts, ['/dev/sdb1'])
		assert.equal(logs.filter((m) => m.includes('skip /dev/sda1 — held by dm-0')).length, 1, logs.join('\n'))
	})

	it('sysfsHolders: an unknown device has none', () => {
		assert.deepEqual(sysfsHolders('/dev/wo702-nope'), [])
	})
})
