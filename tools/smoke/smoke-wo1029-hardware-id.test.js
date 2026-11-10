'use strict'

// WO-1029 P1d: boot unit and node must derive the same hardware id; a stored id with a present MAC is kept.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { getHardwareIdentity } = require('../../src/system/hardware-identity')
const { loadNetworkConfig } = require('../../src/system/hardware-identity-select')

const ENO1 = { name: 'eno1', mac: '10:7c:61:3e:b9:dc', address: '10.0.0.12', internal: false }
const ENO2 = { name: 'eno2', mac: '10:7c:61:3e:b9:db', address: null, internal: false }
const ifaces = [ENO1, ENO2]
const stored7579 = { hardwareId: '7579', mac: ENO2.mac, hostname: 'highascg7579', source: 'mac', primaryInterface: 'eno2' }
const ask = (o) => getHardwareIdentity({ persist: false, hostname: '', ...o }) // hostname '' = a box not named yet

test('this box: stored 7579 (eno2), config eno2 or none -> both paths answer 7579', () => {
	const node = ask({ interfaces: ifaces, stored: stored7579, networkCfg: { primaryInterface: 'eno2' } })
	const boot = ask({ interfaces: ifaces, stored: stored7579 })
	assert.equal(node.hardwareId, '7579')
	assert.equal(boot.hardwareId, '7579')
	assert.equal(boot.hostname, 'highascg7579')
})

test('the live state of this box: file flipped to 7580 (eno1), hostname highascg7579 -> the hostname wins', () => {
	const flipped = { hardwareId: '7580', mac: ENO1.mac, hostname: 'highascg7580', source: 'mac', primaryInterface: 'eno1' }
	for (const networkCfg of [undefined, { primaryInterface: 'eno2' }, { primaryInterface: 'eno1' }]) {
		const id = ask({ interfaces: ifaces, stored: flipped, networkCfg, hostname: 'highascg7579' })
		assert.equal(id.hardwareId, '7579')
		assert.equal(id.primaryInterface, 'eno2')
	}
	// a hostname no NIC of the box derives (a cloned image) has no say
	assert.equal(ask({ interfaces: ifaces, stored: flipped, hostname: 'highascg1111' }).hardwareId, '7580')
	assert.equal(ask({ interfaces: ifaces, stored: flipped, hostname: 'highascg-nvidia-live' }).hardwareId, '7580')
})

test('stored id whose MAC is gone is re-derived', () => {
	const gone = { ...stored7579, mac: 'aa:bb:cc:dd:ee:ff', hardwareId: '1234', hostname: 'highascg1234' }
	assert.equal(ask({ interfaces: ifaces, stored: gone, networkCfg: { primaryInterface: 'eno2' } }).hardwareId, '7579')
})

test('nothing stored: node rule (configured primary, else first wired) and deterministic', () => {
	assert.equal(ask({ interfaces: ifaces, stored: null, networkCfg: { primaryInterface: 'eno2' } }).hardwareId, '7579')
	const a = ask({ interfaces: ifaces, stored: null })
	const b = ask({ interfaces: [ENO2, ENO1], stored: null, networkCfg: {} })
	assert.equal(a.hardwareId, '7580') // eno1 sorts first
	assert.equal(b.hardwareId, a.hardwareId)
})

test('interface order shuffled -> same id', () => {
	const ids = [[ENO1, ENO2], [ENO2, ENO1]].map((l) => ask({ interfaces: l, stored: null, networkCfg: { primaryInterface: 'eno2' } }).hardwareId)
	assert.equal(new Set(ids).size, 1)
})

test('config change does not move a stored id', () => {
	const s = { ...stored7579 }
	assert.equal(ask({ interfaces: ifaces, stored: s, networkCfg: { primaryInterface: 'eno1' } }).hardwareId, '7579')
})

test('boot config loader reads what the node reads (general.json network + flat network.json slice)', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1029-'))
	try {
		fs.writeFileSync(path.join(dir, 'general.json'), JSON.stringify({ network: { primaryInterface: 'eno2', mode: 'static' } }))
		assert.equal(loadNetworkConfig(dir).primaryInterface, 'eno2')
		fs.writeFileSync(path.join(dir, 'network.json'), JSON.stringify({ primaryInterface: 'eno1' }))
		assert.equal(loadNetworkConfig(dir).primaryInterface, 'eno1')
		assert.deepEqual(loadNetworkConfig(path.join(dir, 'nope')), {})
		const cfg = loadNetworkConfig(dir)
		assert.equal(ask({ interfaces: ifaces, stored: null, networkCfg: cfg }).hardwareId, '7580')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
