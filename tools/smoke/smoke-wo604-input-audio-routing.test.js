'use strict'

/**
 * WO-604 slice 3 — live-input audio routing composed on the server (src/audio/input-audio-routing.js): the Ch route
 * buttons, the audio-send policy, AUTO MIX and START's route restore are endpoints, and a DeckLink / v4l2 strip's
 * gain applies the policy (looks get the embedded gain, routed copies get the gain) instead of re-opening the look
 * copy while the matrix carries the audio.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const persistence = require('../../src/utils/persistence')
const mixerState = require('../../src/audio/mixer-state')
const liveScenes = require('../../src/state/live-scene-state')
const routing = require('../../src/audio/input-audio-routing')
const routesAudio = require('../../src/api/routes-audio')
const routesMixer = require('../../src/api/routes-audio-mixer')

const ROOT = path.join(__dirname, '../..')

/** 2 screens (program channels 1 and 3) + DeckLink 1 on its dedicated channel 5 (route://5-1, dest layer 321). */
function rig(cs = {}) {
	const raw = []
	const vol = []
	const saved = []
	const broadcasts = []
	const ctx = {
		config: { casparServer: { screen_count: 2, decklink_input_count: 1, decklink_input_1_device: 4, ...cs } },
		log: () => {},
		amcp: {
			raw: async (c) => raw.push(c),
			mixer: { mixerVolume: async (ch, layer, v) => vol.push(`${ch}-${layer}=${v}`) },
		},
		configManager: { get: () => ({ keep: 1 }), save: (c) => saved.push(c) },
		_wsBroadcast: (type, data) => broadcasts.push([type, data]),
	}
	return { ctx, raw, vol, saved, broadcasts }
}

/** A look on PGM 1 whose layer 10 plays the DeckLink route (the fanout consumer). */
function lookOnPgm() {
	return liveScenes.setChannel(1, { sceneId: 'l', scene: { id: 'l', layers: [{ layerNumber: 10, source: { type: 'route', value: 'route://5-1' } }] } })
}

beforeEach(async () => {
	persistence.set(mixerState.STATE_KEY, null)
	await liveScenes.clearChannel(1)
})

describe('WO-604 slice 3 routingSnapshot / embeddedGain (pure)', () => {
	it('lists the routable inputs with their strip key, route, dest layer, policy and targets', () => {
		const s = routing.routingSnapshot(rig({ decklink_input_1_audio_targets: [3] }).ctx.config)
		assert.deepEqual(s.programChannels, [1, 3])
		assert.equal(s.autoMix, true)
		assert.deepEqual(s.inputs.map((i) => [i.key, i.route, i.destLayer, i.send, i.targets]), [['input:5', 'route://5-1', 321, 'afv', [3]]])
	})

	it('the embedded copy plays only under AFV + auto mix with no lit target, unmuted', () => {
		const i = { kind: 'decklink', slot: 1 }
		const cs = (o) => ({ casparServer: o })
		assert.equal(routing.embeddedGain(cs({}), i, 0.5, false), 0.5)
		assert.equal(routing.embeddedGain(cs({}), i, 0.5, true), 0)
		assert.equal(routing.embeddedGain(cs({ decklink_input_1_audio_targets: [1] }), i, 0.5, false), 0)
		assert.equal(routing.embeddedGain(cs({ decklink_input_1_audio_send: 'always' }), i, 0.5, false), 0)
		assert.equal(routing.embeddedGain(cs({ audio_auto_mix: false }), i, 0.5, false), 0)
	})
})

describe('WO-604 slice 3 POST /api/audio/inputs/route — the Ch button', () => {
	it('on: STOP / CLEAR / PLAY / OPACITY 0 on 3-321, persists the target, silences the embedded copy, routes get the gain', async () => {
		const r = rig()
		mixerState.setGain(r.ctx, 'input:5', 0.5)
		const res = await routesMixer.handleInputsPost('/api/audio/inputs/route', JSON.stringify({ kind: 'decklink', slot: 1, channel: 3, on: true }), r.ctx)
		assert.equal(res.status, 200, res.body)
		assert.deepEqual(r.raw, ['STOP 3-321', 'MIXER 3-321 CLEAR', 'PLAY 3-321 route://5-1', 'MIXER 3-321 OPACITY 0'])
		assert.deepEqual(r.ctx.config.casparServer.decklink_input_1_audio_targets, [3])
		assert.deepEqual(r.saved.at(-1).casparServer.decklink_input_1_audio_targets, [3])
		assert.equal(r.saved.at(-1).keep, 1, 'the rest of the config is saved as it was')
		assert.deepEqual(r.vol, ['5-1=0.5', '3-321=0.5'])
		assert.equal(JSON.parse(res.body).embedded, 0)
		const b = r.broadcasts.find(([, d]) => d.path === 'audioInputRouting')
		assert.deepEqual(b[1].value.inputs[0].targets, [3])
	})

	it('off: STOP + CLEAR, the key leaves the config (no [] residue), the embedded copy follows video again', async () => {
		const r = rig({ decklink_input_1_audio_targets: [3] })
		const res = await routesMixer.handleInputsPost('/api/audio/inputs/route', JSON.stringify({ kind: 'decklink', slot: 1, channel: 3, on: false }), r.ctx)
		assert.equal(res.status, 200, res.body)
		assert.deepEqual(r.raw, ['STOP 3-321', 'MIXER 3-321 CLEAR'])
		assert.equal('decklink_input_1_audio_targets' in r.ctx.config.casparServer, false)
		assert.equal(JSON.parse(res.body).embedded, 1)
	})

	it('refuses a non-program channel, an unknown input, a bad body; a failed PLAY persists nothing', async () => {
		const r = rig()
		const post = (b) => routesMixer.handleInputsPost('/api/audio/inputs/route', JSON.stringify(b), r.ctx)
		assert.equal((await post({ kind: 'decklink', slot: 1, channel: 2, on: true })).status, 400)
		assert.equal((await post({ kind: 'decklink', slot: 9, channel: 1, on: true })).status, 404)
		assert.equal((await post({ kind: 'live_audio', slot: 1, channel: 1, on: true })).status, 400)
		assert.equal((await post({ kind: 'decklink', slot: 1, channel: 1 })).status, 400)
		r.ctx.amcp.raw = async () => {
			throw new Error('404 PLAY FAILED')
		}
		assert.equal((await post({ kind: 'decklink', slot: 1, channel: 1, on: true })).status, 502)
		assert.equal(r.saved.length, 0)
	})
})

