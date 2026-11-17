/**
 * WO-1125 — player self-service session panel, shared by the three games (work/notes/game-self-service-contract.md §3 / §4).
 * The RC client folder is the kit sk and salad already load (`./kit/ctl-panel.js`). Nothing here names a game, a URL or
 * the DOM: `h` (the game's own element helper) and `send` come in as parameters, so node smokes drive it directly.
 *
 *   spec (per game, session-spec.js — the ONE place that knows the state's field names):
 *     selfOn(state)  phaseOf(state)  seats(state) { n, max }  bots(state)  botLevel(state)
 *     FIELDS: [{ key, label, kind: 'step'|'choice', get(state, ctx), options(state, ctx), min, max, step, fmt }]
 *   createCtlPanel({ h, send, spec, ctx, setTimer })  → { el, resultsEl, update(state), refuse(msg), view }
 *     el         the lobby panel (bots, the game's choices, Start) — hidden unless state.self is true
 *     resultsEl  Play again / Back to lobby (+ the World link element passed as `worldEl`) — only in phase results
 * Every control whose data is absent from the state is left out; a refusal `{ t:'ctl', ok:false, error }` shows one line.
 */

export const BOT_LEVELS = ['easy', 'normal', 'hard']
const ERR = {
	host: 'The host runs this game',
	running: 'A round is running',
	bad: 'That did not work',
	slow: 'Too fast — try again',
	paused: 'The game is paused',
	seat: 'Join the game first',
}
/** The one short line for a refusal code. */
export const errorText = (code) => ERR[code] || 'Not possible now'
export const NOT_SENT = 'Not connected'

/* ---------- wire builders (§3) ---------- */
export const startMsg = () => ({ t: 'ctl', a: 'start' })
export const stopMsg = () => ({ t: 'ctl', a: 'stop' })
export const botsMsg = (n, level) => (BOT_LEVELS.includes(level) ? { t: 'ctl', a: 'bots', n: n | 0, level } : { t: 'ctl', a: 'bots', n: n | 0 })
export const setMsg = (k, v) => ({ t: 'ctl', a: 'set', k, v })

const fin = (x) => typeof x === 'number' && Number.isFinite(x)
export const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)))

/** A refusal frame → its line, or null for anything else (an ok:true ack shows nothing). */
export function refusalLine(m) {
	return m && m.t === 'ctl' && m.ok === false ? errorText(m.error) : null
}

/** Next option id when stepping a choice by dir (±1), wrapping; null when there is nothing to step to. */
export function cycle(options, cur, dir) {
	if (!Array.isArray(options) || options.length < 2) return null
	const i = options.findIndex((o) => o.id === cur)
	return options[(((i < 0 ? 0 : i) + dir) % options.length + options.length) % options.length].id
}

/** Plain data of what the panel shows for a state (pure; null fields = control left out). */
export function viewModel(spec, state, ctx = {}) {
	const phase = spec.phaseOf(state)
	const seats = spec.seats(state) || { n: 0, max: 0 }
	const bots = spec.bots(state)
	const fields = []
	for (const f of spec.FIELDS) {
		const val = f.get(state, ctx)
		if (val == null) continue
		if (f.kind === 'choice') {
			const options = (f.options(state, ctx) || []).filter((o) => o && o.id != null)
			if (options.length < 2) continue
			fields.push({ key: f.key, label: f.label, kind: 'choice', val, options: options.map((o) => ({ id: o.id, title: String(o.title ?? o.id).slice(0, 32) })) })
		} else if (fin(val)) fields.push({ key: f.key, label: f.label, kind: 'step', val, min: f.min, max: f.max, step: f.step || 1, text: (f.fmt || String)(val) })
	}
	return {
		on: spec.selfOn(state) === true,
		phase,
		bots: fin(bots) ? bots : null,
		level: BOT_LEVELS.includes(spec.botLevel(state)) ? spec.botLevel(state) : null,
		canMoreBots: !seats.max || seats.n < seats.max,
		canStart: phase === 'lobby' && seats.n > 0,
		fields,
	}
}

