'use strict'

/**
 * WO-604 slice 2 — the web console reads the server's mixer state instead of browser localStorage, so the web and
 * the Godot client show one mixer: audio-mixer-state.js is a cache filled from GET /api/audio/mixer + the
 * `audioMixer` broadcast (audio-mixer-server-sync.js), strip writes carry their `key`, mute is POST /api/audio/mute,
 * solo posts `keys`. Look-owned strips (sceneId) and the AFV policy writes send no key.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const STRIPS = [
	'client/components/audio-mixer-console-masters.js',
	'client/components/audio-mixer-console-live-inputs.js',
	'client/components/audio-mixer-console-input-groups.js',
	'client/components/audio-mixer-panel-input-layers.js',
	'client/components/audio-mixer-panel-live-inputs.js',
	'client/components/audio-mixer-panel-masters.js',
]

describe('WO-604 slice 2 — web mixer cache', () => {
	it('starts at unity / unmuted / no solo, then mirrors the server snapshot', async () => {
		const m = await import('../../client/lib/audio-mixer-state.js')
		assert.equal(m.getMasterVolume('pgm:1'), 1)
		assert.equal(m.getMuted('input:4'), false)
		m.ingestServerMixer({ gains: { 'pgm:1': 0.5, 'input:4': 1.4 }, muted: { 'input:4': true }, solos: ['prv:2'] })
		assert.equal(m.getMasterVolume('pgm:1'), 0.5)
		assert.equal(m.getMasterVolume('input:4'), 1.4, 'a +dB gain from another client is shown, not clamped to unity')
		assert.equal(m.getMuted('input:4'), true)
		assert.equal(m.isSoloed('prv:2'), true)
		assert.deepEqual(m.toggleSolo('pgm:1', true), ['prv:2', 'pgm:1'], 'optimistic local toggle')
		m.ingestServerMixer({ gains: {}, muted: {}, solos: [] })
		assert.deepEqual([m.getMasterVolume('pgm:1'), m.getMuted('input:4'), m.getSoloedLayers()], [1, false, []])
	})

	it('faderGain: the stored gain while the fader still shows it (exact unity on reset / unmute), else the position', async () => {
		const m = await import('../../client/lib/audio-mixer-state.js')
		const { linearGainToFaderPercent, faderPercentToLinearGain } = await import('../../client/lib/audio-volume-scale.js')
		m.ingestServerMixer({ gains: { 'input:4': 1 } })
		const unity = linearGainToFaderPercent(1)
		assert.notEqual(faderPercentToLinearGain(unity), 1, 'premise: 0 dB falls between fader steps')
		assert.equal(m.faderGain('input:4', unity), 1)
		assert.equal(m.faderGain('input:4', String(unity)), 1, 'DOM values are strings')
		assert.equal(m.faderGain('input:4', unity - 10), faderPercentToLinearGain(unity - 10), 'moved: the position wins')
		assert.equal(m.faderGain('pgm:9', unity), 1, 'an unstored strip at the unity mark is unity')
		for (const f of STRIPS) assert.doesNotMatch(read(f), /faderPercentToLinearGain\((fader|faderEl)\.value\)/, f)
		m.ingestServerMixer({})
	})

	it('no browser storage is left in the mixer state', () => {
		const src = read('client/lib/audio-mixer-state.js')
		assert.doesNotMatch(src, /localStorage\.(get|set)Item/)
	})

	it('the app binds the server sync (GET on every connect + the audioMixer broadcast)', () => {
		assert.match(read('client/app.js'), /bindAudioMixerServer\(\{ ws, stateStore \}\)/)
		const sync = read('client/lib/audio-mixer-server-sync.js')
		assert.match(sync, /ws\.on\('state', \(\) => void pull\(\)\)/)
		assert.match(sync, /stateStore\.on\('audioMixer', \(value\) => applyServerMixer\(value\)\)/)
		assert.match(sync, /f\.matches\(':active'\)/, 'a fader under the pointer keeps its own value')
	})
})

describe('WO-604 slice 2 — web writes reach the server store', () => {
	it('every strip fader write carries its key unless a look owns the strip; the AFV policy writes carry none', () => {
		let keyed = 0
		for (const f of STRIPS) {
			const src = read(f)
			keyed += (src.match(/key: r\.sceneId \? undefined : r\.key/g) || []).length
		}
		assert.equal(keyed, 16, 'fader + mute writes across the six strip renderers')
		const live = read('client/components/audio-mixer-panel-live-inputs.js')
		assert.match(live, /postAudioVolume\(\{ channel: r\.ch, layer: r\.layer, linearGain: effective \}\)/)
		assert.match(live, /postAudioVolume\(\{ channel: r\.ch, layer: r\.layer, linearGain: embedded \}\)/)
	})

	it('mute goes through POST /api/audio/mute; solo posts the keys', () => {
		for (const f of STRIPS) {
			const src = read(f)
			assert.doesNotMatch(src, /linearGain: nextMuted \? 0 : currentVol/, `${f}: no client-side mute-to-zero`)
			assert.doesNotMatch(src, /soloKeyToTarget/, `${f}: the server maps solo keys`)
		}
		const api = read('client/lib/audio-mixer-volume-api.js')
		assert.match(api, /api\.post\('\/api\/audio\/mute', \{/)
		assert.match(api, /\.\.\.\(typeof key === 'string' && key \? \{ key \} : \{\}\)/)
	})
})

describe('WO-604 slice 2 — double-click reset stays at 0 dB', () => {
	it('the fader reset gesture stops the dblclick before the page-wide range reset re-posts the render-time value', () => {
		const bind = read('client/lib/audio-mixer-fader-bind.js')
		assert.match(bind, /addEventListener\('dblclick', \(e\) => \{\n\t\te\.preventDefault\(\)\n\t\te\.stopPropagation\(\)\n\t\tonReset\(\)/)
		assert.match(read('client/lib/app-range-dblclick.js'), /document\.addEventListener\('dblclick'/, 'the page-wide handler listens on document (bubble)')
	})
})
