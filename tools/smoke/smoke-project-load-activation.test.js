/**
 * WO-277 — loading a project must leave the running system where a restart with that project
 * selected would leave it. Pure logic + stubbed ctx: no live Caspar, no network, no service.
 */
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
	activateLoadedProject,
	adoptSceneDeckFromProject,
	pruneLiveScenesNotInProject,
	channelLayoutSignature,
} = require('../../src/engine/project-activate')
const { buildSceneDeckForApi } = require('../../src/engine/project-scenes-transform')

/** Project A — what the box was running before the switch. */
function projectA() {
	return {
		version: 2,
		name: 'Show A',
		slug: 'show_a',
		savedAt: '2026-07-01T00:00:00.000Z',
		scenes: {
			previewSceneId: 'a1',
			scenes: [
				{ id: 'a1', name: 'A Opener', layers: [{ layerNumber: 10, source: { type: 'media', value: 'a-open' } }] },
				{ id: 'a2', name: 'A Break', layers: [{ layerNumber: 10, source: { type: 'media', value: 'a-break' } }] },
			],
			layerPresets: [{ id: 'lp-a' }],
			lookPresets: [{ id: 'kp-a' }],
		},
	}
}

/** Project B — the one the operator just loaded. Disjoint look ids on purpose. */
function projectB() {
	return {
		version: 2,
		name: 'Show B',
		slug: 'show_b',
		savedAt: '2026-07-19T00:00:00.000Z',
		scenes: {
			previewSceneId: 'b1',
			scenes: [
				{ id: 'b1', name: 'B Opener', layers: [{ layerNumber: 10, source: { type: 'media', value: 'b-open' } }] },
			],
			layerPresets: [{ id: 'lp-b' }],
			lookPresets: [],
		},
	}
}

function stubCtx(overrides = {}) {
	const broadcasts = []
	return {
		config: { casparServer: { screen_count: 1 } },
		persistence: {
			_store: {},
			get(k) {
				return this._store[k]
			},
			set(k, v) {
				this._store[k] = v
			},
		},
		logs: [],
		log(level, msg) {
			this.logs.push(`${level}: ${msg}`)
		},
		_wsBroadcast(type, payload) {
			broadcasts.push({ type, payload })
		},
		broadcasts,
		...overrides,
	}
}

/** In-memory stand-in for state/live-scene-state's persisted per-channel map. */
function stubLiveSceneState(initial) {
	const all = { ...initial }
	return {
		all,
		getAll: () => ({ ...all }),
		clearChannel: async (ch) => {
			delete all[String(ch)]
		},
	}
}

// ---------------------------------------------------------------------------
// 1. The deck mirror is the actual bug: it must move from A to B.
// ---------------------------------------------------------------------------

test('adoptSceneDeckFromProject replaces the previous project deck wholesale', () => {
	const ctx = stubCtx()
	// Boot state: project A staged in the in-memory mirror.
	adoptSceneDeckFromProject(ctx, projectA())
	assert.deepEqual(
		ctx.sceneDeck.looks.map((l) => l.id),
		['a1', 'a2'],
	)
	assert.equal(ctx.sceneDeck.previewSceneId, 'a1')

	// Operator loads project B.
	const info = adoptSceneDeckFromProject(ctx, projectB())
	assert.equal(info.lookCount, 1)
	assert.deepEqual(
		ctx.sceneDeck.looks.map((l) => l.id),
		['b1'],
		'project A looks must not survive the switch',
	)
	assert.deepEqual(
		ctx.sceneDeck.sceneSnapshots.map((s) => s.id),
		['b1'],
	)
	assert.equal(ctx.sceneDeck.previewSceneId, 'b1', "A's previewSceneId is a foreign id in B — must not carry over")
	assert.deepEqual(ctx.sceneDeck.layerPresets, [{ id: 'lp-b' }])
	assert.deepEqual(ctx.sceneDeck.lookPresets, [], "B's empty lookPresets must clear A's")
})

