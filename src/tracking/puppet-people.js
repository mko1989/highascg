'use strict'

/**
 * WO-1087 — test puppet PEOPLE: 1–3 simulated tracked persons that need no camera, no solved camera and no detection.
 * Owner, 15.11: "show me an avatar with random look. make it a test puppet. make sure the test puppet doesnt leave the
 * stage".
 *
 * Why here and not the WO-978 marker puppet (puppet.js) or the WO-979 imitated camera (detect-sim.js): the marker
 * puppet is a MARKER (an operator-placed point, no body, no look); the imitated camera makes picture boxes that only
 * become floor persons through a solved camera — the box this was asked on has none. People reach every consumer as
 * WORLD persons (fusion.js shape), so the puppet joins the stream right there: register.js appends `persons()` to the
 * fused world persons of the WS tracking:detections snapshot (previs avatars, WO-1086) and `pinPersons()` to the people
 * the Auto director / spot handover (WO-708 / WO-1085) and the detect pin see. Lanes the director gives them write hub
 * markers like any detected person's; those leave the box as PSN / DMX only through the follow service's own output
 * masters (nothing here turns one on).
 *
 * Each puppet walks the tracking stage (puppet-wander.js: random legs, pauses, turns, hard-clamped inside the stage
 * inset by MARGIN) and wears a random look from the sidecar's palettes, re-rolled by `new_look`. Same safety as the
 * marker puppet: off at every server start (memory only, never in the project), off after `ttl_min`, every one named
 * "TEST puppet n" and flagged `puppet: true`, world ids from ID_BASE (never a fused id).
 *
 * HTTP (routed by register.js): GET /api/tracking/puppet/people → status · POST {enabled?, count? 1–3, seed?,
 * new_look?: true, ttl_min?} → status. A seed makes the walk and the looks repeatable (tests); without one each start
 * draws a fresh one.
 */

const { JSON_HEADERS, parseBodyStrict } = require('../api/response')
const W = require('./puppet-wander')

const PATH = '/api/tracking/puppet/people'
const ID_BASE = 900000 // world ids 900001…900003: far above fusion's (from 1 per detection run)
const HZ = 30
const STAGE_MS = 500 // the stage (project grid) is re-read this often while they walk
const AREA = 0.05 // the "box area" the Auto director ranks people by (fusion.js: largest normalised box)
const DEFAULTS = { count: 1, ttl_min: 120 }

const r3 = (v) => Math.round(v * 1000) / 1000

/**
 * @param {{ stage?: () => object|null, now?: () => number, timers?: { setInterval: Function, clearInterval: Function },
 *           log?: Function, random?: () => number }} deps  stage: project.previs.tracking.grid (or null)
 */
