'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { runSceneTakePgmOnly, normalizeTransitionForPgmOnly } = require('../../src/engine/scene-take-pgm-only')

function mockAmcp() {
	const log = []
	const capture = (line) => {
		log.push({ cmd: 'RAW', line })
		return Promise.resolve({ ok: true })
	}
	return {
		log,
		_send: capture,
		async loadbg(ch, layer, clip, opts) {
			log.push({ cmd: 'LOADBG', ch, layer, clip, opts })
		},
		async play(ch, layer, clip, opts) {
			log.push({ cmd: 'PLAY', ch, layer, clip, opts })
		},
		async raw(line) {
			return capture(line)
		},
		async batchSendChunked(lines) {
			for (const line of lines) {
				log.push({ cmd: 'BATCH', line })
				await capture(line)
			}
		},
		async mixerCommit(ch) {
			log.push({ cmd: 'COMMIT', ch })
		},
	}
}

function minimalSelf() {
	return {
		config: { screen_count: 1, screen_1_mode: '1920x1080p25' },
		programLayerBankByChannel: {},
		log: () => {},
	}
}

test('normalizeTransitionForPgmOnly keeps +Animate and upgrades plain MIX to MIX + ANIMATE', () => {
	assert.deepEqual(normalizeTransitionForPgmOnly({ type: 'MIX', duration: 25, tween: 'linear' }, false), {
		type: 'MIX + ANIMATE',
		duration: 25,
		tween: 'linear',
	})
	assert.deepEqual(normalizeTransitionForPgmOnly({ type: 'MIX+ ANIMATE', duration: 25, tween: 'linear' }, false), {
		type: 'MIX+ ANIMATE',
		duration: 25,
		tween: 'linear',
	})
	assert.deepEqual(normalizeTransitionForPgmOnly({ type: 'CUT', duration: 0, tween: 'linear' }, false), {
		type: 'CUT',
		duration: 0,
		tween: 'linear',
	})
})

test('pgm-only take resolves project-scoped basename before LOADBG', async () => {
	const amcp = mockAmcp()
	const self = {
		...minimalSelf(),
		config: {
			...minimalSelf().config,
			projectScopedMedia: { enabled: true },
			local_media_path: require('path').join(__dirname, '../../media'),
		},
		persistence: { get: (k) => (k === 'web_project_active_slug' ? 'tetst' : null) },
	}
	const incoming = {
		id: 'look_bumper',
		defaultTransition: { type: 'CUT', duration: 0, tween: 'linear' },
		layers: [{ layerNumber: 10, source: { type: 'media', value: '02_BUMPER.mp4' }, loop: true }],
	}
	await runSceneTakePgmOnly(amcp, {
		self,
		channel: 1,
		currentScene: null,
		incomingScene: incoming,
		forceCut: true,
		framerate: 25,
	})
	const load = amcp.log.find((e) => e.cmd === 'LOADBG')
	assert.equal(load?.clip, 'PROJECTS/TETST/02_BUMPER')
})

test('pgm-only animate take: LOADBG → FILL → COMMIT → PLAY on layer 10 only; no upfront STOP', async () => {
	const amcp = mockAmcp()
	const self = minimalSelf()
	const incoming = {
		id: 'look_a',
		name: 'Look A',
		defaultTransition: { type: 'MIX+ ANIMATE', duration: 25, tween: 'linear' },
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'testowe/forest_jester-dv.mov' },
				loop: true,
			},
		],
	}
	await runSceneTakePgmOnly(amcp, {
		self,
		channel: 1,
		currentScene: null,
		incomingScene: incoming,
		forceCut: false,
		framerate: 25,
	})

	const load = amcp.log.find((e) => e.cmd === 'LOADBG')
	const fillBatch = amcp.log.find((e) => e.cmd === 'BATCH' && /^MIXER 1-10 FILL .+ 25 linear DEFER$/.test(e.line))
	const playLine = amcp.log.find((e) => e.cmd === 'RAW' && e.line === 'PLAY 1-10')
	const commitLines = amcp.log.filter((e) => e.cmd === 'RAW' && e.line === 'MIXER 1 COMMIT')

	assert.equal(load.layer, 10)
	assert.equal(load.opts.transition, 'MIX', 'LOADBG carries MIX for +Animate')
	assert.equal(load.opts.duration, 25)
	assert.ok(fillBatch, 'DEFER mixer prep goes through BEGIN…COMMIT batch')
	assert.ok(playLine, 'PLAY promotes LOADBG — no clip on PLAY')
	assert.ok(
		amcp.log.some((e) => e.cmd === 'BATCH' && e.line === 'MIXER 1-10 OPACITY 1 25 linear DEFER'),
		'OPACITY uses transition duration on +Animate',
	)
	assert.ok(
		amcp.log.some((e) => e.cmd === 'BATCH' && e.line === 'MIXER 1-10 KEYER 0'),
		'KEYER is immediate (Caspar has no KEYER duration)',
	)
	assert.ok(!amcp.log.some((e) => e.cmd === 'RAW' && /^STOP /.test(e.line)), 'no STOP before transition completes')
	const playIdx = amcp.log.findIndex((e) => e.cmd === 'RAW' && e.line === 'PLAY 1-10')
	const commitIdxs = amcp.log.map((e, i) => (e.cmd === 'RAW' && e.line === 'MIXER 1 COMMIT' ? i : -1)).filter((i) => i >= 0)
	assert.equal(commitIdxs.length, 2, 'COMMIT sandwich: before PLAY and after PLAY')
	assert.ok(commitIdxs[0] < playIdx, 'first COMMIT before PLAY')
	assert.ok(commitIdxs[1] > playIdx, 'second COMMIT after PLAY')
})

