'use strict'

/**
 * WO-1013 — after Devices ▸ Apply & restart (Caspar restarts, node stays up) put back what was on the screens:
 *  - the connect-time reconcile no longer clears a persisted live look just because the restarted Caspar is EMPTY
 *    (different content still clears; the periodic reconcile is unchanged);
 *  - restore-on-screens re-takes the look on an empty program channel on a reconnect (cut, no PGM/PRV exchange),
 *    clears it on the first connect (pre-WO-1013 boot behaviour), leaves occupied channels to the reconcile;
 *  - the test card is re-painted when node still has it on (operator card via applyCard, boot splash on its own
 *    channels), the WO-492 "layer 999 known clear" cache is dropped on every connect;
 *  - caspar-info-ready runs routing → program looks → preview re-stage → test card (card last, on top).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const restore = require('../../src/engine/restore-on-screens')
const reconcile = require('../../src/state/live-scene-reconcile')
const liveSceneState = require('../../src/state/live-scene-state')

const xml = (layers) =>
	`<?xml version="1.0"?><channel><format>3072x1024</format><stage><layer>${layers}</layer></stage></channel>`
const fileLayer = (n, name, producer = 'ffmpeg') =>
	`<layer_${n}><foreground><file><name>${name}</name></file><producer>${producer}</producer></foreground></layer_${n}>`
const htmlLayer = (n) =>
	`<layer_${n}><foreground><file><path>file:///t/led_grid_test.html</path></file><producer>html</producer></foreground></layer_${n}>`
/** What a freshly restarted Caspar shows on PGM once routing + the card are up: an audio bus and layer 999, no look. */
const EMPTY_LOOKS = xml(`${fileLayer(1, 'route://9', 'route')}${htmlLayer(999)}`)
const OTHER_LOOK = xml(fileLayer(10, 'other.mp4'))

const LOOK = { id: 'look-1', name: 'Opener', layers: [{ layerNumber: 10, source: { type: 'file', value: 'opener.mp4' } }] }
const TIMELINE_LOOK = { id: 'look-tl', name: 'TL', layers: [{ layerNumber: 10, source: { type: 'timeline', value: 'tl-1' } }] }

function fakeLive(entries) {
	const all = { ...entries }
	const calls = { cleared: [], broadcasts: 0 }
	return {
		calls,
		getAll: () => ({ ...all }),
		clearChannel: async (ch) => {
			calls.cleared.push(Number(ch))
			delete all[String(ch)]
		},
		broadcastSceneLive: () => {
			calls.broadcasts++
		},
	}
}

function setup({ xmlByCh, live, reconnect = true, takeStatus = 200, infoThrows = false }) {
	const takes = []
	const borders = []
	const logs = []
	const ctx = {
		config: {},
		log: (level, msg) => logs.push(`${level} ${msg}`),
		amcp: {
			isConnected: true,
			info: async (ch) => {
				if (infoThrows) throw new Error('INFO failed')
				return { data: xmlByCh[ch] }
			},
		},
	}
	const liveState = fakeLive(live)
	const deps = {
		getChannelMap: () => ({ programChannels: [2, 4] }),
		liveSceneState: liveState,
		take: async (body) => {
			takes.push(body)
			return { status: takeStatus, body: takeStatus === 200 ? '{}' : JSON.stringify({ error: 'boom' }) }
		},
		clearBorderType: (ch) => borders.push(ch),
	}
	return { ctx, deps, takes, borders, logs, liveState, run: () => restore.restoreProgramLooks(ctx, { reconnect, deps }) }
}

describe('WO-1013 look bands', () => {
	it('only real producers in 10–99 / 110–199 count as content', () => {
		assert.equal(reconcile.lookBandsEmpty({}), true)
		assert.equal(reconcile.lookBandsEmpty({ 1: 'route', 999: 'html', 985: 'html' }), true)
		assert.equal(reconcile.lookBandsEmpty({ 10: 'empty', 110: '' }), true)
		assert.equal(reconcile.lookBandsEmpty({ 10: 'ffmpeg' }), false)
		assert.equal(reconcile.lookBandsEmpty({ 150: 'route' }), false)
	})

	it('re-take eligibility: file/route looks yes, timeline or empty looks no', () => {
		assert.equal(restore.retakeSkipReason(LOOK), '')
		assert.equal(restore.retakeSkipReason({ layers: [{ layerNumber: 10, source: { type: 'route', value: 'route://5' } }] }), '')
		assert.equal(restore.retakeSkipReason(TIMELINE_LOOK), 'timeline look')
		assert.equal(restore.retakeSkipReason({ layers: [{ layerNumber: 10, source: {} }] }), 'no content')
	})
})

