'use strict'

/**
 * WO-1089 — Stage Salad: the presenter avatars the vegetables fly at (work/notes/stage-salad-contract.md §6). Pure:
 * the tracking snapshot, the clock and the dice are injected.
 *
 * Source: world persons of the tracking module's detections snapshot (`world.persons`; the WO-1087 test puppet people
 * are world persons too). PSN (x stage left, y upstage) → Godot (x, floor, −y); floor = the stage's y inside the stage
 * rect (+ 0.3 m), else the hall's. Look = the person's own `traits`, else the first camera person of that world id that
 * carries traits. Host mode: `auto` (every tracked person, ≤ 3, nearest the stage centre first), `ids` (those tids),
 * `dummy` (the stand-in only). Nobody to show → the stand-in (tid 0, neutral clay, facing the room) at the stage's
 * middle. A person missing from a snapshot stays LOST_MS where last seen (flag lost), then leaves.
 * Pose (as the previs avatar): feet eased at 8/s; facing = walking direction above 0.35 m/s (speed over a 0.6 s
 * baseline); standing ≥ 0.8 s → turns to face the audience at 3 rad/s.
 * Game reactions: `planDodge` (a predicted hit far enough ahead is dodged 18 % of the time: duck for the head, a side
 * step otherwise; ≥ 2.5 s apart) and the round's umbrella (4 s every 25–40 s per avatar; always up while `safe`).
 */

const { shared } = require('./salad-kit')

const LOST_MS = 3000
const MAX_TARGETS = 3
const VEL_WINDOW = 600
const DODGE = { chance: 0.18, leadMs: 350, gapMs: 2500, duckMs: 750, stepMs: 700 }
const UMBRELLA = { everyMin: 25000, everyMax: 40000, ms: 4000 }
const r3 = (v) => Math.round(v * 1000) / 1000 + 0
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/**
 * @param {{ now?: () => number, rng?: () => number, venue: () => object|null, onEvent?: (msg) => void }} deps
 *   onEvent: `dodge` / `umbrella` messages for everyone
 */
