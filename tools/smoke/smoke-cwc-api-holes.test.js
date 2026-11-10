'use strict'

/**
 * WO-1029 plan 07 (C1c) — API routes on a server where some screens are not cabled (channelsWhereCabled on).
 * Fixture: highascg5867 (screens 0 and 1 not here; screen 2 = ch 2/3, screen 3 = ch 4/5). highascg7579 is the linked peer
 * that cables screen 0 ("to zoom", screen 1, is cabled nowhere).
 * A screen that is not here: 409 { code: 'NOT_HERE', screen, destId, owners }, and the fake AMCP receives NOTHING.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { boxConfig, quiet, clone } = require('./lib/cwc-fixtures')
const { normalizeDeviceGraph } = require('../../src/config/device-graph')
const { normalizeScreenDestinations } = require('../../src/config/screen-destinations')
const nh = require('../../src/api/screen-not-here')

/** A recording AMCP: any call path resolves ok and is logged. */
function fakeAmcp(log) {
	const make = (path) =>
		new Proxy(() => {}, {
			get: (_t, k) => (k === 'then' ? undefined : make([...path, String(k)])),
			apply: (_t, _s, args) => {
				log.push(`${path.join('.')}(${args.join(',')})`)
				return Promise.resolve({ ok: true, data: [] })
			},
		})
	return make([])
}

function box(on = true) {
	const cfg = clone(boxConfig('5867'))
	if (on) cfg.cluster = { channelsWhereCabled: true }
	return cfg
}

function ctxOf(cfg, withPeer = true) {
	const calls = []
	const peer = boxConfig('7579')
	const view = { graph: normalizeDeviceGraph(peer.deviceGraph), screenDestinations: normalizeScreenDestinations(peer.screenDestinations) }
	const ctx = {
		config: cfg,
		amcp: fakeAmcp(calls),
		log: () => {},
		_wsBroadcast: () => {},
		...(withPeer ? { _cluster: { snapshot: () => ({ peers: [{ id: 'p7579', name: 'highascg7579', online: true }] }), deviceView: async () => ({ status: 200, body: view }) } } : {}),
	}
	return { ctx, calls }
}

const json = (r) => JSON.parse(r.body)
const notHere = (r, screen, owners) => {
	assert.equal(r.status, 409, r.body)
	const b = json(r)
	assert.equal(b.code, 'NOT_HERE')
	assert.equal(b.screen, screen)
	assert.deepEqual(b.owners, owners)
	assert.ok(/not on this server|not cabled on any server/.test(b.error), b.error)
	return b
}

describe('WO-1029 C1c screen-not-here', () => {
	it('screenTarget: here / hole / channel / dest; flag off is inert', () => {
		const { ctx } = ctxOf(box())
		quiet(() => {
			assert.deepEqual([nh.screenTarget(ctx, { screenIdx: 2 }).here, nh.screenTarget(ctx, { screenIdx: 2 }).pgm, nh.screenTarget(ctx, { screenIdx: 2 }).prv], [true, 2, 3])
			const hole = nh.screenTarget(ctx, { screenIdx: 0 })
			assert.equal(hole.here, false)
			assert.equal(hole.destId, 'dst_mw7t9epz_1')
			assert.equal(nh.screenTarget(ctx, { destId: 'dst_mw96s6pd_1' }).idx, 1)
			assert.equal(nh.screenTarget(ctx, { channel: 4 }).idx, 3)
			assert.equal(nh.screenTarget(ctx, { channel: 9 }).here, true, 'a raw channel that is no screen bus stays the route\'s own business')
			const off = ctxOf(box(false)).ctx
			assert.equal(nh.screenTarget(off, { screenIdx: 0 }).here, true)
			assert.deepEqual(nh.notHereList(off), [])
		})
	})

	it('notHereReply: owners named from the linked peer; uncabled screen says so; engine shapes give the same 409', async () => {
		const { ctx } = ctxOf(box())
		await quiet(async () => {
			const r0 = await nh.notHereReply(ctx, { screenIdx: 0 })
			const b = notHere(r0, 0, ['p7579'])
			assert.equal(b.error, 'Screen 1 is not on this server: it is on highascg7579')
			assert.equal(b.destId, 'dst_mw7t9epz_1')
			const b1 = notHere(await nh.notHereReply(ctx, { screenIdx: 1 }), 1, [])
			assert.equal(b1.error, 'Screen 2 is not cabled on any server')
			notHere(await nh.notHereReply(ctx, Object.assign(new Error('x'), { code: 'NOT_HERE', screenIdx: 0 })), 0, ['p7579'])
			notHere(await nh.notHereReply(ctx, { notHere: true, screenIdx: 0 }), 0, ['p7579'])
			assert.deepEqual(nh.notHereList(ctx).map((x) => [x.screen, x.owners]), [[0, ['p7579']], [1, []]])
			notHere(nh.notHereFromError({ code: 'NOT_HERE', screenIdx: 1, message: 'Screen 2 is not on this server', owners: [{ id: 'a' }] }), 1, ['a'])
		})
	})
})