test('adoptSceneDeckFromProject clears the deck for a project with no scenes envelope', () => {
	const ctx = stubCtx()
	adoptSceneDeckFromProject(ctx, projectA())
	const info = adoptSceneDeckFromProject(ctx, { version: 2, name: 'Empty', slug: 'empty' })
	assert.equal(info.lookCount, 0)
	assert.deepEqual(ctx.sceneDeck.looks, [])
	assert.deepEqual(ctx.sceneDeck.sceneSnapshots, [])
	assert.equal(ctx.sceneDeck.previewSceneId, null)
})

test('buildSceneDeckForApi stops serving the old project once the deck is adopted', () => {
	// buildSceneDeckForApi prefers ctx.sceneDeck.sceneSnapshots over the on-disk envelope
	// (project-scenes-transform.js:126) — this is exactly why a stale mirror looked like
	// "loading a project does nothing" from GET /api/state and the Companion bridge.
	const ctx = stubCtx()
	adoptSceneDeckFromProject(ctx, projectA())
	const before = buildSceneDeckForApi(ctx)
	assert.deepEqual(
		before.looks.map((l) => l.id),
		['a1', 'a2'],
	)
	adoptSceneDeckFromProject(ctx, projectB())
	const after = buildSceneDeckForApi(ctx)
	assert.deepEqual(
		after.looks.map((l) => l.id),
		['b1'],
	)
})

// ---------------------------------------------------------------------------
// 2. Live-scene entries pointing at look ids the new project does not have.
// ---------------------------------------------------------------------------

test('pruneLiveScenesNotInProject clears foreign look ids and keeps resolvable ones', async () => {
	const live = stubLiveSceneState({
		1: { sceneId: 'a1', scene: {}, updatedAt: 1 },
		3: { sceneId: 'b1', scene: {}, updatedAt: 2 },
	})
	const cleared = await pruneLiveScenesNotInProject(projectB(), live)
	assert.deepEqual(cleared, ['1'], 'only the channel holding a project-A look is cleared')
	assert.deepEqual(Object.keys(live.all), ['3'])
})

test('pruneLiveScenesNotInProject is a no-op when reloading the same project', async () => {
	const live = stubLiveSceneState({ 1: { sceneId: 'a1', scene: {}, updatedAt: 1 } })
	const cleared = await pruneLiveScenesNotInProject(projectA(), live)
	assert.deepEqual(cleared, [], 'reloading the same project must not black out program')
	assert.deepEqual(Object.keys(live.all), ['1'])
})

// ---------------------------------------------------------------------------
// 3. Restart-required detection (the one thing that genuinely cannot hot-swap).
// ---------------------------------------------------------------------------

test('channelLayoutSignature changes when the Caspar channel layout changes', () => {
	const one = channelLayoutSignature({ casparServer: { screen_count: 1 } })
	const two = channelLayoutSignature({ casparServer: { screen_count: 2 } })
	assert.ok(one, 'signature must be non-empty for a valid config')
	assert.notEqual(one, two)
	assert.equal(one, channelLayoutSignature({ casparServer: { screen_count: 1 } }), 'stable for equal configs')
})

test('activateLoadedProject reports restartRequired when hardwareConfig moves the channel layout', async () => {
	const ctx = stubCtx({
		configManager: {
			_cfg: { casparServer: { screen_count: 1 } },
			get() {
				return this._cfg
			},
			save(next) {
				this._cfg = next
			},
		},
		_liveSceneStateStub: null,
	})
	const project = {
		...projectB(),
		hardwareConfig: {
			version: 2,
			casparServer: { screen_count: 3 },
			// Three mains where the running box has one → programChannels 1 → [1,3,5].
			screenDestinations: {
				destinations: [
					{ id: 'd1', mainScreenIndex: 0 },
					{ id: 'd2', mainScreenIndex: 1 },
					{ id: 'd3', mainScreenIndex: 2 },
				],
			},
		},
	}
	const res = await activateLoadedProject(ctx, project, {
		applyHardware: true,
		restage: false,
		_liveSceneState: stubLiveSceneState({}),
	})
	assert.equal(res.ok, true)
	assert.equal(res.restartRequired, true)
	assert.match(res.restartReason, /restart CasparCG/i)
})

