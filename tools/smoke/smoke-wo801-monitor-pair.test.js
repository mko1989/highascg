'use strict'

/**
 * WO-801 — headphone pair monitor: the monitor output plays one stereo pair (1+2 … 15+16) of the 16 channels every
 * Caspar channel carries, by swapping the OpenAL consumer (port 500) for an ffmpeg → ALSA consumer with `pan=`
 * (port 730), and back for 'mix'. The PRV / PGM channels are never touched and no PortAudio consumer is added.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const persistence = require('../../src/utils/persistence')
const mixerState = require('../../src/audio/mixer-state')
const MP = require('../../src/audio/monitor-pair')
const routesAudio = require('../../src/api/routes-audio')
const routesAudioMixer = require('../../src/api/routes-audio-mixer')

const ROOT = path.join(__dirname, '../..')
const CONFIG = {
	casparServer: { screen_count: 1 },
	audioOutputs: [{ id: 'audio_2', enabled: true, type: 'system-audio', deviceName: 'sc60mon', role: 'monitor' }],
}
const port = (n) => `<port_${n}>\n<consumer>x</consumer>\n</port_${n}>`

/** Fake AMCP: INFO answers with the given ports; `fail` = lines (or a predicate) that answer an error. */
function fakeCtx({ ports = [500], fail = () => false, config = CONFIG } = {}) {
	const sent = []
	const broadcasts = []
	return {
		sent,
		broadcasts,
		config,
		log: () => {},
		_wsBroadcast: (type, data) => broadcasts.push([type, data]),
		amcp: {
			info: async () => ({ ok: true, data: `<channel><output><port>${ports.map(port).join('')}</port></output></channel>` }),
			raw: async (line) => {
				sent.push(line)
				return fail(line, sent) ? { ok: false, data: '404 ADD FAILED' } : { ok: true, data: '202 OK' }
			},
		},
	}
}
const noSleep = { sleep: async () => {} }