function createPuppetPeople({ stage = () => null, now = Date.now, timers = { setInterval, clearInterval }, log = () => {}, random = Math.random } = {}) {
	let timer = null
	let cfg = { ...DEFAULTS, seed: 0 }
	let walkRng = W.rng(1), lookRng = W.rng(2)
	let people = [] // [{ id, name, walker, look: { traits, height } }]
	let rect = W.stageRect(null)
	let rectAt = -Infinity
	let last = 0, startedAt = 0, steps = 0, stopReason = null

	const live = () => timer !== null

	function readStage(t, force = false) {
		if (!force && t - rectAt < STAGE_MS) return
		rectAt = t
		let g
		try {
			g = stage()
		} catch {
			g = null
		}
		rect = W.stageRect(g)
	}

	function person(k) {
		return { id: ID_BASE + k + 1, name: `TEST puppet ${k + 1}`, walker: W.createWalker(walkRng, rect), look: W.randomLook(lookRng) }
	}

	function resize(n) {
		while (people.length > n) people.pop()
		while (people.length < n) people.push(person(people.length))
	}

	/** One step at time `t` (ms) — the timer's, or a test's. */
	function step(t = now()) {
		if (t - startedAt >= cfg.ttl_min * 60000) return stop('ttl')
		readStage(t)
		const dt = Math.max(0, t - last) / 1000
		last = t
		for (const p of people) W.stepWalker(p.walker, walkRng, rect, dt)
		W.keepApart(people.map((p) => p.walker), rect)
		steps++
	}

	function start(seed) {
		if (timer) timers.clearInterval(timer)
		cfg.seed = Number.isInteger(seed) ? seed >>> 0 : Math.floor(random() * 4294967296)
		walkRng = W.rng(cfg.seed)
		lookRng = W.rng(cfg.seed ^ 0x5bd1e995)
		startedAt = last = now()
		stopReason = null
		steps = 0
		readStage(last, true)
		people = []
		resize(cfg.count)
		timer = timers.setInterval(() => step(), Math.round(1000 / HZ))
		timer?.unref?.()
		log('info', `[puppet-people] ON — ${cfg.count} test ${cfg.count === 1 ? 'person' : 'people'} on the tracking stage, seed ${cfg.seed} (WO-1087)`)
	}

	function stop(reason = 'api') {
		if (!timer) return
		timers.clearInterval(timer)
		timer = null
		stopReason = reason
		people = []
		log('info', `[puppet-people] off (${reason})`)
	}

	/** Partial update → { ok, error? }. */
	function configure(b = {}) {
		const n = Number(b.count)
		if (b.count != null && !(Number.isInteger(n) && n >= 1 && n <= 3)) return { ok: false, error: 'count must be 1, 2 or 3' }
		const ttl = Number(b.ttl_min)
		if (b.ttl_min != null && !(Number.isFinite(ttl) && ttl >= 1 && ttl <= 720)) return { ok: false, error: 'ttl_min must be 1–720' }
		if (b.seed != null && !Number.isInteger(b.seed)) return { ok: false, error: 'seed must be an integer' }
		if (b.count != null) cfg.count = n
		if (b.ttl_min != null) cfg.ttl_min = ttl
		const want = b.enabled == null ? live() : b.enabled === true
		if (!want) stop('api')
		else if (!live() || b.seed != null) start(b.seed)
		else resize(cfg.count)
		if (want && b.new_look === true) for (const p of people) p.look = W.randomLook(lookRng)
		return { ok: true }
	}

	/** World persons (fusion.js persons() shape + puppet, name, traits) for the WS snapshot. */
	function persons() {
		return people.map((p) => ({ id: p.id, x: r3(p.walker.x), y: r3(p.walker.y), vx: r3(p.walker.vx), vy: r3(p.walker.vy), height: p.look.height,
			source: 'puppet', cameras: [], keys: [], score: 1, area: AREA, age_s: 0, puppet: true, name: p.name, traits: { ...p.look.traits } }))
	}

	/** The detect pin / Auto director's person shape (register.js worldPersons). */
	function pinPersons() {
		return people.map((p) => ({ key: `w:${p.id}`, camera: 'world', tid: p.id, world: [r3(p.walker.x), r3(p.walker.y)], score: 1, age_s: 0, area: AREA, puppet: true }))
	}

	function status() {
		const t = now()
		if (!live()) readStage(t, true) // idle: the stage they would walk now
		return { enabled: live(), count: cfg.count, seed: live() ? cfg.seed : null, ttl_min: cfg.ttl_min,
			stage: { lo: rect.lo.map(r3), hi: rect.hi.map(r3), z: rect.z, margin_m: W.MARGIN, degenerate: rect.degenerate },
			people: persons().map(({ id, name, x, y, height, traits }) => ({ id, name, x, y, z: rect.z, height, traits })),
			steps, ends_in_s: live() ? Math.max(0, Math.round((startedAt + cfg.ttl_min * 60000 - t) / 1000)) : null, stopped: live() ? null : stopReason }
	}

	const reply = (code, obj) => ({ status: code, headers: JSON_HEADERS, body: JSON.stringify(obj) })

	/** Route: GET / POST /api/tracking/puppet/people → reply, anything else → null. */
	function handle(method, p, body) {
		return p === '/api/tracking/puppet/people' ? route(method, body) : null // a literal, so tools/dev/gen-api-contract.js lists it
	}

	function route(method, body) {
		if (method === 'GET') return reply(200, status())
		if (method !== 'POST') return reply(405, { error: 'GET or POST' })
		const parsed = parseBodyStrict(body)
		if (!parsed.ok || typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) return reply(400, { error: 'body must be a JSON object' })
		const r = configure(parsed.value)
		return reply(r.ok ? 200 : 400, r.ok ? status() : { ...status(), error: r.error })
	}

	return { configure, step, stop, status, handle, persons, pinPersons, get live() { return live() } }
}

module.exports = { createPuppetPeople, ID_BASE, PATH }