describe('WO-1013 program looks', () => {
	it('reconnect + empty channel → the persisted look is re-taken as a cut, no PGM/PRV exchange', async () => {
		const t = setup({ xmlByCh: { 2: EMPTY_LOOKS }, live: { 2: { sceneId: 'look-1', scene: LOOK } } })
		const out = await t.run()
		assert.deepEqual(out, [{ channel: 2, action: 'retaken' }])
		assert.equal(t.takes.length, 1)
		const b = t.takes[0]
		assert.equal(b.channel, 2)
		assert.equal(b.forceCut, true)
		assert.equal(b.previewExchange, false)
		assert.equal(b.useServerLive, false)
		assert.deepEqual(b.currentScene, { id: 'look-1', layers: [] }, 'empty current: every layer plays, fixtures skip')
		assert.equal(b.incomingScene.id, 'look-1')
		assert.deepEqual(b.incomingScene.layers, LOOK.layers)
		assert.deepEqual(t.liveState.calls.cleared, [], 'nothing cleared')
		assert.ok(t.logs.some((l) => /re-took live look Opener/.test(l)))
	})

	it('different content on Caspar → no re-take, no clear here (the reconcile owns the mismatch)', async () => {
		const t = setup({ xmlByCh: { 2: OTHER_LOOK }, live: { 2: { sceneId: 'look-1', scene: LOOK } } })
		const out = await t.run()
		assert.deepEqual(out, [{ channel: 2, action: 'kept' }])
		assert.equal(t.takes.length, 0)
		assert.deepEqual(t.liveState.calls.cleared, [])
	})

	it('first connect (boot) + empty channel → cleared as before WO-1013, never re-taken', async () => {
		const t = setup({ xmlByCh: { 2: EMPTY_LOOKS }, live: { 2: { sceneId: 'look-1', scene: LOOK } }, reconnect: false })
		const out = await t.run()
		assert.deepEqual(out, [{ channel: 2, action: 'cleared' }])
		assert.equal(t.takes.length, 0)
		assert.deepEqual(t.liveState.calls.cleared, [2])
		assert.equal(t.liveState.calls.broadcasts, 1)
	})

	it('a timeline look is not re-taken (its engine state survives in node)', async () => {
		const t = setup({ xmlByCh: { 2: EMPTY_LOOKS }, live: { 2: { sceneId: 'look-tl', scene: TIMELINE_LOOK } } })
		const out = await t.run()
		assert.deepEqual(out, [{ channel: 2, action: 'skipped', detail: 'timeline look' }])
		assert.equal(t.takes.length, 0)
	})

	it('unreadable INFO → nothing touched', async () => {
		const t = setup({ xmlByCh: {}, live: { 2: { sceneId: 'look-1', scene: LOOK } }, infoThrows: true })
		assert.deepEqual(await t.run(), [{ channel: 2, action: 'unknown' }])
		assert.equal(t.takes.length, 0)
		assert.deepEqual(t.liveState.calls.cleared, [])
	})

	it('a failed re-take is reported, not thrown; border-type cache dropped for every program channel', async () => {
		const t = setup({ xmlByCh: { 2: EMPTY_LOOKS }, live: { 2: { sceneId: 'look-1', scene: LOOK } }, takeStatus: 502 })
		assert.deepEqual(await t.run(), [{ channel: 2, action: 'failed', detail: 'boom' }])
		assert.deepEqual(t.borders, [2, 4])
	})

	it('preview channels in scene.live are never re-taken here (preview re-stage owns them)', async () => {
		const t = setup({ xmlByCh: { 3: EMPTY_LOOKS }, live: { 3: { sceneId: 'look-1', scene: LOOK } } })
		assert.deepEqual(await t.run(), [])
		assert.equal(t.takes.length, 0)
	})
})