describe('WO-1029 C1c routes on a server with holes', () => {
	it('FTB: screen 2 fades its channels; screen 0 is 409 and sends nothing; all screens = local screens + notHere', async () => {
		const { handlePost } = require('../../src/api/routes-ftb')
		await quiet(async () => {
			let { ctx, calls } = ctxOf(box())
			let r = await handlePost('/api/ftb', JSON.stringify({ screenIdx: 2, durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.ok(calls.length > 0)
			const chans = new Set(calls.map((c) => (/^[\w.]+\((\d+)/.exec(c) || [])[1]).filter(Boolean))
			assert.ok([...chans].every((c) => c === '2' || c === '3'), `screen 2 = channels 2/3 only: ${[...chans]}`)
			;({ ctx, calls } = ctxOf(box()))
			notHere(await handlePost('/api/ftb', JSON.stringify({ screenIdx: 0 }), ctx), 0, ['p7579'])
			assert.deepEqual(calls, [])
			;({ ctx, calls } = ctxOf(box()))
			r = await handlePost('/api/ftb', JSON.stringify({ durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			const b = json(r)
			assert.deepEqual(b.notHere.map((x) => x.screen), [0, 1])
			assert.ok(calls.length > 0)
			const all = new Set(calls.map((c) => (/^[\w.]+\((\d+)/.exec(c) || [])[1]).filter(Boolean))
			assert.deepEqual([...all].sort(), ['2', '3', '4', '5'], 'all screens = the local screens\' channels, not the holes\'')
		})
	})

	it('FTB flag off: no notHere key, every screen is blacked as today', async () => {
		const { handlePost } = require('../../src/api/routes-ftb')
		await quiet(async () => {
			const { ctx } = ctxOf(box(false))
			const r = await handlePost('/api/ftb', JSON.stringify({ durationFrames: 0 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.equal('notHere' in json(r), false)
		})
	})

	it('LED test card: screenIdx here goes to its PGM; a hole is 409 with nothing sent; no channel = first local screen', async () => {
		const { handlePost } = require('../../src/api/routes-led-test-card')
		await quiet(async () => {
			let { ctx, calls } = ctxOf(box())
			ctx.getState = () => ({ channelMap: { programChannels: [null, null, 2, 4], screenCount: 4 } })
			notHere(await handlePost('/api/led-test-card', JSON.stringify({ enabled: false, screenIdx: 0 }), ctx), 0, ['p7579'])
			assert.deepEqual(calls, [])
			let r = await handlePost('/api/led-test-card', JSON.stringify({ enabled: false, screenIdx: 3 }), ctx)
			assert.equal(json(r).channel, 4)
			r = await handlePost('/api/led-test-card', JSON.stringify({ enabled: false }), ctx)
			assert.equal(json(r).channel, 2, 'the default is the first screen HERE, not a hole')
		})
	})

	it('LED test control: channel op by screenIdx; master lists notHere', async () => {
		const { handlePost } = require('../../src/api/routes-led-test-control')
		await quiet(async () => {
			const { ctx, calls } = ctxOf(box())
			ctx.getState = () => ({ channelMap: { programChannels: [null, null, 2, 4], previewChannels: [null, null, 3, 5], screenCount: 4 } })
			notHere(await handlePost('channel', JSON.stringify({ screenIdx: 1, enabled: true }), ctx), 1, [])
			assert.deepEqual(calls, [])
		})
	})

	it('timers assign / audio preview / preview clear / global border / lower third: a hole is 409, nothing sent', async () => {
		await quiet(async () => {
			const { ctx, calls } = ctxOf(box())
			const timers = require('../../src/api/routes-screen-timers')
			notHere(await timers.handlePost('/api/timers/assign', JSON.stringify({ timerId: 't', screenIdx: 0 }), ctx), 0, ['p7579'])
			const audio = require('../../src/api/routes-audio')
			const ar = await audio.handlePost('/api/audio/monitor-source', JSON.stringify({ source: 'pgm_1' }), ctx).catch((e) => e)
			assert.ok(ar && ar.status, 'audio route answered')
			notHere(ar, 0, ['p7579'])
			const prev = require('../../src/api/routes-scene-preview')
			notHere(await prev.handlePreviewLiveClear(JSON.stringify({ mainIndex: 0 }), ctx), 0, ['p7579'])
			const gb = require('../../src/api/routes-scene-global-border')
			notHere(await gb.handleGlobalBorderControl(JSON.stringify({ screen: 1, clear: true }), ctx), 1, [])
			const cap = require('../../src/api/routes-pgm-capture')
			notHere(await cap.handlePgmCapture(JSON.stringify({ mainIndex: 0 }), { ...ctx, amcp: { basic: { print: async () => (calls.push('print'), { ok: true }) } } }), 0, ['p7579'])
			assert.deepEqual(calls, [])
		})
	})

	it('scene take / overlay stop / take-look / pgm-layer / timeline: screenIdx or mainIdx on a hole', async () => {
		await quiet(async () => {
			const { ctx, calls } = ctxOf(box())
			const take = require('../../src/api/routes-scene-take')
			notHere(await take.handleSceneTake(JSON.stringify({ screenIdx: 0, sceneId: 'x' }), ctx), 0, ['p7579'])
			const ov = require('../../src/api/routes-scene-take-overlay')
			notHere(await ov.handleOverlayLookStop(JSON.stringify({ mainIdx: 1 }), ctx), 1, [])
			const lookRoute = require('../../src/api/routes-scene-take-look')
			const scene = { id: 'L', mainScope: 0, layers: [] }
			notHere(await lookRoute.handleTakeLook(JSON.stringify({ sceneId: 'L', mainIdx: 0 }), ctx, { resolveSceneById: () => scene }), 0, ['p7579'])
			const { pgmLayers } = require('../../src/api/routes-pgm-layer')
			const rows = pgmLayers({}, { programChannels: [null, 2], screenLabels: ['A', 'B'] }, {})
			assert.equal(rows[0].here, false)
			assert.equal(rows[0].channel, null)
			assert.equal('here' in rows[1], false)
			const tl = require('../../src/api/routes-timeline')
			const eng = { get: () => ({}), _sendToFor: () => ({ program: true, screenIdx: 0 }), _channelsFor: () => [] }
			const tr = await tl.handle('POST', '/api/timelines/t1/play', '{}', { ...ctx, timelineEngine: eng })
			if (tr && tr.status !== 404) notHere(tr, 0, ['p7579'])
			assert.deepEqual(calls, [])
		})
	})

	it('screen 2 (here) still reaches its own channels through the by-screen routes', async () => {
		await quiet(async () => {
			const { ctx } = ctxOf(box())
			const { channelForScreen } = nh
			assert.deepEqual(await channelForScreen(ctx, { screenIdx: 2 }), { channel: 2 })
			assert.deepEqual(await channelForScreen(ctx, { channel: '4' }), { channel: 4 })
			assert.equal((await channelForScreen(ctx, { screenIdx: 0 })).reply.status, 409)
			const prev = require('../../src/api/routes-scene-preview')
			const r = await prev.handlePreviewLiveClear(JSON.stringify({ mainIndex: 2 }), ctx)
			assert.equal(r.status, 200, r.body)
			assert.equal(json(r).previewChannel, 3)
		})
	})
})
