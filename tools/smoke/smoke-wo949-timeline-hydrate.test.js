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