test('pgm-only teardown clears outgoing layer after animate window', async () => {
	const amcp = mockAmcp()
	const self = minimalSelf()
	const current = {
		id: 'old',
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'old.mov' } }],
	}
	const incoming = {
		id: 'new',
		defaultTransition: { type: 'MIX+ ANIMATE', duration: 2, tween: 'linear' },
		layers: [{ layerNumber: 20, source: { type: 'media', value: 'new.mov' } }],
	}
	await runSceneTakePgmOnly(amcp, {
		self,
		channel: 1,
		currentScene: current,
		incomingScene: incoming,
		forceCut: false,
		framerate: 25,
	})

	const loadIdx = amcp.log.findIndex((e) => e.cmd === 'LOADBG')
	const playIdx = amcp.log.findIndex((e) => e.cmd === 'RAW' && e.line === 'PLAY 1-20')
	const stopIdx = amcp.log.findIndex((e) => e.cmd === 'RAW' && e.line === 'STOP 1-10')
	const clearIdx = amcp.log.findIndex((e) => e.cmd === 'RAW' && e.line === 'MIXER 1-10 CLEAR')

	assert.ok(loadIdx >= 0 && playIdx > loadIdx, 'LOADBG before PLAY')
	assert.ok(stopIdx >= 0 && clearIdx >= 0, 'teardown STOP/CLEAR present')
	assert.ok(stopIdx > playIdx, 'STOP only after PLAY')
	assert.ok(!amcp.log.some((e) => e.cmd === 'RAW' && /1-110/.test(e.line)), 'never uses bank-B physical layers')
})

test('pgm-only same-layer content swap does not STOP/CLEAR that layer in teardown', async () => {
	const amcp = mockAmcp()
	const self = minimalSelf()
	const current = {
		id: 'old',
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'old.mov' } }],
	}
	const incoming = {
		id: 'new',
		defaultTransition: { type: 'MIX+ ANIMATE', duration: 2, tween: 'linear' },
		layers: [{ layerNumber: 10, source: { type: 'media', value: 'new.mov' } }],
	}
	await runSceneTakePgmOnly(amcp, {
		self,
		channel: 1,
		currentScene: current,
		incomingScene: incoming,
		forceCut: false,
		framerate: 25,
	})

	const stopIdx = amcp.log.findIndex((e) => e.cmd === 'RAW' && e.line === 'STOP 1-10')
	assert.equal(stopIdx, -1, 'same-layer swap must not STOP the layer being taken to')
})

test('pgm-only legacy MIX take emits LOADBG MIX and FILL tail', async () => {
	const amcp = mockAmcp()
	const self = minimalSelf()
	await runSceneTakePgmOnly(amcp, {
		self,
		channel: 1,
		currentScene: null,
		incomingScene: {
			id: 'mix',
			defaultTransition: { type: 'MIX', duration: 25, tween: 'linear' },
			layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }],
		},
		forceCut: false,
		framerate: 25,
	})

	const load = amcp.log.find((e) => e.cmd === 'LOADBG')
	const fillBatch = amcp.log.find((e) => e.cmd === 'BATCH' && /^MIXER 1-10 FILL .+ 25 linear DEFER$/.test(e.line))
	assert.equal(load.opts.transition, 'MIX')
	assert.equal(load.opts.duration, 25)
	assert.ok(amcp.log.some((e) => e.cmd === 'RAW' && e.line === 'PLAY 1-10'), 'PLAY promotes LOADBG')
	assert.ok(fillBatch, 'FILL uses animated tail with DEFER in batch')
})

test('pgm-only CUT take uses FILL tail 0 and no LOADBG transition', async () => {
	const amcp = mockAmcp()
	const self = minimalSelf()
	await runSceneTakePgmOnly(amcp, {
		self,
		channel: 1,
		currentScene: null,
		incomingScene: {
			id: 'cut',
			defaultTransition: { type: 'CUT', duration: 0, tween: 'linear' },
			layers: [{ layerNumber: 10, source: { type: 'media', value: 'clip.mov' } }],
		},
		forceCut: false,
		framerate: 25,
	})

	const load = amcp.log.find((e) => e.cmd === 'LOADBG')
	const fillLine = amcp.log.find((e) => e.cmd === 'RAW' && /^MIXER 1-10 FILL .+ 0$/.test(e.line))
	assert.equal(load.opts.transition, undefined)
	assert.ok(fillLine, 'FILL uses immediate tail 0')
})
