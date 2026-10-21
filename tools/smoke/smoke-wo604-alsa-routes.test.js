'use strict'

/**
 * WO-604 slice 5 — ALSA live-audio slots' Ch buttons on the server. The store is the WO-571
 * `live_audio_input_N_pgm_channels` key the boot routing replays (routing-setup-live-inputs.js), on the same PGM layer
 * (live_audio_pgm_layer + slot − 1). The browser's localStorage copy is retired for the console.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const persistence = require('../../src/utils/persistence')
const mixerState = require('../../src/audio/mixer-state')
const routing = require('../../src/audio/input-audio-routing')
const routesMixer = require('../../src/api/routes-audio-mixer')
const { setupLiveAudioPgmRoutes } = require('../../src/config/routing-setup-live-inputs')
const { listLiveAudioPgmProtectedLayers } = require('../../src/config/live-audio-input')

const ROOT = path.join(__dirname, '../..')

/** 2 screens (PGM 1 and 3) + ALSA slots 1–2 on dedicated channels 5 / 6 (route://5, route://6). */
function rig(cs = {}) {
	const raw = []
	const vol = []
	const saved = []
	const ctx = {
		config: { casparServer: { screen_count: 2, live_audio_input_count: 2, live_audio_input_1_device: 'alsa://hw:1', live_audio_input_2_device: 'alsa://hw:2', ...cs } },
		log: () => {},
		amcp: { raw: async (c) => raw.push(c), mixer: { mixerVolume: async (ch, layer, v) => vol.push(`${ch}-${layer}=${v}`) } },
		configManager: { get: () => ({}), save: (c) => saved.push(c) },
		_wsBroadcast: () => {},
	}
	return { ctx, raw, vol, saved }
}
const post = (r, p, b) => routesMixer.handleInputsPost(p, JSON.stringify(b), r.ctx)

beforeEach(() => persistence.set(mixerState.STATE_KEY, null))

describe('WO-604 slice 5 ALSA routing snapshot', () => {
	it('lists ALSA slots with the boot routing layer and the WO-571 targets (legacy fallback = every PGM)', () => {
		const s = routing.routingSnapshot(rig({ live_audio_input_2_pgm_channels: '3' }).ctx.config)
		assert.deepEqual(s.inputs.map((i) => [i.kind, i.key, i.route, i.destLayer, i.send, i.targets]), [
			['live_audio', 'input:5', 'route://5', 2, 'always', [1, 3]],
			['live_audio', 'input:6', 'route://6', 3, 'always', [3]],
		])
	})
	it('a layer past the audio tracks has no dest layer', () => {
		assert.equal(routing.routingSnapshot(rig({ live_audio_pgm_layer: 9 }).ctx.config).inputs[1].destLayer, null)
	})
})

