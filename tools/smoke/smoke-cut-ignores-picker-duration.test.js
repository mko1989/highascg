'use strict'

/**
 * Live e2e 29.10 (frontex_big, Look 3 set to CUT in the Godot "Look transition" dialog): the dialog stored
 * {type:'CUT', duration:25} (the web picker does the same), and the PGM take sent `MIXER 1-110 OPACITY 0 25 linear`:
 * the outgoing look faded out over 25 frames on top of the new one instead of cutting.
 * normalizeTransition (src/engine/scene-transition.js) now drops the duration of a CUT, like scene-take-pgm-only.js
 * and timeline-take.js already did.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeTransition } = require('../../src/engine/scene-transition')
const { handleSceneTake } = require('../../src/api/routes-scene-take')
const liveSceneState = require('../../src/state/live-scene-state')

test('normalizeTransition: a CUT has no duration, whatever the picker stored', () => {
	assert.equal(normalizeTransition({ type: 'CUT', duration: 25, tween: 'linear' }).duration, 0)
	assert.equal(normalizeTransition({ type: 'cut', duration: 12 }).duration, 0)
	assert.equal(normalizeTransition({ type: 'MIX', duration: 25 }).duration, 25, 'a MIX keeps its duration')
	assert.equal(normalizeTransition({ type: 'MIX', duration: 25 }, true).duration, 0, 'forceCut still wins')
})

function recordingAmcp() {
	const lines = []
	const rec = async (l) => {
		lines.push(l)
		await new Promise((r) => setImmediate(r))
		return { ok: true, data: '202 OK' }
	}
	const base = {
		_context: { config: { take_two_phase_batch: true, amcp_batch: false } },
		async batchSendChunked(ls) {
			for (const l of ls.map(String).filter(Boolean)) await rec(l)
			return { ok: true }
		},
		mixerCommit: (ch) => rec(`MIXER ${ch} COMMIT`),
		mixerClear: (ch, l) => rec(`MIXER ${ch}-${l} CLEAR`),
		loadbg: (ch, l, clip) => rec(`LOADBG ${ch}-${l} ${clip}`),
		_send: (line) => rec(line),
	}
	base.batchSend = base.batchSendChunked
	const amcp = new Proxy(base, {
		get(o, k) {
			if (k in o) return o[k]
			if (typeof k !== 'string' || k === 'then') return undefined
			return (...a) => rec(`${k.toUpperCase()} ${a.filter((x) => typeof x !== 'object').join(' ')}`.trim())
		},
	})
	return { amcp, lines }
}

test('PGM take of a look whose transition is {CUT, 25}: no opacity tween on PGM', async () => {
	const { amcp, lines } = recordingAmcp()
	const lay = (v) => ({ layerNumber: 10, source: { type: 'media', value: v } })
	const OLD = { id: 'old', defaultTransition: { type: 'MIX', duration: 25, tween: 'linear' }, layers: [lay('old.mov')] }
	const NEW = { id: 'new', defaultTransition: { type: 'CUT', duration: 25, tween: 'linear' }, layers: [lay('new.mov')] }
	for (const ch of [1, 2]) liveSceneState.clearChannel?.(ch)
	await liveSceneState.setChannel(1, { sceneId: OLD.id, scene: OLD })
	const ctx = { amcp, config: { screen_count: 1 }, log: () => {}, _playbackMatrix: {}, programLayerBankByChannel: {} }
	const res = await handleSceneTake(JSON.stringify({ channel: 1, incomingScene: NEW }), ctx)
	assert.equal(res.status, 200, res.body)
	assert.ok(lines.some((l) => /^PLAY 1-/.test(l)), `PGM PLAY sent: ${JSON.stringify(lines)}`)
	const tweens = lines.filter((l) => /^MIXER 1-\d+ OPACITY [01] [1-9]\d*/.test(l))
	assert.deepEqual(tweens, [], `no fade on a CUT take: ${JSON.stringify(lines)}`)
})
