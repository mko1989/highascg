'use strict'

/**
 * WO-1126 — a still both looks show the same way stays on air through the take, whatever its layer number.
 *
 * Owner 19.11: "when moving from look FastTrack to TLO BAZWE there are png logos on top layers that do a fade out and
 * fade in where they shouldnt be affected at all by the transition". The logos sat on L12 / L13 in one look and on
 * L11 / L12 in the other; the take matched layers by number, reloaded both and faded the leftover one out.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')
const { keptLayerMoveLines } = require('../../src/engine/scene-take-carry')

function recorder() {
	const lines = []
	const amcp = new Proxy(
		{ _context: {} },
		{
			get(t, k) {
				if (k in t) return t[k]
				if (k === 'then') return undefined
				return async (...a) => {
					if (k === 'batchSendChunked' || k === 'batchSend') lines.push(...a[0])
					else if (k === 'mixerCommit') lines.push(`MIXER ${a[0]} COMMIT`)
					else if (k === '_send') lines.push(String(a[0]))
					else lines.push(`${String(k)} ${a.join(' ')}`)
					return { ok: true, data: '0' }
				}
			},
		},
	)
	return { amcp, lines }
}

const T = { type: 'MIX', duration: 5, tween: 'linear' }
const still = (layerNumber, value, x) => ({ layerNumber, source: { type: 'media', value }, fill: { x, y: 0, scaleX: 0.2, scaleY: 0.2 }, effects: [] })
const bg = { layerNumber: 10, source: { type: 'media', value: 'bg.mp4' }, loop: true, startBehaviour: 'relativeToPrevious' }
const list = { layerNumber: 11, source: { type: 'media', value: 'ft/1.png' }, sourceMode: 'list', playlistAdvance: 'manual', playlist: [{ type: 'media', value: 'ft/1.png' }] }
const fastTrack = { id: 'FT', defaultTransition: T, layers: [bg, list, still(12, 'logo.png', 0.3), still(13, 'nazwa.png', 0.4), still(14, 'qr.png', 0.9)] }
const tlo = { id: 'TLO', defaultTransition: T, layers: [bg, still(11, 'logo.png', 0.3), still(12, 'nazwa.png', 0.4)] }

async function take(cur, inc, bank, extra = {}) {
	const { amcp, lines } = recorder()
	const self = { config: { screen_count: 1 }, log: () => {}, programLayerBankByChannel: { 1: bank }, _playbackMatrix: {} }
	await runSceneTakeLbg(amcp, { self, channel: 1, currentScene: cur, incomingScene: inc, framerate: 50, skipLayerVisualEquality: true, keepRelativeLayers: true, ...extra })
	return { lines, self }
}

const touches = (lines, phys) => lines.filter((l) => new RegExp(`^(LOADBG|PLAY|STOP|MIXER) 1-${phys}\\b`).test(l) && !/ CLEAR$/.test(l))

describe('WO-1126: stills that only change layer number stay on air', () => {
	for (const [bank, o] of [['a', 0], ['b', 100]]) {
		it(`FastTrack → TŁO BAZWE on bank ${bank}: no job (no flip), logos SWAP 12→11 then 13→12 after the teardown`, async () => {
			const { lines, self } = await take(fastTrack, tlo, bank)
			assert.ok(!lines.some((l) => /^LOADBG /.test(l)), `nothing reloads: ${JSON.stringify(lines)}`)
			assert.deepEqual(touches(lines, 12 + o), [], 'logo: no fade, no stop')
			assert.deepEqual(touches(lines, 13 + o), [], 'nazwa: no fade, no stop')
			for (const L of [11 + o, 14 + o]) assert.ok(lines.includes(`MIXER 1-${L} OPACITY 0 5 linear`), `leaving layer ${L} fades`)
			const s1 = lines.indexOf(`SWAP 1-${12 + o} 1-${11 + o} TRANSFORMS`)
			const s2 = lines.indexOf(`SWAP 1-${13 + o} 1-${12 + o} TRANSFORMS`)
			assert.ok(s1 > lines.indexOf(`STOP 1-${11 + o}`), `first SWAP after the list layer is cleared: ${JSON.stringify(lines)}`)
			assert.ok(s2 > s1, 'chain in order')
			assert.ok(lines.includes(`MIXER 1-${13 + o} CLEAR`), 'the layer left empty is reset')
			assert.ok(lines.lastIndexOf(`MIXER 1-${12 + o} CLEAR`) < s1, 'a layer that received a still is not reset after it')
			assert.equal(self.programLayerBankByChannel[1], bank, 'bank pointer unchanged')
		})
	}

	it('TŁO BAZWE → FastTrack from bank a (up): list loads on 111, logos SWAP to 112 / 113 inside the PLAY batch', async () => {
		const { lines, self } = await take(tlo, fastTrack, 'a')
		const loads = lines.filter((l) => /^LOADBG /.test(l)).map((l) => l.split(' ')[1])
		assert.deepEqual(loads.sort(), ['1-111', '1-114'], JSON.stringify(lines))
		const play = lines.findIndex((l) => /^PLAY 1-111\b/.test(l))
		const s1 = lines.indexOf('SWAP 1-11 1-112 TRANSFORMS')
		const s2 = lines.indexOf('SWAP 1-12 1-113 TRANSFORMS')
		assert.ok(s1 >= 0 && s2 >= 0 && s1 < play && s2 < play, `SWAPs ride the PLAY batch: ${JSON.stringify(lines)}`)
		assert.deepEqual(touches(lines.slice(0, s1), 11), [], 'logo untouched before it moves')
		assert.ok(!lines.some((l) => /^MIXER 1-1(1|2|12|13) OPACITY 0 5/.test(l)), `no fade-out on a logo's layer: ${JSON.stringify(lines)}`)
		assert.ok(!lines.some((l) => /^STOP 1-1(1|2|12|13)\b/.test(l)), 'never stopped')
		assert.ok(lines.includes('MIXER 1-111 OPACITY 1 5 linear'), 'the list layer fades in as an entering layer')
		assert.equal(self.programLayerBankByChannel[1], 'b')
	})

	it('TŁO BAZWE → FastTrack from bank b (down): logos stay on 111 / 112 through the fade, SWAP to 12 / 13 after', async () => {
		const { lines, self } = await take(tlo, fastTrack, 'b')
		const play = lines.findIndex((l) => /^PLAY 1-11\b/.test(l))
		const s1 = lines.indexOf('SWAP 1-111 1-12 TRANSFORMS')
		const s2 = lines.indexOf('SWAP 1-112 1-13 TRANSFORMS')
		assert.ok(play >= 0 && s1 > play && s2 > play, `SWAPs after the take: ${JSON.stringify(lines)}`)
		assert.deepEqual(touches(lines, 111), [], 'logo: no fade, no stop')
		assert.deepEqual(touches(lines, 112), [], 'nazwa: no fade, no stop')
		assert.ok(lines.includes('MIXER 1-11 OPACITY 1 5 linear'), 'the list layer fades in under them')
		assert.equal(self.programLayerBankByChannel[1], 'a')
	})

	it('a still whose fill differs is a different picture: reloaded as before', async () => {
		const moved = { ...tlo, layers: [bg, still(11, 'logo.png', 0.5), still(12, 'nazwa.png', 0.4)] }
		const { lines } = await take(fastTrack, moved, 'a')
		assert.ok(lines.some((l) => /^LOADBG 1-111 /.test(l)), JSON.stringify(lines))
		assert.ok(lines.includes('SWAP 1-13 1-112 TRANSFORMS'), 'the unchanged one is still carried')
	})

	it('re-take of the same look reloads its stills (a replaced file shows)', async () => {
		const { lines } = await take(tlo, tlo, 'a')
		assert.deepEqual(lines.filter((l) => /^LOADBG /.test(l)).map((l) => l.split(' ')[1]).sort(), ['1-111', '1-112'])
	})

	it('+ Animate and video layers are not carried', async () => {
		const anim = { ...tlo, defaultTransition: { type: 'MIX + Animate', duration: 5, tween: 'linear' } }
		const a = await take(fastTrack, anim, 'a')
		assert.ok(!a.lines.some((l) => /^SWAP /.test(l)) && a.lines.some((l) => /^LOADBG 1-11 /.test(l)), JSON.stringify(a.lines))
		const clip = (n) => ({ layerNumber: n, source: { type: 'media', value: 'clip.mp4' } })
		const v = await take({ id: 'A', defaultTransition: T, layers: [clip(12)] }, { id: 'B', defaultTransition: T, layers: [clip(11)] }, 'a')
		assert.ok(v.lines.some((l) => /^LOADBG 1-111 /.test(l)) && !v.lines.some((l) => /^SWAP /.test(l)), JSON.stringify(v.lines))
	})

	it('two stills trading places need one SWAP', () => {
		const sk = (layerNumber, now, stay) => ({ layerNumber, physicalLayerNow: now, stayPhys: stay, carried: true, incomingLayer: {} })
		const r = keptLayerMoveLines({ channel: 1, skipped: [sk(11, 12, 11), sk(12, 11, 12)], flips: false, phys: (n) => n, inactiveBank: 'b' })
		assert.deepEqual(r.swapLines, ['SWAP 1-12 1-11 TRANSFORMS'])
		assert.deepEqual(r.clearLines, [])
	})
})
