'use strict'

/**
 * WO-1066 — Bluetooth game controllers: bluetoothctl output parsing, controllers-only listing, the one-step pair
 * (pair + trust + connect) and the routes — against a fake bluetoothctl (no adapter, no radio).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { createBluetoothPads, parseDevices, parseInfo } = require('../../src/bluetooth/bluetooth-pads')
const { handleGet, handlePost } = require('../../src/api/routes-bluetooth')

const PAD = 'A4:53:85:11:22:33'
const PHONE = '44:22:93:BB:37:42'
const info = (name, icon, o = {}) => `Device X (public)\n\tName: ${name}\n\tAlias: ${name}\n\tIcon: ${icon}\n\tPaired: ${o.paired ? 'yes' : 'no'}\n\tTrusted: ${o.trusted ? 'yes' : 'no'}\n\tConnected: ${o.connected ? 'yes' : 'no'}\n`

function fake(state = {}) {
	const s = { paired: false, trusted: false, connected: false, calls: [], ...state }
	const run = async (args) => {
		s.calls.push(args.join(' '))
		const ok = (out = '') => ({ ok: true, code: 0, out, err: '' })
		if (args[0] === 'show') return s.noTool ? { ok: false, missing: true, out: '', err: '' } : ok(`Controller F0:20:FF:00:2E:5D (public)\n\tPowered: ${s.off ? 'no' : 'yes'}\n`)
		if (args[0] === 'devices') return ok(`Device ${PHONE} 44-22-93-BB-37-42\nDevice D7:6D:29:FD:1B:1C Luna 3\nDevice ${PAD} Wireless Controller\n`)
		if (args[0] === 'info') {
			if (args[1] === PAD) return s.gone ? { ok: false, out: `Device ${PAD} not available\n`, err: '' } : ok(info('Wireless Controller', 'input-gaming', s))
			return ok(info('Luna 3', 'audio-headset'))
		}
		if (args[0] === 'pair') return s.pairFails ? { ok: false, out: 'Failed to pair: org.bluez.Error.AuthenticationFailed\n', err: '' } : ((s.paired = true), ok())
		if (args[0] === 'trust') return (s.trusted = true), ok()
		if (args[0] === 'connect') return (s.connected = true), ok()
		if (args[0] === 'disconnect') return (s.connected = false), ok()
		if (args[0] === 'remove') return (s.paired = false), ok()
		return ok()
	}
	return { s, pads: createBluetoothPads({ run, spawn: () => ({ on() {}, kill() {} }), now: () => s.now || 1000 }) }
}

describe('WO-1066 Bluetooth controllers', () => {
	it('parses bluetoothctl devices / info', () => {
		assert.deepEqual(parseDevices(`Device ${PAD} Wireless Controller\nnoise\n`), [{ address: PAD, name: 'Wireless Controller' }])
		const i = parseInfo(info('Wireless Controller', 'input-gaming', { paired: true, connected: true }), { address: PAD, name: '' })
		assert.deepEqual(i, { address: PAD, name: 'Wireless Controller', paired: true, trusted: false, connected: true, gamepad: true })
		assert.equal(parseInfo(info('Luna 3', 'audio-headset'), { address: 'X', name: 'Luna 3' }).gamepad, false)
		assert.equal(parseInfo(info('Pad', 'input-keyboard', { paired: true }), { address: 'X', name: 'Pad' }).gamepad, true, 'a paired input device stays listed')
	})
	it('lists controllers only, and never asks about nameless devices', async () => {
		const { s, pads } = fake()
		const st = await pads.status()
		assert.equal(st.available, true)
		assert.deepEqual(st.devices.map((d) => d.name), ['Wireless Controller'])
		assert.ok(!s.calls.includes(`info ${PHONE}`), 'a beacon with no name costs no info call')
	})
	it('no bluetoothctl → not available, with what to install', async () => {
		const st = await fake({ noTool: true }).pads.status()
		assert.equal(st.available, false)
		assert.match(st.reason, /apt install bluez/)
	})
	it('pair = pair + trust + connect; a failure names its step', async () => {
		const { s, pads } = fake()
		assert.deepEqual(await pads.pair(PAD.toLowerCase()), { ok: true, address: PAD })
		assert.deepEqual(s.calls.filter((c) => /^(pair|trust|connect) /.test(c)), [`pair ${PAD}`, `trust ${PAD}`, `connect ${PAD}`])
		const bad = await fake({ pairFails: true }).pads.pair(PAD)
		assert.equal(bad.ok, false)
		assert.equal(bad.step, 'pair')
		assert.match(bad.error, /AuthenticationFailed/)
		assert.equal((await fake({ gone: true }).pads.pair(PAD)).step, 'find')
		assert.equal((await pads.pair('; rm -rf /')).step, 'address', 'only an address reaches bluetoothctl')
	})
	it('an already paired controller is not paired again', async () => {
		const { s, pads } = fake({ paired: true })
		await pads.pair(PAD)
		assert.ok(!s.calls.includes(`pair ${PAD}`))
	})
	it('scan is timed and not started twice', () => {
		const { pads } = fake()
		assert.deepEqual(pads.startScan(30), { ok: true, scanning: true, seconds: 30 })
		assert.equal(pads.startScan(30).scanning, true)
		assert.equal(pads.startScan(9999).seconds <= 60, true)
	})
	it('routes: GET lists; POST pair / forget; a bad address is 400, a failure 409, an unknown op 404', async () => {
		const { pads } = fake()
		const deps = { pads }
		assert.equal(JSON.parse((await handleGet(deps)).body).devices.length, 1)
		assert.equal((await handlePost('/api/bluetooth/pair', JSON.stringify({ address: PAD }), deps)).status, 200)
		assert.equal((await handlePost('/api/bluetooth/forget', JSON.stringify({ address: PAD }), deps)).status, 200)
		assert.equal((await handlePost('/api/bluetooth/pair', JSON.stringify({ address: 'nope' }), deps)).status, 400)
		assert.equal((await handlePost('/api/bluetooth/pair', JSON.stringify({ address: PAD }), { pads: fake({ pairFails: true }).pads })).status, 409)
		assert.equal((await handlePost('/api/bluetooth/explode', '{}', deps)).status, 404)
		assert.equal(JSON.parse((await handlePost('/api/bluetooth/scan', '{}', deps)).body).scanning, true)
	})
})
