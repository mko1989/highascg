/**
 * WO-1101 — the pure part of the world pages (landing, host, spectator): state normalisation, the spectator's room camera,
 * the server clock, the ticker texts. No DOM, no three.js (node smokes).
 */
import { okModelUrl, cleanName, GAMES } from './world-wire.js'

const fin = (x) => typeof x === 'number' && Number.isFinite(x)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const COLOR = /^#[0-9a-f]{6}$/i

/** A same-origin absolute path (scene JSON / GLB URLs the server hands over): '/…', never '//', '..', '\', a scheme or spaces. */
export function okPath(u) {
	return typeof u === 'string' && u.length > 1 && u.length < 200 && u[0] === '/' && u[1] !== '/' && !u.includes('..') && !/[\\\s]/.test(u) && !/^[^?#]*:/.test(u)
}

/** A colour for a style value ('#rrggbb' only). */
export const safeColor = (c, fb = '#cccccc') => (typeof c === 'string' && COLOR.test(c) ? c : fb)

const PHASE_NAMES = { lobby: 'Lobby', countdown: 'Get ready', race: 'Racing', round: 'Round on', match: 'Match on', results: 'Results', warmup: 'Warm-up', paused: 'Paused' }
/** A phase id → its short display name. */
export const phaseName = (p) => PHASE_NAMES[p] || (typeof p === 'string' && p ? p.slice(0, 16) : '')

function top3(t) {
	if (!Array.isArray(t)) return []
	return t.slice(0, 3).filter((r) => r && typeof r === 'object').map((r) => ({
		name: cleanName(r.name),
		color: safeColor(r.color),
		score: fin(r.score) ? r.score : null,
		label: typeof r.label === 'string' ? cleanName(r.label) : '',
	}))
}

/** One game of `state.games` / `board.games`, sanitised: paths only when they pass okModelUrl. */
export function normGame(g) {
	if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !GAMES.test(g.id)) return null
	const paths = {}
	if (g.paths && typeof g.paths === 'object') for (const k of ['play', 'spectate', 'host', 'state', 'kit']) if (okModelUrl(g.paths[k])) paths[k] = g.paths[k]
	const players = Array.isArray(g.players) ? g.players.length : fin(g.players) ? g.players : 0
	const join = Array.isArray(g.joinUrl) ? g.joinUrl[0] : g.joinUrl
	return {
		id: g.id,
		title: cleanName(g.title) || g.id,
		enabled: g.enabled === true || (g.enabled === undefined && !!g.phase),
		phase: typeof g.phase === 'string' ? g.phase.slice(0, 16) : '',
		players,
		bots: fin(g.bots) ? g.bots : 0,
		endsAt: fin(g.endsAt) ? g.endsAt : null,
		paused: g.paused === true || g.phase === 'paused', // WO-1106 A8: the board's `paused`, or a game whose phase is paused
		paths,
		joinUrl: typeof join === 'string' && join.length < 200 ? join : '',
		top: top3(g.top),
	}
}

/** `state.games` → clean list, ordered as sent (the registry's `order`). */
export const gamesOf = (state) => (Array.isArray(state?.games) ? state.games.slice(0, 8).map(normGame).filter(Boolean) : [])

/** The first running game's kit folder (the RC kit: world.js, stage-fx.js, join-code.js), or null. */
export function kitOf(games) {
	const g = games.find((x) => x.enabled && x.paths.kit) || games.find((x) => x.paths.kit)
	if (!g) return null
	const k = g.paths.kit
	return k.endsWith('/') ? k : k + '/'
}

/** WO-1106 A37 — the wait before boot retry n (1, 2, …): 2 s, doubling, at most 30 s. */
export const bootDelay = (n) => Math.min(30000, 2000 * 2 ** Math.max(0, Math.min(10, (n | 0) - 1)))

/**
 * WO-1106 A37 — run start() until it resolves (an unattended wall page must come back by itself after a failed import):
 * on a failure onFail(err, n, ms), then sleep(ms) and again. The maxTries-th failure → onFail(err, n, null) and false (the page reloads itself,
 * since a browser may keep a failed module import cached for the page's life); true once started.
 */
