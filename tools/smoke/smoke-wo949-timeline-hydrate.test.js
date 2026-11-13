'use strict'

/**
 * WO-949 — a timeline the engine does not hold is loaded from the stored project when it has to play (a look take, a
 * Play). Box 05.11: after a node restart the engine was empty (clients push a timeline only when it is edited or shown),
 * so taking a look that contains a timeline cut PGM to black: "[Timeline] play(tmw3a9eous12): timeline not on server".
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const psl = require('../../src/engine/project-scenes-load')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

const STORED = {
	id: 'tl_stored',
	name: 'ZZ ramp',
	duration: 10000,
	fps: 25,
	layers: [
		{
			id: 'L1',
			name: 'Layer 1',
			clips: [{ id: 'c1', startTime: 0, duration: 10000, source: { type: 'media', value: 'zz_tl_ramp.mp4' } }],
		},
	],
}

function withProject(project, fn) {
	const orig = psl.loadFullProject
	psl.loadFullProject = () => project
	try {
		return fn()
	} finally {
		psl.loadFullProject = orig
	}
}

function engine() {
	const logs = []
	const eng = new TimelineEngine({ log: (lvl, msg) => logs.push(`${lvl} ${msg}`) })
	return { eng, logs }
}

test('WO-949: play() of a timeline only in the stored project loads it and plays', () => {
	const { eng, logs } = engine()
	assert.equal(eng.get('tl_stored') ?? null, null, 'empty engine (a server just restarted)')
	withProject({ timelines: { timelines: [STORED] } }, () => eng.play('tl_stored', 0))
	try {
		assert.equal(eng.get('tl_stored')?.name, 'ZZ ramp', 'loaded from the project')
		assert.equal(eng.get('tl_stored').layers[0].clips[0].source.value, 'zz_tl_ramp.mp4')
		assert.equal(eng.getPlayback('tl_stored')?.playing, true, 'and playing')
		assert.ok(
			logs.some((l) => l.includes('loaded from the stored project')),
			logs.join(' | ')
		)
		assert.ok(!logs.some((l) => l.includes('not on server')))
	} finally {
		eng.stop?.('tl_stored', { skipAmcp: true })
		if (eng._ticker) clearInterval(eng._ticker)
	}
})

test('WO-949: playForTake hydrates too; an id the project does not have is still refused', async () => {
	const { eng, logs } = engine()
	await withProject({ timelines: { timelines: [STORED] } }, () => eng.playForTake('tl_stored', 0, { takeFade: true }))
	if (eng._ticker) clearInterval(eng._ticker)
	assert.equal(eng.getPlayback('tl_stored')?.playing, true)
	const { eng: e2, logs: l2 } = engine()
	withProject({ timelines: { timelines: [STORED] } }, () => e2.play('nope', 0))
	assert.equal(e2.get('nope') ?? null, null)
	assert.ok(
		l2.some((l) => l.includes('play(nope): timeline not on server')),
		'unknown id: the old refusal'
	)
	withProject(null, () => e2.play('tl_stored', 0)) // no project at all
	assert.equal(e2.get('tl_stored') ?? null, null)
	void logs
})

test('WO-1068: a look taking a timeline the engine does not hold yet routes it to PROGRAM, not to its stored routing', async () => {
	const { startSceneTimelineLayer } = require('../../src/engine/timeline-take')
	const sent = []
	const amcp = {
		raw: async (l) => (sent.push(l), { ok: true }),
		stop: async (ch, L) => (sent.push(`STOP ${ch}-${L}`), { ok: true }),
		call: async () => ({ ok: true }),
		mixerFill: async (ch, L) => (sent.push(`MIXER ${ch}-${L} FILL`), { ok: true }),
		mixerOpacity: async (ch, L, v) => (sent.push(`MIXER ${ch}-${L} OPACITY ${v}`), { ok: true }),
		mixerVolume: async () => ({ ok: true }),
		mixerCommit: async () => ({ ok: true }),
		batchSendChunked: async (lines) => (sent.push(...lines), { ok: true }),
	}
	// 2 screens: PGM 1 = ch 1, PRV 1 = ch 2 (the default map)
	const self = { amcp, config: { screen_count: 1 }, log: () => {} }
	const eng = new TimelineEngine(self)
	self.timelineEngine = eng
	const stored = { ...STORED, sendTo: { preview: true, program: false, screenIdx: 0 } } // saved from the Timeline tab
	await withProject({ timelines: { timelines: [stored] } }, () =>
		startSceneTimelineLayer(self, amcp, 1, { layerNumber: 10, source: { type: 'timeline', value: 'tl_stored' } }, { fadeDur: 25, screenIdx: 0, startAtCurrentPosition: false })
	)
	await new Promise((r) => setTimeout(r, 30))
	if (eng._ticker) clearInterval(eng._ticker)
	try {
		const st = eng._sendToFor('tl_stored')
		assert.equal(st.program, true, 'the take claims program')
		assert.equal(st.preview, false, 'and not preview (WO-559)')
		const plays = sent.filter((l) => /^(PLAY|LOAD) /.test(l))
		assert.ok(plays.length > 0 && plays.every((l) => /^(PLAY|LOAD) 1-/.test(l)), `played on the program channel only: ${plays.join(' | ')}`)
		assert.ok(sent.some((l) => /^MIXER 1-\d+ OPACITY 0 0$/.test(l)), 'the fade-in preset reached the timeline layer (it needs the loaded timeline)')
	} finally {
		eng.stop?.('tl_stored', { skipAmcp: true })
	}
})
