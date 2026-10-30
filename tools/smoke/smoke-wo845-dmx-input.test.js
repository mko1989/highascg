'use strict'

/**
 * WO-845 smoke — Art-Net / sACN input defects from the 29.10 sweep (REPORT §5 "Art-Net / sACN"):
 *  - ArtDmx Length was read little-endian: trimmed universes (18/24/100 ch) threw on every packet
 *  - sACN levels from the `sacn` lib are PERCENT (0-100); they were stored as 0-255 (border always OFF)
 *  - every changed DMX frame re-parsed the whole project from disk (~14 ms, ~0.6 s/s of main thread)
 *  - the follow self-loop guard was never re-evaluated when the input patch / config changed
 * No sockets are bound and nothing is sent: pure packet parsing, stubbed receivers, output master off.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { encodeArtDmx } = require('../../src/fixtures/artdmx')
const { parseArtDmx } = require('../../src/artnet/artnet-packet')

test('WO-845: parseArtDmx reads Length big-endian (trimmed universes no longer throw)', () => {
	for (const len of [2, 18, 24, 100, 256, 512]) {
		const data = new Uint8Array(len).map((_, i) => (i + 1) & 0xff)
		const pkt = encodeArtDmx({ portAddress: 3, sequence: 1, data })
		const out = parseArtDmx(pkt)
		assert.equal(out.length, len, `length ${len}`)
		assert.equal(out[0], 1)
		assert.equal(out[len - 1], len & 0xff)
	}
	// A lying Length (bigger than the datagram) is capped by the bytes actually present, never over-read.
	const pkt = encodeArtDmx({ portAddress: 3, data: new Uint8Array(24) })
	pkt.writeUInt16BE(512, 16)
	assert.equal(parseArtDmx(pkt).length, 24)
})

test('WO-845: sACN percent levels from the lib are converted back to 0-255', () => {
	const { Packet } = require('sacn')
	const { SacnReceiver } = require('../../src/artnet/sacn-receiver')
	// Build raw DMX 255/128/1 on the wire, then parse it the way the lib's Receiver does.
	const wire = new Packet({ universe: 1, payload: { 1: 255, 2: 128, 3: 1 }, useRawDmxValues: true }).buffer
	for (const parsed of [new Packet(wire)]) {
		// What the lib hands the receiver for a parsed packet: payload in PERCENT, raw bytes beside it.
		assert.ok(parsed.payload[1] <= 100, 'lib payload is percent')
		let got = null
		const stub = {
			_inputUniverse: 1,
			_bumpStat() {},
			handleData(buf) {
				got = buf
			},
		}
		SacnReceiver.prototype._handleSacnPacket.call(stub, parsed)
		assert.equal(got[0], 255, 'DMX 255 stays 255 (was 100)')
		assert.equal(got[1], 128)
		assert.equal(got[2], 1)
		// percent-only fallback (no raw buffer) must agree within rounding
		got = null
		const percentOnly = { universe: 1, payload: parsed.payload, payloadAsBuffer: null }
		SacnReceiver.prototype._handleSacnPacket.call(stub, percentOnly)
		assert.equal(got[0], 255)
		assert.ok(Math.abs(got[1] - 128) <= 1)
	}
})

test('WO-845: a changed DMX frame does not re-read the project from disk', () => {
	const projectScenes = require('../../src/engine/project-scenes')
	const realLoad = projectScenes.loadProjectScenes
	let loads = 0
	projectScenes.loadProjectScenes = (...a) => {
		loads++
		return realLoad(...a)
	}
	try {
		const { DmxBorderReceiverBase } = require('../../src/artnet/dmx-border-receiver-base')
		class Stub extends DmxBorderReceiverBase {
			_tag() {
				return '[stub]'
			}
			_protocolName() {
				return 'stub'
			}
			_defaultPort() {
				return 0
			}
			_statsHead() {
				return ''
			}
			_applyInitOverrides() {}
			_initTransport() {}
			_ensureListening() {}
		}
		const broadcasts = []
		const rx = new Stub({
			log() {},
			config: { dmx: { artnetInputEnabled: true, artnetInputWsIntervalMs: 50 } },
			_wsBroadcast: (type, payload) => broadcasts.push([type, payload]),
		})
		rx._flushCasparBorder = () => {} // would write the live border file
		const slot = { enabled: true, artnetListenEnabled: true, artnetPatch: { universe: 0 }, slices: [{ id: 's1' }] }
		rx.reconfigureFromProject({ scenes: { globalBorders: [slot] } })
		assert.equal(rx._targetConfigured, true)
		loads = 0
		for (let i = 1; i <= 40; i++) {
			const d = Buffer.alloc(512)
			d[0] = 255
			d[1] = i // changes every frame
			rx._wsBroadcastIntervalMs = 0
			rx._lastWsBroadcastMs = 0
			rx.handleData(d)
		}
		assert.equal(loads, 0, `hot path parsed the project from disk ${loads}x (want 0)`)
		assert.ok(broadcasts.length > 0, 'WS broadcasts still happen')
		assert.deepEqual(broadcasts[broadcasts.length - 1][1].border.slices, [{ id: 's1' }], 'WS payload uses the cached slot')
	} finally {
		projectScenes.loadProjectScenes = realLoad
	}
})

test('WO-845: follow self-loop guard is re-evaluated when the input patch changes under an unchanged fixtures slice', () => {
	const { createFollowService } = require('../../src/fixtures/follow-service')
	const { emitProjectChanged } = require('../../src/engine/project-events')
	const ctx = { log() {}, config: { dmx: { artnetInputEnabled: true, artnetInputUniverse: 0, artnetInputNet: 0, artnetInputSubnet: 0 } } }
	const hub = { now: () => 0, list: () => [] }
	const svc = createFollowService(ctx, hub, { duties: { has: () => true } })
	try {
		// Output master OFF (nothing can reach the wire); dest is this box's own Art-Net port on loopback.
		const slice = {
			output: { enabled: false, protocol: 'artnet' },
			patch: [
				{ id: 'a', name: 'Spot A', universe: 3, address: 1, dest: '127.0.0.1:6454', pose: { x: 0, y: 0, z: 6, hang: 'truss', yaw: 0 }, follow: 1, aim_z: 0 },
			],
		}
		emitProjectChanged({ name: 'Show', fixtures: slice })
		const state = () => svc.engine.status().fixtures[0]
		assert.equal(state().problem, null, 'input on universe 0: universe 3 is not a loop')

		ctx.config.dmx.artnetInputUniverse = 3 // operator patches the input onto the fixture's universe
		assert.equal(svc.reevaluateGuard(), true, 'guard inputs changed -> engine reconfigured')
		// reload() re-reads the project from disk (the test temp dir has none), so re-supply the slice
		emitProjectChanged({ name: 'Show', fixtures: slice })
		assert.match(String(state().problem), /loop into this box/, 'universe 3 on the input now mutes the fixture')

		// A project change with the SAME fixtures slice must also re-run the guard (input changed again)
		ctx.config.dmx.artnetInputUniverse = 0
		emitProjectChanged({ name: 'Show', fixtures: slice })
		assert.equal(state().problem, null, 'guard cleared again')
		assert.equal(svc.reevaluateGuard(), false, 'nothing changed -> no reconfigure')
	} finally {
		svc.stop()
	}
})