function createPresenters(deps) {
	const B = shared().body
	const V = shared().venue
	const now = deps.now || Date.now
	const rng = deps.rng || Math.random
	const emit = deps.onEvent || (() => {})
	const mode = { mode: 'auto', ids: [] }
	const avs = new Map() // tid → avatar
	let safe = false
	let round = false
	let lastTick = null

	const venue = () => deps.venue() || null

	function floorAt(x, z) {
		const v = venue()
		if (!v) return 0
		const r = v.stage.rect
		return x >= r[0] - 0.3 && x <= r[2] + 0.3 && z >= r[1] - 0.3 && z <= r[3] + 0.3 ? v.stage.y : v.hall.y
	}

	function audienceYaw() {
		const f = venue()?.front?.f || [0, 1]
		return Math.atan2(f[0], f[1])
	}

	function make(tid, info, t) {
		const av = { tid, name: info.name, puppet: !!info.puppet, dummy: !!info.dummy, traits: info.traits || null, height: info.height,
			raw: info.pos.slice(), pos: info.pos.slice(), yaw: audienceYaw(), hist: [[t, info.pos.slice()]], vel: [0, 0], stillSince: t,
			seenAt: t, lost: false, dodge: null, lastDodgeEnd: -Infinity, umbrellaUntil: 0, umbrellaAt: t + span() }
		avs.set(tid, av)
		return av
	}
	const span = () => UMBRELLA.everyMin + rng() * (UMBRELLA.everyMax - UMBRELLA.everyMin)

	function lookOf(p, snap) {
		if (p.traits && typeof p.traits === 'object') return p.traits
		for (const c of Array.isArray(snap?.cameras) ? snap.cameras : [])
			for (const q of Array.isArray(c?.persons) ? c.persons : []) if (q && q.world === p.id && q.traits && typeof q.traits === 'object') return q.traits
		return null
	}

	/** A tracking snapshot (`/api/tracking/detections` body) or null (tracking off / unreachable). */
	function ingest(snap, t = now()) {
		const v = venue()
		const sc = v ? [(v.stage.rect[0] + v.stage.rect[2]) / 2, (v.stage.rect[1] + v.stage.rect[3]) / 2] : [0, 0]
		const persons = (Array.isArray(snap?.world?.persons) ? snap.world.persons : [])
			.filter((p) => p && Number.isInteger(p.id) && p.id > 0 && Number.isFinite(p.x) && Number.isFinite(p.y))
			.map((p) => ({ p, x: p.x, z: -p.y }))
			.sort((a, b) => Math.hypot(a.x - sc[0], a.z - sc[1]) - Math.hypot(b.x - sc[0], b.z - sc[1]))
		let want = []
		if (mode.mode === 'auto') want = persons.slice(0, MAX_TARGETS)
		else if (mode.mode === 'ids') want = persons.filter((e) => mode.ids.includes(e.p.id)).slice(0, MAX_TARGETS)
		const seen = new Set()
		for (const { p, x, z } of want) {
			const h = Number.isFinite(p.height) ? Math.max(B.HEIGHT.min, Math.min(B.HEIGHT.max, p.height)) : B.HEIGHT.def
			const pos = [x, floorAt(x, z), z]
			const info = { name: String(p.name || `Presenter ${p.id}`).slice(0, 32), puppet: p.puppet === true, traits: lookOf(p, snap), height: h, pos }
			const av = avs.get(p.id) || make(p.id, info, t)
			Object.assign(av, { name: info.name, puppet: info.puppet, traits: info.traits || av.traits, height: h, raw: pos, seenAt: t, lost: false })
			av.hist.push([t, pos])
			while (av.hist.length > 2 && t - av.hist[1][0] >= VEL_WINDOW) av.hist.shift()
			const dt = t - av.hist[0][0]
			if (dt >= VEL_WINDOW - 100) av.vel = [(pos[0] - av.hist[0][1][0]) / (dt / 1000), (pos[2] - av.hist[0][1][2]) / (dt / 1000)]
			seen.add(p.id)
		}
		const tracked = new Set(persons.map((e) => e.p.id))
		for (const av of [...avs.values()]) {
			if (av.dummy || seen.has(av.tid)) continue
			if (tracked.has(av.tid) || t - av.seenAt >= LOST_MS) avs.delete(av.tid) // still tracked but not a target now: gone at once
			else (av.lost = true), (av.vel = [0, 0])
		}
		const live = [...avs.values()].some((a) => !a.dummy)
		const wantDummy = mode.mode === 'dummy' || !live
		if (wantDummy && !avs.has(0) && v) make(0, { name: 'Stand-in', dummy: true, height: B.HEIGHT.def, pos: V.standInSpot(v) }, t)
		if (!wantDummy) avs.delete(0)
		if (mode.mode === 'dummy') for (const tid of [...avs.keys()]) if (tid !== 0) avs.delete(tid)
	}

	/** Ease every pose by the time since the last tick; start / end umbrellas. */
	function tick(t = now()) {
		const dt = lastTick == null ? 0 : Math.min(0.25, (t - lastTick) / 1000)
		lastTick = t
		const k = 1 - Math.exp(-B.POS_RATE * dt)
		const aud = audienceYaw()
		for (const av of avs.values()) {
			if (av.dummy) {
				const v = venue()
				if (v) av.raw = V.standInSpot(v)
			}
			for (let j = 0; j < 3; j++) av.pos[j] += (av.raw[j] - av.pos[j]) * k
			const sp = Math.hypot(av.vel[0], av.vel[1])
			if (sp >= B.WALK_MIN) {
				av.stillSince = null
				av.yaw += angDiff(av.yaw, Math.atan2(av.vel[0], av.vel[1])) * (1 - Math.exp(-5 * dt))
			} else {
				if (av.stillSince == null) av.stillSince = t
				if (t - av.stillSince >= B.FACE_AFTER * 1000) {
					const d = angDiff(av.yaw, aud)
					av.yaw += Math.sign(d) * Math.min(Math.abs(d), B.FACE_RATE * dt)
				}
			}
			if (av.dodge && t > av.dodge.until) (av.lastDodgeEnd = av.dodge.until), (av.dodge = null)
			if (round && !safe && t >= av.umbrellaAt) {
				av.umbrellaUntil = t + UMBRELLA.ms
				av.umbrellaAt = av.umbrellaUntil + span()
				emit({ t: 'umbrella', tid: av.tid, from: t, until: av.umbrellaUntil })
			}
		}
	}

	/** The pose the referee tests at time t (ms); `ahead` (s): extrapolated by the walking speed (dodge prediction). */
	function pose(av, t = now(), ahead = 0) {
		const amount = B.dodgeAmount(av.dodge, t)
		const off = av.dodge?.kind === 'step' ? [av.dodge.dx[0] * amount, av.dodge.dx[1] * amount] : null
		return { tid: av.tid, x: av.pos[0] + av.vel[0] * ahead, y: av.pos[1], z: av.pos[2] + av.vel[1] * ahead, yaw: av.yaw, height: av.height,
			duck: av.dodge?.kind === 'duck' ? amount : 0, off, umbrella: safe || t < av.umbrellaUntil, facing: venue()?.front?.f }
	}

	/** Every avatar's hit parts at time t: [{ tid, parts }]. */
	function partsAt(t = now(), ahead = 0) {
		return [...avs.values()].map((av) => ({ tid: av.tid, parts: B.worldParts(pose(av, t, ahead)) }))
	}

	/** A predicted hit on `tid`'s `part` at server time `hitAt` from `impact` [x, y, z] → a dodge (announced) or null. */
	function planDodge(tid, part, hitAt, impact, t = now()) {
		const av = avs.get(tid)
		if (!av || av.lost || av.dodge || part === 'umbrella' || hitAt - t < DODGE.leadMs || t - av.lastDodgeEnd < DODGE.gapMs) return null
		if (rng() >= DODGE.chance) return null
		const v = venue()
		const r = v?.front?.r || [1, 0]
		let dodge
		if (part === 'head') dodge = { kind: 'duck', from: hitAt - 300, until: hitAt - 300 + DODGE.duckMs, dx: [0, 0] }
		else {
			const side = (impact[0] - av.pos[0]) * r[0] + (impact[2] - av.pos[2]) * r[1] >= 0 ? -1 : 1
			dodge = { kind: 'step', from: hitAt - 330, until: hitAt - 330 + DODGE.stepMs, dx: [r3(r[0] * side * B.STEP_DX), r3(r[1] * side * B.STEP_DX)] }
		}
		av.dodge = dodge
		emit({ t: 'dodge', tid, kind: dodge.kind, from: dodge.from, until: dodge.until, dx: dodge.dx })
		return dodge
	}

	/** WO-1102 Game World R7 "make way": a friendly side step along the stage towards `dir` [x, z] (the referee rations it). */
	function makeWay(tid, dir, t = now()) {
		const av = avs.get(tid)
		if (!av || av.lost || av.dodge || safe) return null
		const r = venue()?.front?.r || [1, 0]
		const side = dir[0] * r[0] + dir[1] * r[1] >= 0 ? 1 : -1
		const dodge = { kind: 'step', from: t, until: t + DODGE.stepMs, dx: [r3(r[0] * side * B.STEP_DX), r3(r[1] * side * B.STEP_DX)] }
		av.dodge = dodge
		emit({ t: 'dodge', tid, kind: dodge.kind, from: dodge.from, until: dodge.until, dx: dodge.dx })
		return dodge
	}

	return {
		ingest,
		tick,
		partsAt,
		planDodge,
		makeWay,
		/** WO-1101 Game World: the avatar's current dodge ({ kind, from, until, dx }) or null. */
		dodgeOf: (tid) => avs.get(tid)?.dodge || null,
		pose: (tid, t) => (avs.has(tid) ? pose(avs.get(tid), t) : null),
		setMode(m, ids = []) {
			if (!['auto', 'ids', 'dummy'].includes(m)) return false
			mode.mode = m
			mode.ids = m === 'ids' ? ids.filter((x) => Number.isInteger(x) && x > 0).slice(0, MAX_TARGETS) : []
			return true
		},
		mode: () => ({ mode: mode.mode, ids: mode.ids.slice() }),
		setSafe(on) {
			safe = !!on
		},
		/** A round starts (umbrellas scheduled from now) / ends (none). */
		setRound(on, t = now()) {
			round = !!on
			for (const av of avs.values()) (av.umbrellaAt = t + span()), (av.umbrellaUntil = 0)
		},
		/** state.targets */
		list() {
			return [...avs.values()].sort((a, b) => a.tid - b.tid).map((av) => ({ tid: av.tid, name: av.name, puppet: av.puppet, dummy: av.dummy, lost: av.lost,
				height: r3(av.height), look: av.traits ? { ...av.traits } : null }))
		},
		/** `w.av` tuples [tid, x, y, z, yaw, height, flags]; flags 1 walking, 2 lost, 4 stand-in, 8 umbrella. */
		wire(t = now()) {
			return [...avs.values()].map((av) => {
				const f = (Math.hypot(av.vel[0], av.vel[1]) >= B.WALK_MIN ? 1 : 0) | (av.lost ? 2 : 0) | (av.dummy ? 4 : 0) | (safe || t < av.umbrellaUntil ? 8 : 0)
				return [av.tid, r3(av.pos[0]), r3(av.pos[1]), r3(av.pos[2]), r3(av.yaw), r3(av.height), f]
			})
		},
		count: () => avs.size,
		tids: () => [...avs.keys()],
		vel: (tid) => (avs.has(tid) ? avs.get(tid).vel.slice() : null),
		has: (tid) => avs.has(tid),
		clear() {
			avs.clear()
			lastTick = null
		},
	}
}

module.exports = { createPresenters, LOST_MS, DODGE, UMBRELLA }