describe('WO-604 slice 5 ALSA Ch buttons', () => {
	it('on: route on the WO-571 layer, the key is written as a list', async () => {
		const r = rig({ live_audio_input_1_pgm_channels: '' })
		const res = await post(r, '/api/audio/inputs/route', { kind: 'live_audio', slot: 1, channel: 3, on: true })
		assert.equal(res.status, 200, res.body)
		assert.ok(r.raw.includes('PLAY 3-2 route://5'), r.raw.join(' | '))
		assert.equal(r.ctx.config.casparServer.live_audio_input_1_pgm_channels, '3')
		assert.deepEqual(JSON.parse(res.body).targets, [3])
	})
	it('off on a legacy (key-less) slot: STOP + CLEAR, and the key is written so the boot no longer blanket-routes', async () => {
		const r = rig()
		const res = await post(r, '/api/audio/inputs/route', { kind: 'live_audio', slot: 1, channel: 1, on: false })
		assert.equal(res.status, 200, res.body)
		assert.deepEqual(r.raw, ['STOP 1-2', 'MIXER 1-2 CLEAR'])
		assert.equal(r.ctx.config.casparServer.live_audio_input_1_pgm_channels, '3')
		const off = await post(r, '/api/audio/inputs/route', { kind: 'live_audio', slot: 1, channel: 3, on: false })
		assert.equal(JSON.parse(off.body).targets.length, 0)
		assert.equal(r.ctx.config.casparServer.live_audio_input_1_pgm_channels, '', 'empty stays authoritative')
	})
	it('no free audio track → 409; no send policy for ALSA', async () => {
		const r = rig({ live_audio_pgm_layer: 9 })
		assert.equal((await post(r, '/api/audio/inputs/route', { kind: 'live_audio', slot: 2, channel: 1, on: true })).status, 409)
		assert.equal((await post(r, '/api/audio/inputs/send', { kind: 'live_audio', slot: 1, send: 'never' })).status, 400)
		assert.deepEqual(r.raw, [])
	})
	it('the strip gain never rides the whole-channel ALSA routes (they are after the host mixer)', async () => {
		const r = rig()
		const input = routing.inputForKey(r.ctx.config, 'input:5')
		const res = await routing.applyInputStrip(r.ctx, input, { gain: 0.5, muted: false })
		assert.equal(res.embedded, 0.5)
		assert.deepEqual(r.vol, ['5-10=0.5'])
	})
	it('START restores the slot routes on the server', async () => {
		const r = rig({ live_audio_input_1_pgm_channels: '1,3' })
		assert.equal(await routing.restoreInputRoutes(r.ctx, 'live_audio', 1), 2)
		assert.deepEqual(r.raw.filter((c) => c.startsWith('PLAY')), ['PLAY 1-2 route://5', 'PLAY 3-2 route://5'])
	})
	it('the web console posts ALSA Ch buttons and START leaves the replay to the server', () => {
		const api = fs.readFileSync(path.join(ROOT, 'client/lib/input-audio-routing-api.js'), 'utf8')
		assert.match(api, /kind === 'live_audio'/)
	})
})

describe('WO-604 one ALSA route path: boot, Save & Apply and the Ch buttons agree', () => {
	/** Bridge off + slot 1 without a device = a gap: slot 2 keeps ITS layer (base + 2 − 1), not the first free one. */
	const gap = { live_audio_capture_bridge: false, live_audio_input_1_device: '', live_audio_input_2_pgm_channels: '1' }
	it('a gap moves no layer: boot, protected layers and the routing store all use slot 2 → layer 3', async () => {
		const r = rig(gap)
		await setupLiveAudioPgmRoutes(r.ctx)
		assert.deepEqual(r.raw, ['STOP 1-3', 'MIXER 1-3 CLEAR', 'PLAY 1-3 route://6', 'MIXER 1-3 OPACITY 0'], 'audio-only by default')
		assert.deepEqual(listLiveAudioPgmProtectedLayers(r.ctx.config).map((p) => p.layer), [3])
		assert.equal(routing.routingSnapshot(r.ctx.config).inputs.find((i) => i.slot === 2).destLayer, 3)
	})
	it('auto-route off: boot plays nothing, Save & Apply (force) still routes the saved selection', async () => {
		const r = rig({ ...gap, live_audio_pgm_always_on: false, live_audio_pgm_audio_only: false })
		await setupLiveAudioPgmRoutes(r.ctx)
		assert.deepEqual(r.raw, [])
		await setupLiveAudioPgmRoutes(r.ctx, { force: true })
		assert.deepEqual(r.raw, ['STOP 1-3', 'MIXER 1-3 CLEAR', 'PLAY 1-3 route://6'])
	})
	it('the web modal leaves PGM routing to the server (no client PLAY loop)', () => {
		const modal = fs.readFileSync(path.join(ROOT, 'client/components/live-audio-mixer-modal.js'), 'utf8')
		const lib = fs.readFileSync(path.join(ROOT, 'client/lib/live-audio-routing.js'), 'utf8')
		const srv = fs.readFileSync(path.join(ROOT, 'src/api/routes-audio.js'), 'utf8')
		assert.match(modal, /applyLiveAudioCapture\(\{ routes: true \}\)/)
		assert.doesNotMatch(modal + lib, /applyPgmRoutesForSlot/)
		assert.match(srv, /setupLiveAudioPgmRoutes\(ctx, \{ force: parseBody\(body\)\?\.routes === true \}\)/)
	})
})
