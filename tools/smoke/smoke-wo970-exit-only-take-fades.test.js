'use strict'

/**
 * WO-970 — a layer leaving PGM cut instead of fading when every OTHER layer of the take was unchanged.
 *
 * Owner (06.11): "when switching looks from one that has image on a layer back to one that doesnt have the
 * image, the image doesnt fade out like it should but rather cuts out … not only image, video clips too."
 *
 * Look B = look A minus one layer: the shared layer is visually equal → `buildTakeJobs` skips it, so the take has
 * NO job. The pipeline's outer gate only entered with a job / merge extra / incoming timeline, so the crossfade
 * batch (where the exit fade-out lives) never ran, `fadeClockStart` stayed null, and the teardown sent
 * `CG/STOP/MIXER CLEAR` on the leaving layer at once — a cut. Fixed by also entering on exit media.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { runSceneTakeLbg } = require('../../src/engine/scene-take-lbg')

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
					return { ok: true, data: '0' } // opacity queries: already settled
				}
			},
		},
	)
	return { amcp, lines }
}

const T = { type: 'MIX', duration: 5, tween: 'linear' }
const bg = { layerNumber: 10, source: { type: 'media', value: 'bg.mov' }, loop: true }
const clip = { layerNumber: 11, source: { type: 'media', value: 'clip.mp4' } }
const still = { layerNumber: 11, source: { type: 'media', value: 'still.png' } }
const look = (id, layers) => ({ id, layers, defaultTransition: T })

async function take(cur, inc, extra = {}) {
	const { amcp, lines } = recorder()
	const self = { config: { screen_count: 1 }, log: () => {}, programLayerBankByChannel: { 1: 'b' }, _playbackMatrix: {} }
	await runSceneTakeLbg(amcp, { self, channel: 1, currentScene: cur, incomingScene: inc, framerate: 50, ...extra })
	return lines
}

describe('WO-970: exit-only take fades the leaving layer', () => {
	for (const [name, leaving] of [
		['video clip', clip],
		['image (still)', still],
	]) {
		it(`${name}: OPACITY 0 over the take's duration BEFORE the STOP, then MIXER CLEAR resets it`, async () => {
			const lines = await take(look('A', [bg, leaving]), look('B', [bg]))
			const fade = lines.indexOf('MIXER 1-111 OPACITY 0 5 linear')
			const stop = lines.indexOf('STOP 1-111')
			assert.ok(fade >= 0, `fade-out sent: ${JSON.stringify(lines)}`)
			assert.ok(stop > fade, `STOP only after the fade: ${JSON.stringify(lines)}`)
			assert.ok(lines.indexOf('MIXER 1-111 CLEAR') > stop, 'opacity reset after the clear (layer reusable)')
			assert.ok(!lines.some((l) => /^(STOP|MIXER) 1-110\b/.test(l)), `shared layer untouched: ${JSON.stringify(lines)}`)
		})
	}

	it('CUT stays a cut (no ramp)', async () => {
		const lines = await take(look('A', [bg, clip]), look('B', [bg]), { forceCut: true })
		assert.ok(!lines.some((l) => /OPACITY 0 \d/.test(l) && /1-111/.test(l)), JSON.stringify(lines))
		assert.ok(lines.includes('STOP 1-111'), JSON.stringify(lines))
	})

	it('reverse (B → A, layer enters) still fades the incoming layer in', async () => {
		const lines = await take(look('B', [bg]), look('A', [bg, still]))
		assert.ok(lines.some((l) => /^LOADBG 1-11 /.test(l)), JSON.stringify(lines))
		assert.ok(lines.includes('MIXER 1-11 OPACITY 1 5 linear'), JSON.stringify(lines))
	})

	it('a layer that changes content still crossfades (LOADBG on the other bank + one ramp)', async () => {
		const lines = await take(look('A', [bg, clip]), look('C', [bg, still]))
		assert.ok(lines.some((l) => /^LOADBG 1-11 /.test(l)), JSON.stringify(lines))
		assert.ok(lines.some((l) => /^MIXER 1-11(1)? OPACITY [01] 5 linear$/.test(l)), JSON.stringify(lines))
	})
})