describe('WO-1013 connect-time reconcile (real live-scene-state, test-isolated persistence)', () => {
	const self = (chXml) => ({ config: {}, log: () => {}, programLayerBankByChannel: {}, gatheredInfo: { channelXml: { 1: chXml } } })
	const flush = () => liveSceneState.clearChannel(77)

	it('empty Caspar on connect → the persisted look survives (left to restore-on-screens)', async () => {
		await liveSceneState.setChannel(1, { sceneId: 'look-1', scene: LOOK })
		await reconcile.reconcileAfterInfoGather(self(EMPTY_LOOKS))
		await flush()
		assert.equal(liveSceneState.getChannel(1)?.sceneId, 'look-1')
	})

	it('different content on connect → still cleared (unchanged)', async () => {
		await liveSceneState.setChannel(1, { sceneId: 'look-1', scene: LOOK })
		await reconcile.reconcileAfterInfoGather(self(OTHER_LOOK))
		await flush()
		assert.equal(liveSceneState.getChannel(1), null)
	})

	it('the periodic reconcile (no deferEmpty) still clears on an empty channel (unchanged)', async () => {
		await liveSceneState.setChannel(1, { sceneId: 'look-1', scene: LOOK })
		await reconcile.reconcileLiveSceneFromGatheredXml(self(EMPTY_LOOKS))
		await flush()
		assert.equal(liveSceneState.getChannel(1), null)
	})
})

describe('WO-1013 test card', () => {
	const baseCtx = (extra) => ({ log: () => {}, amcp: { isConnected: true }, _ledTest999KnownClear: new Set([2, 3]), ...extra })

	it('operator card on → applyCard(ctx, true) re-plans it; the 999 known-clear cache is dropped', async () => {
		const calls = []
		const ctx = baseCtx({ _ledTestPatternActive: true, _ledTestCardSource: 'control', _startupLedTestChannelIndices: [2, 4] })
		const r = await restore.restoreLedTestCard(ctx, {
			deps: { applyCard: async (c, on) => (calls.push(on), { targets: [2], failures: [] }) },
		})
		assert.deepEqual(calls, [true])
		assert.equal(r.restored, true)
		assert.equal(r.mode, 'card')
		assert.equal(ctx._ledTest999KnownClear.size, 0)
	})

	it('card off → untouched (no paint), cache still dropped', async () => {
		let painted = 0
		const ctx = baseCtx({ _ledTestPatternActive: false })
		const r = await restore.restoreLedTestCard(ctx, {
			deps: { applyCard: async () => (painted++, { targets: [], failures: [] }), postCard: async () => (painted++, { status: 200 }) },
		})
		assert.equal(painted, 0)
		assert.deepEqual(r, { restored: false, reason: 'inactive' })
		assert.equal(ctx._ledTest999KnownClear.size, 0)
	})

	it('boot splash up (no operator switch since) → splash re-painted on its own channels', async () => {
		const posts = []
		const ctx = baseCtx({ _ledTestPatternActive: true, _startupLedTestChannelIndices: [2, 4, 5] })
		const r = await restore.restoreLedTestCard(ctx, {
			deps: {
				applyCard: async () => assert.fail('the splash is not the operator card'),
				postCard: async (p, body) => (posts.push([p, JSON.parse(body)]), { status: 200 }),
			},
		})
		assert.equal(r.mode, 'splash')
		assert.deepEqual(posts.map(([p, b]) => [p, b.channel, b.enabled, b.showLedGrid]), [
			['/api/led-test-card', 2, true, false],
			['/api/led-test-card', 4, true, false],
			['/api/led-test-card', 5, true, false],
		])
		assert.deepEqual(posts[0][1], restore.splashCardBody(2))
	})

	it('applyCard marks the operator card as the one up, and master-off forgets it', async () => {
		const ctl = require('../../src/engine/led-test-card-control')
		const ctx = { _ledTest999KnownClear: new Set([2]), getState: () => ({ channelMap: { programChannels: [2] } }) }
		await ctl.applyCard(ctx, true, { post: async () => ({ status: 200 }) })
		assert.equal(ctx._ledTestCardSource, 'control')
		assert.equal(ctx._ledTest999KnownClear.size, 0, 'paint drops the WO-492 cache')
		await ctl.applyCard(ctx, false, { post: async () => ({ status: 200 }) })
		assert.equal(ctx._ledTestCardSource, null)
	})
})

