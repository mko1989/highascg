'use strict'

/**
 * WO-1074 v2 — synthetic tracks + a bot for the RC client smokes (tools/smoke/smoke-wo1074-rc-client*.test.js).
 * Built here on purpose: the server's track generator changes independently, the client must work with any valid
 * contract v2 track. Shapes:
 *  - roomTrack(): hall → ramp up onto the stage (13°) → across the stage → off the stage edge (a drop) → round the hall;
 *  - ovalTrack(): plain flat oval (v2 3D points); ovalTrackV1(): the same as a v1 track ([x, z] + track.y);
 *  - eightTrack(): flat figure-eight; straightTrack(): open strip heading −Z;
 *  - deckTracks(): §2.7 — the server generator's room-long tracks over the synthetic furnished hall (decks, bridges).
 */

const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RC = path.join(__dirname, '..', '..', '..', 'game', 'rc')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)

/* ---------------- the synthetic room ---------------- */
const HALL = { id: 'hall', y: 0, rect: [-20, -15, 20, 15] }
const STAGE = { id: 'stage', y: 1.4, rect: [-6, -12, 6, -4] }
const ROOM_FLOORS = [HALL, STAGE]

/** Plan path as lines and arcs → evenly spaced points. */
function samplePath(parts, ds) {
	const dense = []
	for (const p of parts) {
		if (p.line) {
			const [a, b] = p.line
			const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05))
			for (let i = 0; i < n; i++) dense.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n])
		} else {
			const { c, r, a0, a1 } = p.arc
			const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / 0.05))
			for (let i = 0; i < n; i++) {
				const a = a0 + ((a1 - a0) * i) / n
				dense.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
			}
		}
	}
	let total = 0
	const cum = [0]
	for (let i = 1; i <= dense.length; i++) {
		const a = dense[i - 1]
		const b = dense[i % dense.length]
		total += Math.hypot(b[0] - a[0], b[1] - a[1])
		cum.push(total)
	}
	const n = Math.round(total / ds)
	const out = []
	let j = 0
	for (let i = 0; i < n; i++) {
		const s = (i * total) / n
		while (cum[j + 1] < s) j++
		const a = dense[j]
		const b = dense[(j + 1) % dense.length]
		const t = (s - cum[j]) / (cum[j + 1] - cum[j] || 1)
		out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
	}
	return { pts: out, total }
}

const inRect = (r, x, z) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]

/**
 * Hall start at (−3, 8) heading −Z; ramp from z = 2 (y 0) up to the stage front edge z = −4 (y 1.4); across the stage;
 * right onto +X and off the stage's right edge (x = 6) — a drop, landing ≈ 4 m on; round the hall back to the start.
 */