test('activateLoadedProject reports no restart when only looks changed', async () => {
	const ctx = stubCtx()
	const res = await activateLoadedProject(ctx, projectB(), {
		applyHardware: false,
		restage: false,
		_liveSceneState: stubLiveSceneState({}),
	})
	assert.equal(res.restartRequired, false)
	assert.equal(res.restartReason, null)
})

// ---------------------------------------------------------------------------
// 4. End-to-end activation on a stub ctx: adoption, mirror, prune, broadcast order.
// ---------------------------------------------------------------------------

test('activateLoadedProject adopts deck, refreshes the web_project mirror, prunes and broadcasts', async () => {
	const ctx = stubCtx()
	adoptSceneDeckFromProject(ctx, projectA())
	ctx.persistence.set('web_project', projectA())
	const live = stubLiveSceneState({ 1: { sceneId: 'a1', scene: {}, updatedAt: 1 } })

	const res = await activateLoadedProject(ctx, projectB(), {
		applyHardware: false,
		restage: false,
		_liveSceneState: live,
	})

	assert.equal(res.ok, true)
	assert.equal(res.slug, 'show_b')
	assert.equal(res.lookCount, 1)
	assert.equal(res.previewSceneId, 'b1')
	assert.deepEqual(res.clearedLiveChannels, ['1'])

	assert.deepEqual(
		ctx.sceneDeck.looks.map((l) => l.id),
		['b1'],
	)
	assert.equal(
		ctx.persistence.get('web_project').name,
		'Show B',
		'stale web_project mirror would let loadFullProject resurrect project A',
	)
	assert.deepEqual(Object.keys(live.all), [], 'the project-A live entry is gone')

	const activated = ctx.broadcasts.find((b) => b.type === 'change' && b.payload?.path === 'project.activated')
	assert.ok(activated, `expected a project.activated broadcast, got ${JSON.stringify(ctx.broadcasts.map((b) => b.payload?.path || b.type))}`)
	assert.equal(activated.payload.value.slug, 'show_b')
	assert.equal(activated.payload.value.restartRequired, false)
	assert.deepEqual(activated.payload.value.clearedLiveChannels, ['1'])
})

test('activateLoadedProject only broadcasts project_sync when asked', async () => {
	const quiet = stubCtx()
	await activateLoadedProject(quiet, projectB(), { restage: false, _liveSceneState: stubLiveSceneState({}) })
	assert.equal(
		quiet.broadcasts.some((b) => b.type === 'project_sync'),
		false,
		'the loading client imports the project itself — do not echo a "remote sync" at it by default',
	)

	const loud = stubCtx()
	await activateLoadedProject(loud, projectB(), {
		restage: false,
		broadcastProject: true,
		_liveSceneState: stubLiveSceneState({}),
	})
	const { flushProjectSyncBroadcast } = require('../../src/api/routes-data-project-sync')
	flushProjectSyncBroadcast()
	assert.equal(
		loud.broadcasts.some((b) => b.type === 'project_sync'),
		true,
	)
})

test('activateLoadedProject never throws on a bare ctx with no broadcast/log wiring', async () => {
	const res = await activateLoadedProject({ config: {} }, projectB(), {
		restage: false,
		_liveSceneState: stubLiveSceneState({}),
	})
	assert.equal(res.ok, true)
	assert.equal(res.lookCount, 1)
})

test('activateLoadedProject rejects a missing project without throwing', async () => {
	const res = await activateLoadedProject(stubCtx(), null, { restage: false })
	assert.equal(res.ok, false)
	assert.equal(res.slug, '')
})
