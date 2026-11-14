'use strict'

/**
 * WO-1074 §2.6 — RC game: LED wall pictures (modules/rc-game/server/rc-video.js). `screensFrom` must place the picture where the
 * previs draws it (stage_builder.gd: position = bottom-centre, strip y 0…h facing +Z, Godot YXZ rotation; uv_rect =
 * source.rect / raster). The fan-out runs against the REAL video feed (src/system/video-feed.js createVideoFeed) with a
 * stand-in worker: one feed client for all game sockets in the feed's own `game` tier (480 px / 8 fps, encoded apart
 * from a GUI watching the same role bigger), the game's framing passed through unchanged, ≤ 8 frames / s per role, a
 * socket that is behind skipped, the role leased while wanted and released after.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const { screensFrom, createRcVideo, LEASE_ID, MAX_VIDEO_BUFFERED, PARAMS } = require('../../modules/rc-game/server/rc-video')
const { createVideoFeed, frameMessage } = require('../../src/system/video-feed')

const near = (a, b, eps = 1e-4) => a.every((v, k) => Math.abs(v - b[k]) < eps)

// the live project's two walls (14.11): one 3072 × 1024 pgm1 raster split 1280 | 1792
const WALLS = [
	{
		id: 'led_wall_1',
		type: 'led_wall',
		position: [2, 1.5, -9],
		rotation: [0, 0, 0],
		panels: [14, 8],
		panel_mm: [500, 500],
		panel_px: [128, 128],
		curve_deg: 0,
		source: { role: 'pgm1', rect: { x: 1280, y: 0, w: 1792, h: 1024 } },
		visible: true,
	},
	{
		id: 'led_wall_2',
		type: 'led_wall',
		position: [-4.5, 1.5, -5],
		rotation: [0, 0, 0],
		panels: [10, 8],
		panel_mm: [500, 500],
		panel_px: [128, 128],
		curve_deg: 0,
		source: { role: 'pgm1', rect: { x: 0, y: 0, w: 1280, h: 1024 } },
		visible: true,
	},
]

describe('rc-video screensFrom — the previs geometry', () => {
	it('centre = bottom-centre position + half the height; size = panels × panel_mm; uv = rect / raster', () => {
		const s = screensFrom(WALLS, (role) => (role === 'pgm1' ? { w: 3072, h: 1024 } : null))
		assert.equal(s.length, 2)
		assert.deepEqual(s[0], {
			id: 'led_wall_1',
			role: 'pgm1',
			p: [2, 3.5, -9],
			rot: [0, 0, 0],
			size: [7, 4],
			curveDeg: 0,
			cols: 14,
			uv: [0.4167, 0, 1, 1],
		})
		assert.deepEqual(s[1].uv, [0, 0, 0.4167, 1])
		assert.deepEqual(s[1].p, [-4.5, 3.5, -5])
	})

	it('raster unknown → the bounding box of every rect of that role (same answer here)', () => {
		const s = screensFrom(WALLS)
		assert.deepEqual(
			s.map((x) => x.uv),
			[
				[0.4167, 0, 1, 1],
				[0, 0, 0.4167, 1],
			]
		)
	})

	it('rotation is Godot YXZ: a wall tipped back 20° about X has its centre moved towards −Z', () => {
		const [s] = screensFrom([{ ...WALLS[0], rotation: [-20, 90, 0] }])
		// R·(0, 2, 0): Rx(−20°) → (0, 2 cos20, −2 sin20); Ry(90°) turns −Z into −X
		assert.ok(
			near(s.p, [2 - 2 * Math.sin((20 * Math.PI) / 180), 1.5 + 2 * Math.cos((20 * Math.PI) / 180), -9], 1e-3),
			JSON.stringify(s.p)
		)
		assert.deepEqual(s.rot, [-20, 90, 0])
	})

	it('curved walls keep their curve and column count; TVs and projection screens size like stage_objects.gd; hidden skipped', () => {
		const list = screensFrom(
			[
				{ ...WALLS[0], curve_deg: 5 },
				{ id: 'tv', type: 'tv', position: [0, 1, 0], diagonal_in: 55, aspect: [16, 9], source: { role: 'prv1' } },
				{
					id: 'pj',
					type: 'projection',
					position: [0, 0, 0],
					screen_m: [4, 2.25],
					source: { role: 'ch3', rect: { x: 0, y: 0, w: 1920, h: 1080 } },
				},
				{ ...WALLS[1], visible: false },
				{ id: 'x', type: 'speaker', position: [0, 0, 0] },
			],
			() => ({ w: 1920, h: 1080 })
		)
		assert.deepEqual(
			list.map((x) => x.id),
			['led_wall_1', 'tv', 'pj']
		)
		assert.equal(list[0].curveDeg, 5)
		assert.equal(list[0].cols, 14)
		assert.ok(near(list[1].size, [1.2177, 0.6849]), JSON.stringify(list[1].size))
		assert.deepEqual(list[1].uv, [0, 0, 1, 1], 'no rect → the whole picture')
		assert.deepEqual(list[2].p, [0, 1.125, 0])
	})
})

/** The real feed with a stand-in worker thread; a fake lease manager; a manual clock. */
function bed() {
	const posted = []
	let worker = null
	const feed = createVideoFeed({
		makeWorker: () => {
			worker = new EventEmitter()
			worker.postMessage = (m) => posted.push(m)
			worker.terminate = () => {}
			return worker
		},
		pathFor: (role) => `/nonexistent/${role}`,
	})
	const leases = []
	let t = 10_000
	const timers = []
	const video = createRcVideo({
		feed: () => feed,
		lease: (id, roles) => leases.push([id, roles]),
		roles: () => ['pgm1'],
		now: () => t,
		setInterval: (fn, ms) => (timers.push({ fn, ms }), timers.length),
		clearInterval: (id) => (timers[id - 1] = null),
	})
	const sock = (buffered = 0) => {
		const got = []
		return { readyState: 1, bufferedAmount: buffered, got, send: (b, o) => got.push([b, o]) }
	}
	// the game's client is in the feed's `game` tier: the worker encodes `<role>~game` for it (its own 480 px encode)
	const frame = (role, n, tier = '~game') =>
		worker.emit('message', { role: role + tier, seq: n, jpeg: Buffer.from([0xff, 0xd8, n, 0xff, 0xd9]) })
	return { feed, video, posted, leases, timers, sock, frame, advance: (ms) => (t += ms), worker: () => worker }
}

