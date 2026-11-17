'use strict'

/**
 * WO-1106 D3 (lan-ipv4 part) — the games' own join URLs (src/utils/lan-ipv4.js getLanIPv4Addresses) rank link-local
 * 169.254/16 and docker0 / br-<id> / virbr / veth bridges LAST, with the very classifier of Settings ▸ Games
 * (src/games/games-join.js kindOf / listAddresses): both lists agree, address for address, on any interface set.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { getLanIPv4Addresses } = require('../../src/utils/lan-ipv4')
const J = require('../../src/games/games-join')
const { createRcGame } = require('../../modules/rc-game/server/rc-game')
const { createSkGame } = require('../../modules/toy-skirmish/server/sk-game')
const { createSaladGame } = require('../../modules/stage-salad/server/salad-game')

const v4 = (address, internal = false) => [{ address, family: 'IPv4', internal }]
const NETS = { lo: v4('127.0.0.1', true), docker0: v4('172.17.0.1'), 'br-0123456789ab': v4('172.18.0.1'), virbr0: v4('192.168.122.1'),
	veth1a2b3c: v4('10.200.0.1'), enp4s0: v4('169.254.10.2'), br0: v4('192.168.1.5'), eno1: v4('192.168.0.15'), tailscale0: v4('100.101.245.97'),
	wlan0: [{ address: 'fe80::1', family: 'IPv6', internal: false }, ...v4('10.0.0.7')] }
const games = (nets) => J.listAddresses(nets).filter((a) => a.kind !== 'loopback').map((a) => a.ip)

test('D3: venue LAN first (by address), then VPN, then link-local and container / VM bridges; never loopback', () => {
	assert.deepEqual(getLanIPv4Addresses(NETS), ['10.0.0.7', '192.168.0.15', '192.168.1.5', '100.101.245.97',
		'10.200.0.1', '169.254.10.2', '172.17.0.1', '172.18.0.1', '192.168.122.1'])
	assert.deepEqual(getLanIPv4Addresses({ lo: NETS.lo, docker0: NETS.docker0, enp4s0: NETS.enp4s0 }), ['169.254.10.2', '172.17.0.1'],
		'only local-only addresses: still listed (the operator sees them), nothing better exists')
	assert.deepEqual(getLanIPv4Addresses({ lo: NETS.lo }), [])
	assert.ok(Array.isArray(getLanIPv4Addresses()), 'the real interfaces still work without an argument')
})

test('D3: the games\' order = Settings ▸ Games listAddresses() without loopback, and the first = the automatic pick', () => {
	const pool = Object.entries(NETS).filter(([k]) => k !== 'lo')
	let seed = 7
	const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32)
	for (let i = 0; i < 200; i++) {
		const nets = { lo: NETS.lo }
		for (const [k, v] of pool) if (rnd() < 0.5) nets[k] = v
		const list = getLanIPv4Addresses(nets)
		assert.deepEqual(list, games(nets), JSON.stringify(Object.keys(nets)))
		const pick = J.pickAddress(J.listAddresses(nets), '')
		assert.equal(list[0] ?? null, pick.kind === 'loopback' ? null : pick.ip, JSON.stringify(Object.keys(nets)))
	}
})

test('D3: every game\'s public joinUrls lead with the LAN address (docker0 / 169.254 last), RC still drops 100.64/10', async (t) => {
	const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-games2-lan-'))
	const bakerDeps = (name) => ({ loadProject: () => ({ name: 'Smoke hall', previs: {} }), mvrStore: { get: () => null, mesh: async () => null },
		cacheDir: path.join(TMP, name) })
	const nets = { lo: NETS.lo, docker0: NETS.docker0, enp4s0: NETS.enp4s0, eno1: NETS.eno1, tailscale0: NETS.tailscale0 }
	const lanIps = () => getLanIPv4Addresses(nets)
	const all = [
		['rc', createRcGame({ lanIps, bakerDeps: bakerDeps('rc'), loadBots: () => new Promise(() => {}), log: () => {} })],
		['sk', createSkGame({ lanIps, bakerDeps: bakerDeps('sk'), log: () => {} })],
		['salad', createSaladGame({ lanIps, readTracking: async () => null, bakerDeps: bakerDeps('salad'), log: () => {} })],
	]
	t.after(() => {
		for (const [, g] of all) g.disable()
		fs.rmSync(TMP, { recursive: true, force: true })
	})
	for (const [id, g] of all) {
		g.enable()
		const urls = g.state().joinUrls
		const ips = urls.map((u) => new URL(u).hostname)
		if (id === 'rc') assert.deepEqual(ips, ['192.168.0.15', '169.254.10.2', '172.17.0.1'], 'rc: 100.64/10 never public (B53)')
		else assert.deepEqual(ips, ['192.168.0.15', '100.101.245.97', '169.254.10.2', '172.17.0.1'], id)
	}
	await new Promise((r) => setTimeout(r, 20)) // the scene bakes started by enable settle before the temp dir goes
})