function roomTrack({ width = 3, ds = 0.6 } = {}) {
	const H = Math.PI / 2
	const parts = [
		{
			line: [
				[-3, 8],
				[-3, -7],
			],
		},
		{ arc: { c: [-0.5, -7], r: 2.5, a0: Math.PI, a1: Math.PI + H } },
		{
			line: [
				[-0.5, -9.5],
				[11, -9.5],
			],
		},
		{ arc: { c: [11, -6.5], r: 3, a0: -H, a1: 0 } },
		{
			line: [
				[14, -6.5],
				[14, 9],
			],
		},
		{ arc: { c: [11, 9], r: 3, a0: 0, a1: H } },
		{
			line: [
				[11, 12],
				[0, 12],
			],
		},
		{ arc: { c: [0, 9], r: 3, a0: H, a1: Math.PI } },
		{
			line: [
				[-3, 9],
				[-3, 8],
			],
		},
	]
	const { pts, total } = samplePath(parts, ds)
	const yOf = (x, z) => {
		if (inRect(STAGE.rect, x, z)) return STAGE.y
		if (Math.abs(x + 3) < 0.01 && z <= 2 && z > -4) return (STAGE.y * (2 - z)) / 6
		return HALL.y
	}
	const points = pts.map(([x, z]) => [x, yOf(x, z), z])
	const n = points.length
	let rampFrom = -1
	let rampTo = -1
	let at = -1
	let land = -1
	for (let i = 0; i < n; i++) {
		const [x, , z] = points[i]
		if (rampFrom < 0 && Math.abs(x + 3) < 0.01 && z < 2) rampFrom = i - 1
		if (rampTo < 0 && rampFrom >= 0 && z <= -4) rampTo = i
		if (Math.abs(z + 9.5) < 0.01 && x <= 6) at = i
		if (land < 0 && Math.abs(z + 9.5) < 0.01 && x >= 10) land = i
	}
	const idx = (fx, fz) => {
		let best = 0
		let bd = Infinity
		points.forEach((p, i) => {
			const d = Math.hypot(p[0] - fx, p[2] - fz)
			if (d < bd) {
				bd = d
				best = i
			}
		})
		return best
	}
	const checkpoints = [0, idx(-3, -6), land, idx(14, 2), idx(5, 12)]
	const pads = [{ x: 14, y: 0, z: 0, yaw: Math.PI }]
	const boxes = [-1, 0, 1].map((k, i) => ({ id: i, x: 14 + k, y: 0.5, z: 6 }))
	return {
		id: 'room-test',
		name: 'Room test',
		floor: 'room',
		width,
		closed: true,
		points,
		length: total,
		ramps: [{ from: rampFrom, to: rampTo }],
		drops: [{ at, land }],
		pads,
		boxes,
		checkpoints,
		grid: [],
	}
}

function ovalPoints(a, b, n, y) {
	const points = []
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2
		points.push([a * Math.cos(t), y, b * Math.sin(t)])
	}
	return points
}

/** Flat oval driven in point order (v2: 3D points). */
function ovalTrack(a = 12, b = 7, n = 140, y = 0, width = 3) {
	return {
		id: 'oval',
		name: 'Oval',
		floor: 'hall',
		width,
		closed: true,
		points: ovalPoints(a, b, n, y),
		checkpoints: [0, n / 4, n / 2, (3 * n) / 4],
		grid: [],
	}
}

/** The v1 shape of an oval: [x, z] points + track.y. */
function ovalTrackV1(a = 8, b = 5, n = 120, y = 1.42) {
	return {
		id: 'oval1',
		name: 'Oval v1',
		floor: 'stage',
		y,
		width: 2.2,
		closed: true,
		points: ovalPoints(a, b, n, 0).map((p) => [p[0], p[2]]),
		checkpoints: [0, 30, 60, 90],
		grid: [],
	}
}

/** Figure-eight (lemniscate of Gerono) — the centre line crosses itself at the origin at points n/4 and 3n/4. */
function eightTrack(a = 8, n = 160, y = 0) {
	const points = []
	for (let i = 0; i < n; i++) {
		const t = (i / n) * Math.PI * 2
		points.push([a * Math.cos(t), y, a * Math.sin(t) * Math.cos(t)])
	}
	return {
		id: 'eight',
		name: 'Eight',
		width: 2.5,
		closed: true,
		points,
		checkpoints: [0, n / 4, n / 2, (3 * n) / 4],
		grid: [],
	}
}

/** A long straight (open) strip heading −Z from the origin. */
function straightTrack(len = 300, width = 4, y = 0) {
	const points = []
	for (let z = 0; z >= -len; z -= 1) points.push([0, y, z])
	return { id: 'straight', width, closed: false, points, checkpoints: [0], grid: [] }
}

const BIG_FLOORS = [{ id: 'hall', y: 0, rect: [-500, -500, 500, 500] }]

/**
 * Bot: aims at the centre line LOOK m ahead, full throttle on straights, slows for tight corners.
 * Returns { input, near } for this step.
 */