export async function retryBoot(start, { onFail = () => {}, sleep, maxTries = 6, delay = bootDelay } = {}) {
	for (let n = 1; ; n++) {
		try {
			await start()
			return true
		} catch (e) {
			const ms = n >= maxTries ? null : delay(n)
			onFail(e, n, ms)
			if (ms == null) return false
			await sleep(ms)
		}
	}
}

/** mm:ss of a duration in ms (≥ 0). */
export function fmtClock(ms) {
	if (!fin(ms)) return ''
	const s = Math.max(0, Math.ceil(ms / 1000))
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Server clock from message timestamps: offset ≈ the largest (ts − local receive time) seen lately (the least delayed
 * message), decaying slowly so a clock step is followed. sync(ts, local) per message; now(local) → server ms.
 */
export function createClock() {
	let off = null
	let at = 0
	return {
		sync(ts, local) {
			if (!fin(ts) || ts <= 0 || !fin(local)) return
			const o = ts - local
			if (off == null || o > off || local - at > 10000) off = o
			else off -= Math.min(2, (local - at) * 0.0005) // 0.5 ms per s of drift allowance
			at = local
		},
		now: (local) => (off == null ? null : local + off),
		get synced() {
			return off != null
		},
	}
}

/** A scene's floors (scene JSON `floors`: { id, y, rect: [minX, minZ, maxX, maxZ] }) → floorY(x, z). */
export function floorFn(scene) {
	const floors = Array.isArray(scene?.floors) ? scene.floors.filter((f) => f && fin(f.y) && Array.isArray(f.rect) && f.rect.length === 4 && f.rect.every(fin)) : []
	const hall = floors.find((f) => f.id === 'hall') || floors[0] || null
	return (x, z) => {
		let y = hall ? hall.y : 0
		for (const f of floors) if (f !== hall && x >= f.rect[0] && x <= f.rect[2] && z >= f.rect[1] && z <= f.rect[3]) y = Math.max(y, f.y)
		return y
	}
}

/**
 * The world spectator's wide shot: from the hall side opposite the stage, high enough to see over the tables, looking
 * at the middle between stage and hall; a slow drift of ±DRIFT rad around the target with time t (s).
 * → { eye: [x, y, z], target: [x, y, z] }
 */
export const DRIFT = 0.22
export function roomCam(scene, t = 0) {
	const floors = Array.isArray(scene?.floors) ? scene.floors : []
	const ok = (f) => f && fin(f.y) && Array.isArray(f.rect) && f.rect.length === 4 && f.rect.every(fin)
	const hall = floors.find((f) => f.id === 'hall' && ok(f)) || floors.find(ok) || { y: 0, rect: [-12, -8, 12, 8] }
	const stage = floors.find((f) => f.id === 'stage' && ok(f)) || null
	const c = (r) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2]
	const hc = c(hall.rect)
	const sc = stage ? c(stage.rect) : [hc[0], hall.rect[1]]
	let dx = hc[0] - sc[0]
	let dz = hc[1] - sc[1]
	const L = Math.hypot(dx, dz)
	if (L < 0.5) (dx = 0), (dz = 1)
	else (dx /= L), (dz /= L)
	/* the games play on and around the stage: frame the stage edge (a ballroom is 30 × 60 m — the whole hall from a
	   wall makes every toy a pixel, box finding WO-1101), never higher than 1 m under the ceiling, never outside the hall */
	const sr = stage ? stage.rect : null
	const span = sr ? Math.max(sr[2] - sr[0], sr[3] - sr[1]) : Math.min(hall.rect[2] - hall.rect[0], hall.rect[3] - hall.rect[1]) / 2
	const edge = sr ? [sc[0] + dx * Math.abs(dx) * (sr[2] - sr[0]) / 2, sc[1] + dz * Math.abs(dz) * (sr[3] - sr[1]) / 2] : hc
	const tgt = [edge[0] + dx * 1.5, (stage ? stage.y : hall.y) + 0.3, edge[1] + dz * 1.5]
	const dist = clamp(span * 0.8, 6, 14)
	const top = fin(scene?.bounds?.max?.[1]) ? scene.bounds.max[1] - 1 : hall.y + 6
	const a = Math.sin(t * 0.05) * DRIFT
	const ca = Math.cos(a)
	const sa = Math.sin(a)
	const ex = dx * ca - dz * sa
	const ez = dx * sa + dz * ca
	const m = 1
	const r = hall.rect
	const eye = [clamp(tgt[0] + ex * dist, r[0] + m, r[2] - m), clamp(hall.y + dist * 0.45, hall.y + 2.5, Math.max(hall.y + 2.5, top)), clamp(tgt[2] + ez * dist, r[1] + m, r[3] - m)]
	return { eye, target: tgt }
}