describe('WO-801 — headphone pair monitor', () => {
	beforeEach(() => persistence.set(mixerState.STATE_KEY, null))

	it('pairs, device names and the AMCP lines', () => {
		assert.deepEqual(MP.MONITOR_PAIRS.slice(0, 5), ['mix', '1+2', '3+4', '5+6', '7+8'])
		assert.equal(MP.normalizeMonitorPair('3+4'), '3+4')
		for (const bad of ['2+3', '17+18', '', null, 'all', 3]) assert.equal(MP.normalizeMonitorPair(bad), 'mix', String(bad))
		assert.equal(MP.alsaPcmName('sc60mon'), 'plug:sc60mon', 'a bare PCM name gets plug: (and a colon: never a media path)')
		assert.equal(MP.alsaPcmName('hw:2,0'), 'hw:2,0')
		assert.equal(MP.alsaPcmName(''), 'plug:default')
		assert.deepEqual(MP.pairCommands(7, '3+4', 'sc60mon'), [
			'REMOVE 7-500',
			'ADD 7-730 STREAM plug:sc60mon -format alsa -filter:a pan=stereo|c0=c2|c1=c3',
		])
		assert.equal(MP.pairCommands(7, '15+16', 'sc60mon')[1].endsWith('pan=stereo|c0=c14|c1=c15'), true)
		assert.deepEqual(MP.mixCommands(7, 'sc60mon'), ['REMOVE 7-730', 'ADD 7-500 AUDIO DEVICE_NAME sc60mon'])
		assert.deepEqual(MP.mixCommands(7, ''), ['REMOVE 7-730', 'ADD 7-500 AUDIO'])
		assert.equal(MP.monitorDeviceName(CONFIG), 'sc60mon')
		assert.ok(MP.monitorChannel(CONFIG) > 0, 'the monitor bus gets a channel')
	})

	it('a pair swaps the OpenAL consumer for the ALSA pair consumer on the monitor channel only', async () => {
		const ctx = fakeCtx({ ports: [500] })
		const ch = MP.monitorChannel(CONFIG)
		const r = await MP.applyMonitorPair(ctx, '3+4', noSleep)
		assert.equal(r.ok, true, r.error)
		assert.deepEqual(ctx.sent, [`REMOVE ${ch}-500`, `ADD ${ch}-730 STREAM plug:sc60mon -format alsa -filter:a pan=stereo|c0=c2|c1=c3`])
		assert.ok(!ctx.sent.some((l) => /portaudio/i.test(l)), 'WO-683: never a PortAudio consumer')
	})

	it('pair → pair re-adds the pair port; mix puts the OpenAL consumer back (retried while the device is busy)', async () => {
		const ch = MP.monitorChannel(CONFIG)
		const p2p = fakeCtx({ ports: [730] })
		assert.equal((await MP.applyMonitorPair(p2p, '7+8', noSleep)).ok, true)
		assert.deepEqual(p2p.sent, [`REMOVE ${ch}-730`, `ADD ${ch}-730 STREAM plug:sc60mon -format alsa -filter:a pan=stereo|c0=c6|c1=c7`])
		let adds = 0
		const mix = fakeCtx({ ports: [730], fail: (l) => l.includes('AUDIO') && ++adds < 3 })
		const r = await MP.applyMonitorPair(mix, 'mix', noSleep)
		assert.equal(r.ok, true, r.error)
		assert.deepEqual(mix.sent, [`REMOVE ${ch}-730`, ...Array(3).fill(`ADD ${ch}-500 AUDIO DEVICE_NAME sc60mon`)])
		const noop = fakeCtx({ ports: [500] })
		assert.equal((await MP.applyMonitorPair(noop, 'mix', noSleep)).ok, true)
		assert.deepEqual(noop.sent, [], 'already on the OpenAL mix: nothing sent')
	})

	it('refuses a channel without a headphone consumer, and never leaves the headphones without one', async () => {
		const none = fakeCtx({ ports: [720] })
		const r = await MP.applyMonitorPair(none, '3+4', noSleep)
		assert.equal(r.status, 409)
		assert.deepEqual(none.sent, [], 'stale channel map: no consumer touched')
		const ch = MP.monitorChannel(CONFIG)
		const bad = fakeCtx({ ports: [500], fail: (l) => l.includes('STREAM') })
		const r2 = await MP.applyMonitorPair(bad, '3+4', noSleep)
		assert.equal(r2.ok, false)
		assert.equal(bad.sent.at(-1), `ADD ${ch}-500 AUDIO DEVICE_NAME sc60mon`, 'the OpenAL consumer comes back')
		const noMon = fakeCtx({ config: { casparServer: { screen_count: 1 } } })
		assert.equal((await MP.applyMonitorPair(noMon, '3+4', noSleep)).status, 400)
	})

	it('POST /api/audio/monitor-source { pair } applies, stores and broadcasts the pair; mix keeps the WO-604 shape', async () => {
		const ctx = fakeCtx({ ports: [500] })
		let r = await routesAudio.handlePost('/api/audio/monitor-source', JSON.stringify({ pair: '3+4' }), ctx)
		assert.equal(r.status, 200, r.body)
		assert.equal(JSON.parse(r.body).pair, '3+4')
		assert.equal(mixerState.snapshot().monitorPair, '3+4')
		assert.deepEqual(ctx.broadcasts.at(-1), ['change', { path: 'audioMixer', value: mixerState.snapshot() }])
		assert.equal(JSON.parse(routesAudioMixer.handleGet().body).monitorPair, '3+4')
		assert.ok(!ctx.sent.some((l) => l.startsWith('PLAY')), 'a pair-only call routes nothing')
		r = await routesAudio.handlePost('/api/audio/monitor-source', JSON.stringify({ pair: '4+5' }), fakeCtx())
		assert.equal(r.status, 400)
		assert.equal(mixerState.monitorPair(), '3+4', 'a refused pair keeps the stored one')
		const failed = fakeCtx({ ports: [] })
		r = await routesAudio.handlePost('/api/audio/monitor-source', JSON.stringify({ pair: '5+6' }), failed)
		assert.equal(r.status, 409)
		assert.equal(mixerState.monitorPair(), '3+4', 'stored only after Caspar took it')
		r = await routesAudio.handlePost('/api/audio/monitor-source', JSON.stringify({ pair: 'mix' }), fakeCtx({ ports: [730] }))
		assert.equal(r.status, 200, r.body)
		assert.deepEqual(JSON.parse(routesAudioMixer.handleGet().body), { ok: true, gains: {}, muted: {}, solos: [] })
	})

	it('Caspar reconnect re-applies a stored pair; mix and an already-swapped channel are left alone', async () => {
		const ch = MP.monitorChannel(CONFIG)
		const fresh = fakeCtx({ ports: [500] })
		const r = await MP.reassertMonitorPair(fresh, '5+6')
		assert.equal(r.ok, true)
		assert.equal(fresh.sent.at(-1), `ADD ${ch}-730 STREAM plug:sc60mon -format alsa -filter:a pan=stereo|c0=c4|c1=c5`)
		const kept = fakeCtx({ ports: [730] })
		assert.equal((await MP.reassertMonitorPair(kept, '5+6')).skipped, true)
		assert.deepEqual(kept.sent, [])
		const mix = fakeCtx({ ports: [500] })
		assert.equal((await MP.reassertMonitorPair(mix, 'mix')).skipped, true)
		assert.deepEqual(mix.sent, [])
		const setup = fs.readFileSync(path.join(ROOT, 'src/config/routing-setup.js'), 'utf8')
		assert.match(setup, /reassertMonitorPair\(self, require\('\.\.\/audio\/mixer-state'\)\.monitorPair\(\)\)/)
	})

	it('the Godot console offers the pair on the PRV master and posts it to monitor-source', () => {
		const strip = fs.readFileSync(path.join(ROOT, 'godot/client/features/audio/audio_strip.gd'), 'utf8')
		const actions = fs.readFileSync(path.join(ROOT, 'godot/client/features/audio/audio_actions.gd'), 'utf8')
		assert.match(strip, /signal monitor_pair_selected\(pair: String\)/)
		assert.match(actions, /\["POST", "\/api\/audio\/monitor-source", \{"pair": pair\}\]/)
	})
})