describe('rc-video — fan-out through the shared video feed', () => {
	it('nothing until a socket asks; one feed client at 480 px / 8 fps; the role leased', () => {
		const b = bed()
		assert.equal(b.feed.clients.size, 0)
		const A = b.sock()
		b.video.subscribe(A, false)
		assert.equal(b.feed.clients.size, 0, 'video off → nothing')
		b.video.subscribe(A, true)
		const B = b.sock()
		b.video.subscribe(B, true)
		assert.equal(b.feed.clients.size, 1, 'one feed client for every game socket')
		const set = b.posted.filter((m) => m.type === 'set').at(-1)
		assert.deepEqual(set.surfaces, [
			{ role: 'pgm1~game', path: '/nonexistent/pgm1', params: { width: 480, fps: 8, quality: 7 } },
		])
		/* a remote GUI watching the same role at 960 px gets its own encode; the game's stays 480 px */
		const gui = new EventEmitter()
		Object.assign(gui, { readyState: 1, bufferedAmount: 0, send: () => {} })
		b.feed.addClient(gui, { width: 960 })
		gui.emit('message', Buffer.from(JSON.stringify({ roles: ['pgm1'] })), false)
		const both = b.posted.filter((m) => m.type === 'set').at(-1).surfaces
		assert.deepEqual(both.map((x) => [x.role, x.params.width]).sort(), [
			['pgm1', 960],
			['pgm1~game', 480],
		])
		gui.emit('close')
		assert.deepEqual(PARAMS, { width: 480, fps: 8, quality: 7 }, 'contract 2.6: 480 px, ≤ 8 frames / s')
		assert.deepEqual(b.leases, [[LEASE_ID, ['pgm1']]])
		assert.equal(b.timers.filter(Boolean)[0].ms, 5000, 'lease renewed every 5 s (TTL 15 s)')
	})

	it('frames reach every subscriber in the game framing, ≤ 8 / s per role, a socket that is behind skips', () => {
		const b = bed()
		const A = b.sock()
		const slow = b.sock(MAX_VIDEO_BUFFERED + 1)
		b.video.subscribe(A, true)
		b.video.subscribe(slow, true)
		b.frame('pgm1', 1)
		assert.equal(A.got.length, 1)
		assert.deepEqual(A.got[0][0], frameMessage('pgm1', Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9])))
		assert.deepEqual(A.got[0][1], { binary: true })
		assert.equal(slow.got.length, 0)
		b.advance(40)
		b.frame('pgm1', 2) // the shared encoder may run faster (another feed client asked 15 fps)
		assert.equal(A.got.length, 1, 'throttled to the game rate')
		b.advance(100)
		b.frame('pgm1', 3)
		assert.equal(A.got.length, 2)
		b.frame('prv1', 4)
		assert.equal(A.got.length, 2, 'a role no screen shows is never sent')
		b.advance(200)
		b.frame('pgm1', 5, '')
		assert.equal(A.got.length, 2, "another tier's encode never reaches the game")
		assert.deepEqual(b.video.stats().skipped, 2)
	})

	it('last subscriber gone / host switch off → feed client closed (worker stopped), lease released', () => {
		const b = bed()
		const A = b.sock()
		b.video.subscribe(A, true)
		b.video.setOn(false)
		assert.equal(b.feed.clients.size, 0)
		assert.equal(b.posted.at(-1).type, 'stop', 'the feed stops its worker when nobody wants pictures')
		assert.deepEqual(b.leases.at(-1), [LEASE_ID, []])
		assert.equal(b.timers.filter(Boolean).length, 0)
		b.video.setOn(true)
		assert.equal(b.feed.clients.size, 1, 'switched back on: the subscribers that asked get pictures again')
		b.video.detach(A)
		assert.equal(b.feed.clients.size, 0)
		assert.deepEqual(b.leases.at(-1), [LEASE_ID, []])
		b.video.subscribe(A, true)
		b.video.stop()
		assert.equal(b.feed.clients.size, 0)
		assert.equal(b.video.subscribers(), 0)
	})

	it('no feed attached → a warning once, no lease, no throw', () => {
		const logs = []
		const leases = []
		const v = createRcVideo({
			feed: () => null,
			lease: (...a) => leases.push(a),
			roles: () => ['pgm1'],
			log: (l, m) => logs.push(m),
			setInterval: () => 1,
			clearInterval: () => {},
		})
		v.subscribe({}, true)
		v.subscribe({}, true)
		assert.equal(logs.length, 1)
		assert.equal(leases.length, 0)
	})
})