const NOUN = { rc: 'car', sk: 'soldier', salad: 'slingshot' }
const VERB = {
	R1: 'splatted', 'splat-hop': 'splatted', hop: 'splatted', splat: 'splatted',
	R2: 'made a slick under', slick: 'made a slick under',
	R3: 'bowled over', bowl: 'bowled over', bump: 'bowled over', stun: 'bowled over',
	R4: 'sparked', sparks: 'sparked', wobble: 'sparked',
	R5: 'scattered', scatter: 'scattered',
	R6: 'bounced off', bounce: 'bounced off', bonk: 'bounced off',
	R7: 'made way for', step: 'made way for', 'make-way': 'made way for',
	R8: 'rained on', rain: 'rained on',
	R9: 'shone in the spotlight', spot: 'shone in the spotlight',
}
const WHAT = { R1: 'vegetable', R5: 'peas', R6: 'vegetable', R4: 'shot', R3: 'car' }

/** A cross-game event (§6.4 `xev`) → one ticker line, e.g. "Ola's tomato splatted Kuba's car". Plain text (textContent). */
export function eventText(x) {
	if (!x || typeof x !== 'object') return ''
	const k = typeof x.k === 'string' ? x.k.slice(0, 16) : ''
	const by = cleanName(x.by?.name) || (x.by?.g === 'world' ? 'The sky' : 'Someone')
	const to = cleanName(x.to?.name)
	const toG = typeof x.to?.g === 'string' ? x.to.g : ''
	const veg = typeof x.veg === 'string' && /^[a-z]{2,10}$/.test(x.veg) ? x.veg : null
	const verb = VERB[k] || 'met'
	const what = veg || WHAT[k] || ''
	const subject = x.by?.g === 'world' ? by : what ? `${by}'s ${what}` : by
	if (k === 'R9' || k === 'spot') return `${by} shone in the spotlight`
	if (k === 'R7' || k === 'step') return `The presenter made way for ${by}'s car`
	const target = to ? `${to}'s ${NOUN[toG] || 'piece'}` : toG === 'salad' ? 'the presenter' : 'someone'
	return `${subject} ${verb} ${target}`
}

/**
 * WO-1106 A8 — the room part of a `board` message (house 0..1, scene as `hello` carries it), shaped like `hello.state` for
 * the spectator's applyState: only the keys present (an older server's board has neither → {}).
 */
export function boardRoom(m) {
	const out = {}
	if (!m || typeof m !== 'object') return out
	if ((typeof m.house === 'number' && Number.isFinite(m.house)) || typeof m.house === 'boolean') out.house = m.house
	if (m.scene && typeof m.scene === 'object') out.scene = m.scene
	return out
}

/** The ticker line of one game for the strip: "RC · Racing · 1:23 — Ola 3 · Kuba 2 · Ann 1". */
export function boardLine(g, serverNow) {
	const parts = [g.title, g.phase === 'paused' ? '' : phaseName(g.phase)]
	if (g.paused) parts.push('Paused') // and no clock: it does not count down while paused (WO-1106 A8)
	else if (g.endsAt && fin(serverNow) && g.endsAt > serverNow) parts.push(fmtClock(g.endsAt - serverNow))
	const top = g.top.map((r) => `${r.name}${r.label ? ' ' + r.label : r.score != null ? ' ' + r.score : ''}`).join(' · ')
	return parts.filter(Boolean).join(' · ') + (top ? ` — ${top}` : '')
}