describe('WO-1013 caspar-info-ready order', () => {
	it('routing → program looks → preview re-stage → test card (reconnect only); boot paints no card', async () => {
		const seq = []
		const patch = (mod, name, fn) => {
			const m = require(mod)
			const old = m[name]
			m[name] = fn
			return () => {
				m[name] = old
			}
		}
		const undo = [
			patch('../../src/engine/restore-on-screens', 'restoreProgramLooks', async (_c, o) => void seq.push(`program:${o.reconnect}`)),
			patch('../../src/engine/restore-on-screens', 'restoreLedTestCard', async () => void seq.push('card')),
			patch('../../src/engine/restore-on-screens', 'primeLedTestCardFromPersisted', () => void seq.push('prime')),
			patch('../../src/engine/restore-on-screens', 'verifyPrimedLedTestCard', async () => void seq.push('verify')),
			patch('../../src/config/routing-setup', 'restagePersistedPreviewLooks', async () => void seq.push('preview')),
			patch('../../src/config/routing-setup', 'warmLookDeckThumbnails', async () => void seq.push('thumbs')),
			patch('../../src/system/screen-consumer-placement', 'placeScreenConsumers', async () => ({ missing: 0 })),
			patch('../../src/engine/template-cg-orphan-sweep', 'sweepTemplateCgOrphansOnCasparConnected', async () => {}),
			patch('../../src/engine/screen-timers', 'loadRegistry', () => {}),
			patch('../../src/engine/screen-timers', 'linesForReAdd', () => []),
		]
		try {
			const { createOnAfterInfoConfigReady } = require('../../src/bootstrap/caspar-info-ready')
			const appCtx = { log: () => {}, config: {} }
			const onReady = createOnAfterInfoConfigReady({
				appCtx,
				config: {},
				getChannelMap: () => ({ previewChannels: [], screenCount: 0, programCh: () => 1 }),
				handleCasparConnected: () => {},
				setupAllRouting: () => new Promise((r) => setTimeout(() => (seq.push('routing'), r()), 30)),
				reconcileAfterInfoGather: async () => void seq.push('reconcile'),
			})
			const settle = () => new Promise((r) => setTimeout(r, 120))
			assert.deepEqual(seq, ['prime'], 'the stored card state is primed when the hook is built, before any connect')
			seq.length = 0
			onReady()
			await settle()
			assert.deepEqual(seq, ['verify', 'reconcile', 'routing', 'program:false', 'preview', 'thumbs'])
			seq.length = 0
			onReady()
			await settle()
			assert.deepEqual(seq, ['reconcile', 'routing', 'program:true', 'preview', 'card', 'thumbs'])
		} finally {
			for (const u of undo) u()
		}
	})
})

