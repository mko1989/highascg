'use strict'

/**
 * WO-800 web display: the Audio view's layer strips get a thin lane with the layer's own level, read from
 * GET /api/osc/audio-layers (polled at 5 Hz while the view is visible). Data → lane mapping is driven through the
 * real client modules (client/lib/audio-layer-levels.js + the shared meter loop) with a payload recorded on the box.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')
const silent = (n) => Array.from({ length: n }, () => ({ dBFS: -120, peak: -120 }))
const lv = (...dbs) => [...dbs.map((d) => ({ dBFS: d, peak: d })), ...silent(16 - dbs.length)]

/** Shape + values from `GET /api/osc/audio-layers` on the box 29.10 (ch 1 in bank B: look layers 11/12 → 111/112). */
const PAYLOAD = {
	channels: {
		1: {
			111: { nbChannels: 16, levels: lv(-24.59324779527232, -27.71235709865458), updatedAt: 1 },
			112: { nbChannels: 16, levels: silent(16), updatedAt: 1 },
		},
		2: {
			10: { nbChannels: 16, levels: lv(-18.06392057322093, -18.06392057322093), updatedAt: 1 },
			// a clipping layer, and a level beyond nbChannels that must be ignored
			13: { nbChannels: 2, levels: [{ dBFS: -0.5 }, { dBFS: -3 }, { dBFS: 0 }], updatedAt: 1 },
		},
	},
	updatedAt: 1,
}