export function createCtlPanel({ h, send, spec, ctx = () => ({}), worldEl = null, setTimer = (f, ms) => globalThis.setTimeout(f, ms), clearTimer = (t) => globalThis.clearTimeout(t) }) {
	const msg = h('p.hint.ctl-msg', { role: 'status' })
	const body = h('div.ctl-body')
	const startBtn = h('button.big.go.ctl-start', { type: 'button', text: 'Start' })
	const el = h('div.ctl-panel', h('h2', { text: 'Start a session' }), body, startBtn, msg)
	const againBtn = h('button.big.go', { type: 'button', text: 'Play again' })
	const lobbyBtn = h('button.ghost', { type: 'button', text: 'Back to lobby' })
	const resultsEl = h('div.ctl-results', againBtn, lobbyBtn, worldEl)
	el.hidden = true
	resultsEl.hidden = true
	let view = null
	let key = ''
	let timer = null

	const say = (t) => {
		msg.textContent = t || ''
		if (timer != null) clearTimer(timer)
		timer = t ? setTimer(() => ((timer = null), (msg.textContent = '')), 4000) : null
	}
	const out = (m) => {
		let ok = false
		try {
			ok = send(m) !== false
		} catch {
			/* a closed socket */
		}
		say(ok ? '' : NOT_SENT)
	}
	startBtn.addEventListener('click', () => out(startMsg()))
	againBtn.addEventListener('click', () => out(startMsg()))
	lobbyBtn.addEventListener('click', () => out(stopMsg()))

	const sq = (text, label, onClick, disabled) => {
		const b = h('button.ghost.sq', { type: 'button', text, 'aria-label': label })
		b.disabled = !!disabled
		b.addEventListener('click', onClick)
		return b
	}
	const row = (label, ...kids) => h('div.ctl-row', h('span.ctl-label', { text: label }), h('div.ctl-ctrl', ...kids))

	function paint(v) {
		body.textContent = ''
		if (v.bots != null) {
			const n = v.bots
			body.append(row('Bots', sq('−', 'Fewer bots', () => out(botsMsg(Math.max(0, n - 1), v.level)), n <= 0), h('span.ctl-val', { text: String(n) }), sq('+', 'More bots', () => out(botsMsg(n + 1, v.level)), !v.canMoreBots)))
			if (v.level) {
				const seg = h('div.ctl-seg', { role: 'radiogroup', 'aria-label': 'Bot level' })
				for (const l of BOT_LEVELS) {
					const b = h('button.ghost.small.ctl-opt', { type: 'button', role: 'radio', text: l[0].toUpperCase() + l.slice(1), 'aria-checked': String(l === v.level) })
					b.classList.toggle('on', l === v.level)
					b.addEventListener('click', () => out(botsMsg(n, l)))
					seg.append(b)
				}
				body.append(row('Level', seg))
			}
		}
		for (const f of v.fields) {
			if (f.kind === 'step') {
				const to = (d) => clampInt(f.val + d * f.step, f.min, f.max)
				body.append(row(f.label, sq('−', `Less ${f.label}`, () => out(setMsg(f.key, to(-1))), f.val <= f.min), h('span.ctl-val', { text: f.text }), sq('+', `More ${f.label}`, () => out(setMsg(f.key, to(1))), f.val >= f.max)))
			} else if (f.options.length <= 3) {
				const seg = h('div.ctl-seg', { role: 'radiogroup', 'aria-label': f.label })
				for (const o of f.options) {
					const b = h('button.ghost.small.ctl-opt', { type: 'button', role: 'radio', text: o.title, 'aria-checked': String(o.id === f.val) })
					b.classList.toggle('on', o.id === f.val)
					b.addEventListener('click', () => o.id !== f.val && out(setMsg(f.key, o.id)))
					seg.append(b)
				}
				body.append(row(f.label, seg))
			} else {
				const cur = f.options.find((o) => o.id === f.val)
				const go = (d) => out(setMsg(f.key, cycle(f.options, f.val, d)))
				body.append(row(f.label, sq('‹', `Previous ${f.label}`, () => go(-1)), h('span.ctl-val.wide', { text: cur ? cur.title : '' }), sq('›', `Next ${f.label}`, () => go(1))))
			}
		}
	}

	return {
		el,
		resultsEl,
		get view() {
			return view
		},
		/** A `state` (or welcome state) arrived. */
		update(state) {
			view = viewModel(spec, state || {}, ctx())
			const seated = view.on
			el.hidden = !(seated && view.phase === 'lobby')
			resultsEl.hidden = !(seated && view.phase === 'results')
			startBtn.disabled = !view.canStart
			const k = JSON.stringify([view.bots, view.level, view.canMoreBots, view.fields])
			if (k !== key) {
				key = k
				paint(view)
			}
		},
		/** A `ctl` message: a refusal shows its line. */
		refuse(m) {
			const t = refusalLine(m)
			if (t) say(t)
		},
	}
}