describe('WO-1013 follow-up: the operator card survives a NODE restart', () => {
	const ctl = require('../../src/engine/led-test-card-control')
	const persistence = require('../../src/utils/persistence')
	const store = (v) => persistence.set('ledTestCardOn', v)
	const deps = { getChannelMap: () => ({ programChannels: [2] }) }
	const ctxWith = (xmlByCh, extra = {}) => {
		const sent = []
		return {
			sent,
			ctx: {
				log: () => {},
				_wsBroadcast: (type, p) => sent.push([type, p.path, p.value]),
				amcp: {
					isConnected: true,
					info: async (ch) => {
						if (xmlByCh === 'throw') throw new Error('INFO failed')
						return { data: xmlByCh[ch] || xml('') }
					},
				},
				...extra,
			},
		}
	}

	it('only the operator card is stored as on (splash / direct route paints never are)', () => {
		ctl.persistOnState({ _ledTestPatternActive: true, _ledTestCardSource: 'control' })
		assert.deepEqual(ctl.readOnState(), { on: true, source: 'control' })
		ctl.persistOnState({ _ledTestPatternActive: true, _ledTestCardSource: null })
		assert.deepEqual(ctl.readOnState(), { on: false, source: null })
		ctl.persistOnState({ _ledTestPatternActive: false, _ledTestCardSource: 'control' })
		assert.deepEqual(ctl.readOnState(), { on: false, source: null })
	})

	it('applyCard stores on/off; the route master-off stores off', async () => {
		const ctx = { getState: () => ({ channelMap: { programChannels: [2] } }) }
		// the real per-channel route sets the master flag on a successful paint
		await ctl.applyCard(ctx, true, { post: async (_p, _b, c) => ((c._ledTestPatternActive = true), { status: 200 }) })
		assert.equal(ctl.readOnState().on, true)
		const route = require('../../src/api/routes-led-test-card')
		ctx.amcp = { cg: { cgClear: async () => {} }, mixer: { mixerCommit: async () => {} } }
		const r = await route.handlePost('/api/led-test-card', JSON.stringify({ enabled: false, channel: 2, masterOff: true }), ctx)
		assert.equal(r.status, 200)
		assert.equal(ctx._ledTestPatternActive, false)
		assert.equal(ctl.readOnState().on, false)
	})

	it('prime: stored on → provisionally on + control; stored off → untouched', () => {
		store({ on: true, source: 'control' })
		const a = {}
		assert.equal(restore.primeLedTestCardFromPersisted(a), true)
		assert.deepEqual([a._ledTestPatternActive, a._ledTestCardSource, a._ledTestCardPrimed], [true, 'control', true])
		store({ on: false, source: null })
		const b = {}
		assert.equal(restore.primeLedTestCardFromPersisted(b), false)
		assert.equal(b._ledTestPatternActive, undefined)
	})

	it('node restart, Caspar still shows layer 999 → on, broadcast, still stored on', async () => {
		store({ on: true, source: 'control' })
		const { ctx, sent } = ctxWith({ 2: EMPTY_LOOKS })
		restore.primeLedTestCardFromPersisted(ctx)
		const r = await restore.verifyPrimedLedTestCard(ctx, { deps })
		assert.deepEqual(r, { state: 'on', channels: [2] })
		assert.equal(ctx._ledTestPatternActive, true)
		assert.equal(ctx._ledTestCardSource, 'control')
		assert.deepEqual(sent, [['change', 'ledTestPatternActive', true]])
		assert.equal(ctl.readOnState().on, true)
	})

	it('box boot (fresh Caspar, no 999) → off, broadcast, stored off', async () => {
		store({ on: true, source: 'control' })
		const { ctx, sent } = ctxWith({ 2: xml(fileLayer(1, 'route://9', 'route')) })
		restore.primeLedTestCardFromPersisted(ctx)
		assert.deepEqual(await restore.verifyPrimedLedTestCard(ctx, { deps }), { state: 'off' })
		assert.equal(ctx._ledTestPatternActive, false)
		assert.equal(ctx._ledTestCardSource, null)
		assert.deepEqual(sent, [['change', 'ledTestPatternActive', false]])
		assert.equal(ctl.readOnState().on, false)
	})

	it('boot splash painted this boot → the splash owns the flag; stored operator state dropped, never "control"', async () => {
		store({ on: true, source: 'control' })
		const { ctx } = ctxWith({ 2: EMPTY_LOOKS })
		restore.primeLedTestCardFromPersisted(ctx)
		ctx._startupLedTestChannelIndices = [2, 4] // set by startup-led-test-pattern.js before info-ready
		assert.deepEqual(await restore.verifyPrimedLedTestCard(ctx, { deps }), { state: 'splash' })
		assert.equal(ctx._ledTestPatternActive, true, 'the splash is up')
		assert.equal(ctx._ledTestCardSource, null, 'a later Caspar restart repaints the SPLASH, not the operator card')
		assert.equal(ctl.readOnState().on, false)
	})

	it('no channel readable → keeps the stored on-state; not primed → no-op', async () => {
		store({ on: true, source: 'control' })
		const { ctx } = ctxWith('throw')
		restore.primeLedTestCardFromPersisted(ctx)
		assert.deepEqual(await restore.verifyPrimedLedTestCard(ctx, { deps }), { state: 'unknown' })
		assert.equal(ctx._ledTestPatternActive, true)
		assert.deepEqual(await restore.verifyPrimedLedTestCard({}, { deps }), { state: 'not primed' })
		store({ on: false, source: null })
	})
})