describe('WO-800 web per-layer level lane', () => {
	it('maps a strip to its Caspar channel/layer (bank B look layers +100, no lane for masters / inputs)', async () => {
		const { layerLevelTarget } = await import('../../client/lib/audio-layer-levels.js')
		const look = { lookLayer: true }
		assert.deepEqual(layerLevelTarget('pgm:1:layer:11', look, { 1: 'b' }), [1, 111])
		assert.deepEqual(layerLevelTarget('pgm:1:layer:11', look, { 1: 'a' }), [1, 11])
		assert.deepEqual(layerLevelTarget('pgm:1:layer:11', look, undefined), [1, 11])
		// timeline (210+), audio-only look (200), live-audio slot rows: fixed layers, never shifted
		assert.deepEqual(layerLevelTarget('pgm:1:layer:210', { lookLayer: false }, { 1: 'b' }), [1, 210])
		assert.deepEqual(layerLevelTarget('pgm:1:layer:200', { lookLayer: false }, { 1: 'b' }), [1, 200])
		assert.deepEqual(layerLevelTarget('pgm:1:layer:20', { lookLayer: false }, { 1: 'b' }), [1, 20])
		assert.equal(layerLevelTarget('pgm:1', undefined, {}), null)
		assert.equal(layerLevelTarget('input:5', undefined, {}), null)
		assert.equal(layerLevelTarget('pgm:1:bus:0', undefined, {}), null)
	})

	it('reads the loudest audio channel over nbChannels; absent layer = not present', async () => {
		const { readLayerLevel, layerLevelPeak, layerLevelEntry, LAYER_LEVELS_FRESH_MS } =
			await import('../../client/lib/audio-layer-levels.js')
		assert.equal(LAYER_LEVELS_FRESH_MS, 500)
		assert.equal(layerLevelEntry(PAYLOAD, 1, 111), PAYLOAD.channels[1][111])
		assert.equal(layerLevelEntry(PAYLOAD, 1, 11), null)
		const look = { lookLayer: true }
		assert.deepEqual(readLayerLevel(PAYLOAD, 'pgm:1:layer:11', look, { 1: 'b' }), {
			present: true,
			level: -24.59324779527232,
		})
		assert.deepEqual(readLayerLevel(PAYLOAD, 'pgm:1:layer:12', look, { 1: 'b' }), { present: true, level: -99 })
		// bank A would read layer 11, which Caspar does not send → no lane
		assert.deepEqual(readLayerLevel(PAYLOAD, 'pgm:1:layer:11', look, { 1: 'a' }), { present: false, level: -99 })
		assert.equal(layerLevelPeak(PAYLOAD.channels[2][13]), -0.5)
		assert.equal(layerLevelPeak({ levels: 'x' }), -99)
		assert.deepEqual(readLayerLevel(null, 'pgm:2:layer:10', {}, {}), { present: false, level: -99 })
		// the node keeps a layer Caspar stopped sending for osc.staleTimeoutMs (5 s): older than 500 ms = absent
		const at = (age) => ({
			channels: { 2: { 10: { ...PAYLOAD.channels[2][10], updatedAt: 10000 - age } } },
			updatedAt: 10000,
		})
		assert.equal(readLayerLevel(at(480), 'pgm:2:layer:10', {}, {}).present, true)
		assert.equal(readLayerLevel(at(520), 'pgm:2:layer:10', {}, {}).present, false)
	})

	it('drives the lane through the shared meter loop: same scale and colours as the bar, hidden without audio', async () => {
		const { createAudioMeterLoop } = await import('../../client/lib/audio-mixer-meter-loop.js')
		const lane = () => ({ hidden: true, firstElementChild: { style: {} } })
		const bar = () => ({ style: { removeProperty() {} }, dataset: {} })
		const keys = ['pgm:1:layer:11', 'pgm:1:layer:12', 'pgm:1:layer:13', 'pgm:2:layer:10', 'pgm:2:layer:13']
		const meterFills = new Map(keys.map((k) => [k, bar()]))
		const laneFills = new Map(keys.map((k) => [k, lane()]))
		const meterLayerMeta = new Map(keys.map((k) => [k, { lookLayer: true }]))
		const meterSmooth = new Map()
		const stateStore = { getState: () => ({ scene: { programLayerBankByChannel: { 1: 'b', 2: 'a' } } }) }
		let data = PAYLOAD
		const loop = createAudioMeterLoop({
			meterFills,
			meterLayerMeta,
			meterSmooth,
			stateStore,
			peakClipColor: '#ef4444',
			peakNormalColor: '#22c55e',
			laneFills,
			layerLevels: () => data,
		})
		loop.start() // runs one tick synchronously
		loop.stop()
		const fill = (k) => laneFills.get(k).firstElementChild
		// −24.59 dBFS → (60 − 24.59) / 60 = 59.0 %, green
		assert.equal(laneFills.get('pgm:1:layer:11').hidden, false)
		assert.equal(fill('pgm:1:layer:11').style.height, '59.0%')
		assert.equal(fill('pgm:1:layer:11').style.background, '#22c55e')
		// present but silent: lane shown (dark), empty
		assert.equal(laneFills.get('pgm:1:layer:12').hidden, false)
		assert.equal(fill('pgm:1:layer:12').style.height, '0.0%')
		// not in the response: no lane at all
		assert.equal(laneFills.get('pgm:1:layer:13').hidden, true)
		assert.equal(fill('pgm:1:layer:13').style.height, undefined)
		// bank A channel, layer 10 at −18.06 → 69.9 %
		assert.equal(fill('pgm:2:layer:10').style.height, '69.9%')
		// above −1 dBFS: clip colour
		assert.equal(fill('pgm:2:layer:13').style.background, '#ef4444')
		// ballistics: instant rise, 0.45 fall per tick (meter bar's own constants)
		const s0 = meterSmooth.get('pgm:2:layer:10:lane')
		data = { channels: { 2: { 10: { nbChannels: 2, levels: lv(-120, -120) } } } }
		loop.start()
		loop.stop()
		assert.ok(Math.abs(meterSmooth.get('pgm:2:layer:10:lane') - s0 * 0.55) < 1e-9)
		// the layer leaves the response → lane hidden and its smoothing dropped
		assert.equal(laneFills.get('pgm:1:layer:11').hidden, true)
		assert.equal(meterSmooth.has('pgm:1:layer:11:lane'), false)
	})

	it('polls one request at a time, only while wanted; a failed read clears the data', async () => {
		const { createLayerLevelPoller, LAYER_LEVELS_PATH, LAYER_LEVELS_POLL_MS } =
			await import('../../client/lib/audio-layer-levels.js')
		assert.equal(LAYER_LEVELS_PATH, '/api/osc/audio-layers')
		assert.equal(LAYER_LEVELS_POLL_MS, 200)
		const calls = []
		let wanted = false
		let fail = false
		const p = createLayerLevelPoller({
			get: async (u) => {
				calls.push(u)
				if (fail) throw new Error('HTTP 500')
				return PAYLOAD
			},
			wanted: () => wanted,
		})
		p.start()
		await new Promise((r) => setImmediate(r))
		assert.equal(calls.length, 0, 'no request while the view is hidden / has no lanes')
		p.stop()
		wanted = true
		p.start()
		await new Promise((r) => setImmediate(r))
		assert.deepEqual(calls, ['/api/osc/audio-layers'])
		assert.equal(p.data(), PAYLOAD)
		p.stop()
		assert.equal(p.data(), null, 'stop drops the last reading')
		fail = true
		p.start()
		await new Promise((r) => setImmediate(r))
		p.stop()
		assert.equal(p.data(), null)
	})

	it('the Audio view wires the lane into its layer strips (source guards)', () => {
		const groups = read('client/components/audio-mixer-console-input-groups.js')
		assert.ok(groups.includes('<div class="audio-mixer-view__meter-lane" aria-hidden="true" hidden><div></div></div>'))
		assert.ok(groups.includes("laneFills?.set(r.key, strip.querySelector('.audio-mixer-view__meter-lane'))"))
		const view = read('client/components/audio-mixer-view-console.js')
		assert.ok(view.includes('wanted: () => isViewActive() && laneFills.size > 0'), 'poll only while visible with lanes')
		assert.ok(view.includes('layerLevels: layerPoller.data'))
		const rows = read('client/lib/audio-mixer-rows.js')
		assert.ok(rows.includes('lookLayer: Array.isArray(row?.audioScreens)'), 'look rows flagged for the bank B shift')
		const css = read('client/styles/07c3-audio-mixer-view-channel-strip.css')
		const rule = css.slice(css.indexOf('.audio-mixer-view__meter-lane {'))
		assert.match(rule, /position: absolute;[\s\S]*width: 3px;/, 'lane sits out of the flex flow (strip width unchanged)')
	})
})