function botInput(TM, PH, T, car, hint) {
	const n = TM.nearestHinted(T, car.x, car.z, hint, car.y)
	const v = PH.forwardSpeed(car)
	const look = 2 + Math.max(0, v) * 0.18
	const tgt = TM.pointAt(T, n.s + look)
	const want = Math.atan2(-(tgt.x - car.x), -(tgt.z - car.z))
	let err = want - car.yaw
	while (err > Math.PI) err -= 2 * Math.PI
	while (err < -Math.PI) err += 2 * Math.PI
	/* curvature ahead: heading change over the next 6 m */
	const a = TM.pointAt(T, n.s + 1)
	const b = TM.pointAt(T, n.s + 7)
	let turn = Math.atan2(b.ux, b.uz) - Math.atan2(a.ux, a.uz)
	while (turn > Math.PI) turn -= 2 * Math.PI
	while (turn < -Math.PI) turn += 2 * Math.PI
	const vWant = Math.abs(turn) > 0.9 ? 7 : Math.abs(turn) > 0.5 ? 9 : 13
	return {
		near: n,
		input: { throttle: v < vWant ? 1 : 0, brake: v > vWant + 1.5 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 2.5)) },
	}
}

/**
 * §2.7 deck tracks: the real server generator (src/game/rc-tracks.js) run once over the furnished hall of
 * tools/smoke/lib/rc-track-measure.js — { floors, obstacles, over (an over-and-under with a bridge), sky (a long deck
 * loop) }. The one place the client smokes use a server-generated track: decks and bridges are generator geometry.
 */
let deckCache = null
function deckTracks() {
	if (deckCache) return deckCache
	const { generateTracks } = require('../../../src/game/rc-tracks')
	const { furnishedHall } = require('./rc-track-measure')
	const sc = furnishedHall()
	const r = generateTracks(sc)
	const by = (id) => r.tracks.find((t) => t.id === id)
	deckCache = { floors: r.floors, obstacles: sc.obstacles, over: by('room-over'), sky: by('room-sky'), tracks: r.tracks }
	return deckCache
}

/** Fake browser environment for RcNet (game/rc/net.js module passed in): fake WebSocket + manual clock. */
function fakeNetEnv(NET) {
	const env = { t: 0, timers: [], sockets: [], messages: [], statuses: [] }
	class FakeWS {
		constructor(url) {
			this.url = url
			this.readyState = 0
			this.sent = []
			env.sockets.push(this)
		}
		send(s) {
			this.sent.push(JSON.parse(s))
		}
		close() {
			this.readyState = 3
		}
		open() {
			this.readyState = 1
			this.onopen?.()
		}
		recv(obj) {
			this.onmessage?.({ data: JSON.stringify(obj) })
		}
		drop(code = 1006) {
			this.readyState = 3
			this.onclose?.({ code })
		}
	}
	let id = 0
	const add = (f, ms, every) => {
		env.timers.push({ id: ++id, at: env.t + ms, f, every })
		return id
	}
	const clear = (tid) => (env.timers = env.timers.filter((x) => x.id !== tid))
	env.advance = (ms) => {
		const end = env.t + ms
		for (;;) {
			env.timers.sort((a, b) => a.at - b.at)
			const next = env.timers[0]
			if (!next || next.at > end) break
			env.t = next.at
			if (next.every) next.at += next.every
			else env.timers.shift()
			next.f()
		}
		env.t = end
	}
	env.net = new NET.RcNet({
		url: 'ws://box:4200/api/game/rc/ws',
		WebSocket: FakeWS,
		now: () => env.t,
		setTimeout: (f, ms) => add(f, ms, 0),
		clearTimeout: clear,
		setInterval: (f, ms) => add(f, ms, ms),
		clearInterval: clear,
		onMessage: (m) => env.messages.push(m),
		onStatus: (s) => env.statuses.push(s),
	})
	return env
}

module.exports = {
	fakeNetEnv,
	load,
	HALL,
	STAGE,
	ROOM_FLOORS,
	BIG_FLOORS,
	roomTrack,
	ovalTrack,
	ovalTrackV1,
	eightTrack,
	straightTrack,
	deckTracks,
	botInput,
}
