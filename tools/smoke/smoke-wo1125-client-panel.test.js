'use strict'

/**
 * WO-1125 — self-service session panel, client side (work/notes/game-self-service-contract.md §3 / §4): the wire the
 * panel speaks, the view model per game from a state (absent field = control left out), refusal lines, and the panel
 * driven with a tiny fake DOM so Start / bots / set / refusals are checked end to end without a browser.
 */
const { describe, it, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const MOD = path.join(__dirname, '..', '..', 'modules')
const load = (g, f) => import(pathToFileURL(path.join(MOD, g, 'client', f)).href)

/* a minimal element tree: enough of h() for the panel */
class El {
	constructor(tag) { this.tag = tag; this.kids = []; this.cls = new Set(); this.attrs = {}; this.hidden = false; this.disabled = false; this.l = {}; this._t = '' }
	get classList() { return { add: (c) => this.cls.add(c), toggle: (c, on) => (on ? this.cls.add(c) : this.cls.delete(c)) } }
	set textContent(v) { this._t = String(v); this.kids = [] }
	get textContent() { return this._t + this.kids.map((k) => k.textContent).join('') }
	append(...k) { for (const x of k.flat()) if (x) this.kids.push(x) }
	addEventListener(t, f) { this.l[t] = f }
	setAttribute(k, v) { this.attrs[k] = v }
	click() { if (!this.disabled) this.l.click?.() }
	find(pred, out = []) { if (pred(this)) out.push(this); for (const k of this.kids) k.find(pred, out); return out }
}
function h(spec, attrs, ...kids) {
	const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec)
	const el = new El(m[1] || 'div')
	for (const p of m[2].match(/[.#][\w-]+/g) || []) if (p[0] === '.') el.cls.add(p.slice(1))
	if (attrs && !(attrs instanceof El) && typeof attrs === 'object') {
		for (const [k, v] of Object.entries(attrs)) { if (k === 'text') el._t = String(v); else el.attrs[k] = v }
	} else if (attrs != null) kids.unshift(attrs)
	el.append(...kids)
	return el
}
const btn = (root, text) => root.find((e) => e.tag === 'button' && e.textContent === text)[0]
const labelled = (root, aria) => root.find((e) => e.attrs['aria-label'] === aria)[0]

let K
const SPECS = {}
before(async () => {
	K = await load('rc-game', 'ctl-panel.js')
	for (const g of ['rc-game', 'toy-skirmish', 'stage-salad']) SPECS[g] = await load(g, 'session-spec.js')
})

describe('WO-1125 client ctl wire + refusals', () => {
	it('builds exactly the §3 messages', () => {
		assert.deepEqual(K.startMsg(), { t: 'ctl', a: 'start' })
		assert.deepEqual(K.stopMsg(), { t: 'ctl', a: 'stop' })
		assert.deepEqual(K.botsMsg(3, 'hard'), { t: 'ctl', a: 'bots', n: 3, level: 'hard' })
		assert.deepEqual(K.botsMsg(2), { t: 'ctl', a: 'bots', n: 2 })
		assert.deepEqual(K.botsMsg(2, 'nonsense'), { t: 'ctl', a: 'bots', n: 2 })
		assert.deepEqual(K.setMsg('laps', 5), { t: 'ctl', a: 'set', k: 'laps', v: 5 })
	})
	it('one short line per refusal code, none for an ack', () => {
		for (const e of ['host', 'running', 'bad', 'slow', 'paused']) assert.ok(K.refusalLine({ t: 'ctl', ok: false, error: e }).length < 40, e)
		assert.match(K.refusalLine({ t: 'ctl', ok: false, error: 'host' }), /host runs/i)
		assert.match(K.refusalLine({ t: 'ctl', ok: false, error: 'running' }), /round is running/i)
		assert.match(K.refusalLine({ t: 'ctl', ok: false, error: 'slow' }), /too fast/i)
		assert.equal(K.refusalLine({ t: 'ctl', ok: true }), null)
		assert.equal(K.refusalLine({ t: 'state' }), null)
		assert.ok(K.refusalLine({ t: 'ctl', ok: false, error: 'weird' }))
	})
	it('cycle wraps and clamps', () => {
		const o = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
		assert.equal(K.cycle(o, 'c', 1), 'a')
		assert.equal(K.cycle(o, 'a', -1), 'c')
		assert.equal(K.cycle([{ id: 'a' }], 'a', 1), null)
		assert.equal(K.clampInt(99, 1, 20), 20)
	})
})

describe('WO-1125 per-game specs → view model', () => {
	const base = { self: true, phase: 'lobby', players: [{ id: 1 }], maxPlayers: 10, bots: 2, botLevel: 'normal' }
	it('rc: track + laps; track list from the state or the scene', () => {
		const st = { ...base, trackId: 't2', laps: 3, tracks: [{ id: 't1', title: 'One' }, { id: 't2', name: 'Two' }] }
		const v = K.viewModel(SPECS['rc-game'], st, {})
		assert.deepEqual(v.fields.map((f) => f.key), ['track', 'laps'])
		assert.equal(v.fields[0].options[1].title, 'Two')
		const v2 = K.viewModel(SPECS['rc-game'], { ...base, trackId: 't2', laps: 3 }, { scene: { tracks: [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }] } })
		assert.equal(v2.fields[0].options.length, 2)
		assert.deepEqual(K.viewModel(SPECS['rc-game'], { ...base }, {}).fields, [], 'absent data: no controls')
		assert.deepEqual([v.on, v.canStart, v.bots, v.level], [true, true, 2, 'normal'])
	})
	it('sk: arena, mode, minutes', () => {
		const st = { ...base, arenaId: 'a1', mode: 'tdm', limits: { minutes: 7, frags: 20 }, arenas: [{ id: 'a1', title: 'X' }, { id: 'a2', title: 'Y' }] }
		const v = K.viewModel(SPECS['toy-skirmish'], st, {})
		assert.deepEqual(v.fields.map((f) => [f.key, f.val]), [['arena', 'a1'], ['mode', 'tdm'], ['minutes', 7]])
		assert.equal(v.fields[1].options.length, 3)
	})
	it('salad: round seconds as m:ss, teams boolean (false still shown)', () => {
		const v = K.viewModel(SPECS['stage-salad'], { ...base, secs: 90, teams: false }, {})
		assert.deepEqual(v.fields.map((f) => [f.key, f.val]), [['round', 90], ['teams', false]])
		assert.equal(v.fields[0].text, '1:30')
	})
	it('self false or not lobby → not shown / no start', () => {
		assert.equal(K.viewModel(SPECS['rc-game'], { ...base, self: false }, {}).on, false)
		assert.equal(K.viewModel(SPECS['rc-game'], { ...base, self: undefined }, {}).on, false)
		assert.equal(K.viewModel(SPECS['rc-game'], { ...base, phase: 'race' }, {}).canStart, false)
		assert.equal(K.viewModel(SPECS['rc-game'], { ...base, players: [], bots: 0 }, {}).canStart, false)
	})
})

describe('WO-1125 panel behaviour (fake DOM)', () => {
	function make(extra = {}) {
		const sent = []
		const timers = []
		const world = h('a')
		const p = K.createCtlPanel({ h, send: (m) => (sent.push(m), true), spec: SPECS['rc-game'], ctx: () => ({}), worldEl: world, setTimer: (f) => timers.push(f) - 1, clearTimer: () => {}, ...extra })
		return { p, sent, timers }
	}
	const st = (o = {}) => ({ self: true, phase: 'lobby', players: [{ id: 1 }], maxPlayers: 10, bots: 2, botLevel: 'normal', trackId: 't1', laps: 3, tracks: [{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }, { id: 't3', title: 'Three' }, { id: 't4', title: 'Four' }], ...o })

	it('hidden until state.self, then shown in the lobby only; results bar only in results', () => {
		const { p } = make()
		assert.equal(p.el.hidden, true)
		p.update(st({ self: false }))
		assert.equal(p.el.hidden, true)
		p.update(st())
		assert.deepEqual([p.el.hidden, p.resultsEl.hidden], [false, true])
		p.update(st({ phase: 'results' }))
		assert.deepEqual([p.el.hidden, p.resultsEl.hidden], [true, false])
		p.update(st({ phase: 'race' }))
		assert.deepEqual([p.el.hidden, p.resultsEl.hidden], [true, true])
	})
	it('Start / bots / level / laps / track send the §3 frames', () => {
		const { p, sent } = make()
		p.update(st())
		btn(p.el, 'Start').click()
		labelled(p.el, 'More bots').click()
		labelled(p.el, 'Fewer bots').click()
		btn(p.el, 'Hard').click()
		labelled(p.el, 'More Laps').click()
		labelled(p.el, 'Next Track').click()
		assert.deepEqual(sent, [
			{ t: 'ctl', a: 'start' },
			{ t: 'ctl', a: 'bots', n: 3, level: 'normal' },
			{ t: 'ctl', a: 'bots', n: 1, level: 'normal' },
			{ t: 'ctl', a: 'bots', n: 2, level: 'hard' },
			{ t: 'ctl', a: 'set', k: 'laps', v: 4 },
			{ t: 'ctl', a: 'set', k: 'track', v: 't2' },
		])
	})
	it('bounds: laps never leave 1–20, + bots disabled when the room is full', () => {
		const { p } = make()
		p.update(st({ laps: 20, bots: 0 }))
		assert.equal(labelled(p.el, 'More Laps').disabled, true)
		assert.equal(labelled(p.el, 'Fewer bots').disabled, true)
		p.update(st({ laps: 1, players: new Array(10).fill({ id: 1 }) }))
		assert.equal(labelled(p.el, 'Less Laps').disabled, true)
		assert.equal(labelled(p.el, 'More bots').disabled, true)
	})
	it('a refusal shows one line, then clears; an unsent frame says so', () => {
		const { p, timers } = make()
		p.update(st())
		p.refuse({ t: 'ctl', ok: false, error: 'host' })
		assert.match(p.el.find((e) => e.cls.has('ctl-msg'))[0].textContent, /host runs/i)
		timers.at(-1)()
		assert.equal(p.el.find((e) => e.cls.has('ctl-msg'))[0].textContent, '')
		const off = make({ send: () => false })
		off.p.update(st())
		btn(off.p.el, 'Start').click()
		assert.match(off.p.el.find((e) => e.cls.has('ctl-msg'))[0].textContent, /not connected/i)
	})
	it('results: Play again = start, Back to lobby = stop, the World element rides along', () => {
		const { p, sent } = make()
		p.update(st({ phase: 'results' }))
		btn(p.resultsEl, 'Play again').click()
		btn(p.resultsEl, 'Back to lobby').click()
		assert.deepEqual(sent, [{ t: 'ctl', a: 'start' }, { t: 'ctl', a: 'stop' }])
		assert.ok(p.resultsEl.find((e) => e.tag === 'a').length !== 0)
	})
	it('missing fields: the panel still draws Start without crashing', () => {
		const { p } = make()
		p.update({ self: true, phase: 'lobby', players: [{ id: 1 }] })
		assert.equal(p.view.fields.length, 0)
		assert.equal(p.view.bots, null)
		p.update(null)
	})
})
