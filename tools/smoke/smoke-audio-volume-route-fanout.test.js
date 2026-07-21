'use strict'

/**
 * Owner bug, live-verified on the box: a DeckLink input plays inside a look on PGM 2 via
 * route://5-4 (ch3 layer 10). Muting its mixer strip sent MIXER 5-4 VOLUME 0 — the HOST channel —
 * but a layer route taps the source layer BEFORE the host mixer applies volume, so PGM 2 output
 * was unaffected. /api/audio/volume must fan the gain out to every live look layer consuming the
 * exact route.
 */

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { setChannel, clearChannel } = require('../../src/state/live-scene-state')
const routesAudio = require('../../src/api/routes-audio')

function mockCtx() {
	const sent = []
	return {
		sent,
		ctx: {
			config: {},
			amcp: {
				mixer: {
					mixerVolume: async (ch, layer, volume) => {
						sent.push({ ch, layer, volume })
						return { ok: true }
					},
					mixerMastervolume: async () => ({ ok: true }),
				},
			},
		},
	}
}

beforeEach(() => {
	for (const ch of [2, 3, 5]) clearChannel(ch)
})

test('muting the host layer also mutes every look layer playing its exact layer route', async () => {
	// The owner's live rig: PGM2 (ch3) layer 10 plays route://5-4; PGM1 (ch2) plays plain media.
	setChannel(3, { scene: { layers: [{ layerNumber: 10, source: { type: 'route', value: 'route://5-4' } }] } })
	setChannel(2, { scene: { layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }] } })

	const { ctx, sent } = mockCtx()
	const res = await routesAudio.handlePost('/api/audio/volume', JSON.stringify({ channel: 5, layer: 4, volume: 0 }), ctx)
	assert.equal(res.status, 200)

	assert.deepEqual(
		sent,
		[
			{ ch: 5, layer: 4, volume: 0 }, // the strip's own target (harmless, kept)
			{ ch: 3, layer: 10, volume: 0 }, // the layer the audio ACTUALLY flows through
		],
		'the consuming look layer on PGM2 must receive the same volume',
	)
})

test('a bare channel route is NOT fanned out — the host command already reaches it', async () => {
	/* route://5 (no layer) taps the source channel's post-mixer MIX, so the host-layer volume
	 * already applies; fanning out would apply the gain twice. */
	setChannel(3, { scene: { layers: [{ layerNumber: 10, source: { type: 'route', value: 'route://5' } }] } })

	const { ctx, sent } = mockCtx()
	await routesAudio.handlePost('/api/audio/volume', JSON.stringify({ channel: 5, layer: 4, volume: 0.5 }), ctx)
	assert.deepEqual(sent, [{ ch: 5, layer: 4, volume: 0.5 }], 'only the host target')
})

test('unrelated routes and the host channel itself are untouched', async () => {
	setChannel(3, { scene: { layers: [{ layerNumber: 11, source: { type: 'route', value: 'route://6-1' } }] } })
	setChannel(5, { scene: { layers: [{ layerNumber: 4, source: { type: 'route', value: 'route://5-4' } }] } })

	const { ctx, sent } = mockCtx()
	await routesAudio.handlePost('/api/audio/volume', JSON.stringify({ channel: 5, layer: 4, volume: 0.7 }), ctx)
	assert.deepEqual(sent, [{ ch: 5, layer: 4, volume: 0.7 }])
})