describe('WO-604 slice 3 strip gain applies the policy', () => {
	it('a fader write on a routed input keeps the look copy silent and drives the routed copy', async () => {
		const r = rig({ decklink_input_1_audio_targets: [3] })
		await lookOnPgm()
		const res = await routesAudio.handlePost('/api/audio/volume', JSON.stringify({ channel: 5, layer: 1, volume: 0.7, key: 'input:5' }), r.ctx)
		assert.equal(res.status, 200, res.body)
		const body = JSON.parse(res.body)
		assert.equal(body.embedded, 0)
		assert.deepEqual(r.vol, ['5-1=0.7', '1-10=0', '3-321=0.7'], 'input, look copy silenced, routed copy')
		assert.deepEqual(body.fanout, [{ channel: 1, layer: 10 }])
		assert.equal(mixerState.snapshot().gains['input:5'], 0.7)
	})

	it('mute zeroes the input, the look copy and the routed copy; unmute restores the stored gain', async () => {
		const r = rig({ decklink_input_1_audio_targets: [3] })
		mixerState.setGain(r.ctx, 'input:5', 0.6)
		await routesMixer.handleMutePost(JSON.stringify({ channel: 5, layer: 1, muted: true, key: 'input:5' }), r.ctx)
		assert.deepEqual(r.vol, ['5-1=0', '3-321=0'])
		r.vol.length = 0
		await routesMixer.handleMutePost(JSON.stringify({ channel: 5, layer: 1, muted: false, key: 'input:5' }), r.ctx)
		assert.deepEqual(r.vol, ['5-1=0.6', '3-321=0.6'])
	})

	it('a strip with no routing stays on the plain path (no behaviour change for an unrouted box)', async () => {
		const r = rig()
		const res = await routesAudio.handlePost('/api/audio/volume', JSON.stringify({ channel: 5, layer: 1, volume: 0.4, key: 'input:5' }), r.ctx)
		assert.equal(JSON.parse(res.body).embedded, 0.4)
		assert.deepEqual(r.vol, ['5-1=0.4'])
	})
})

describe('WO-604 slice 3 send policy, auto mix, START restore', () => {
	it('send: always persists, silences the embedded copy now; afv removes the key', async () => {
		const r = rig()
		const res = await routesMixer.handleInputsPost('/api/audio/inputs/send', JSON.stringify({ kind: 'decklink', slot: 1, send: 'always' }), r.ctx)
		assert.equal(res.status, 200, res.body)
		assert.equal(r.ctx.config.casparServer.decklink_input_1_audio_send, 'always')
		assert.equal(JSON.parse(res.body).embedded, 0)
		await routesMixer.handleInputsPost('/api/audio/inputs/send', JSON.stringify({ kind: 'decklink', slot: 1, send: 'afv' }), r.ctx)
		assert.equal('decklink_input_1_audio_send' in r.ctx.config.casparServer, false)
		assert.equal((await routesMixer.handleInputsPost('/api/audio/inputs/send', JSON.stringify({ kind: 'decklink', slot: 1, send: 'loud' }), r.ctx)).status, 400)
	})

	it('auto mix: off is stored as false, on removes the key (default); no AMCP (applies from the next take)', async () => {
		const r = rig()
		await routesMixer.handleInputsPost('/api/audio/auto-mix', JSON.stringify({ on: false }), r.ctx)
		assert.equal(r.ctx.config.casparServer.audio_auto_mix, false)
		await routesMixer.handleInputsPost('/api/audio/auto-mix', JSON.stringify({ on: true }), r.ctx)
		assert.equal('audio_auto_mix' in r.ctx.config.casparServer, false)
		assert.deepEqual([r.raw, r.vol], [[], []])
	})

	it('START restores the persisted routes on the server; a never input restores none', async () => {
		const r = rig({ decklink_input_1_audio_targets: [1, 3] })
		assert.equal(await routing.restoreInputRoutes(r.ctx, 'decklink', 1), 2)
		assert.deepEqual(r.raw.filter((c) => c.startsWith('PLAY')), ['PLAY 1-321 route://5-1', 'PLAY 3-321 route://5-1'])
		const n = rig({ decklink_input_1_audio_targets: [1], decklink_input_1_audio_send: 'never' })
		assert.equal(await routing.restoreInputRoutes(n.ctx, 'decklink', 1), 0)
		assert.match(fs.readFileSync(path.join(ROOT, 'src/api/routes-audio.js'), 'utf8'), /payload\.routesRestored = await inputRouting\.restoreInputRoutes\(ctx, res\.kind, res\.slot\)/)
	})
})
