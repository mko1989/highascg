/*
 * WO-580 — Shader Live on the player (owner, on show 25.09: speed changes "refresh to the shader" and "I'd like the
 * changes to happen smoothly and not abruptly"). Loaded by player.js like player-smooth.js (a separate file for the
 * 500-line limit); `module.exports` for the smoke.
 *
 * Phase A — the clock rate. Shader Live's "Speed ×" used to rewrite every iTime multiplier and recompile; the picture's
 * phase is iTime × k, so after 20 min on air a 0.5 → 0.475 step jumped ~30 s of animation in one frame. Now the node
 * sends CG UPDATE `{ timeScale }` and this runs iTime at that rate (ShaderToyLite addTime), eased over ~TAU_S: the
 * picture speeds up or slows down from where it is, never jumps, nothing recompiles.
 *
 * Phase B — the glide. A source update that differs from the running source only in float literals inside function
 * bodies compiles ONCE with those literals as uniforms (`_hgG_<pass>[slot]`) that ease from the old values to the new
 * ones; the next update of the same literals (a slider drag) only moves the targets — no recompile. Anything else (a
 * structural edit, an int, a literal in a `const` or global initialiser, a failed compile) takes the old hard path.
 */
;(() => {
	'use strict'

	const TAU_S = 0.35
	const MIN = 0.05
	const MAX = 10
	const SLOTS = 32 // glide uniforms per pass
	const PASS_KEYS = ['image', 'bufferA', 'bufferB', 'bufferC', 'bufferD']
	const SETTERS = {
		image: 'setImage',
		bufferA: 'setBufferA',
		bufferB: 'setBufferB',
		bufferC: 'setBufferC',
		bufferD: 'setBufferD',
	}
	const TOY_KEYS = { image: 'Image', bufferA: 'A', bufferB: 'B', bufferC: 'C', bufferD: 'D' }
	const NUM_RE = /(?<![\w.])(?:\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+[eE][+-]?\d+)(?![\w.])/g

	/** A CG UPDATE value → a rate (anything else → 1). */
	const rateOf = (v) => {
		const n = Number(v)
		return Number.isFinite(n) && n > 0 ? Math.min(MAX, Math.max(MIN, n)) : 1
	}

	/** One frame: the eased rate and the seconds iTime must move beyond real time (negative = slower). */
	const step = (rate, target, dt) => {
		const d = Math.min(0.1, Math.max(0, dt))
		const next = rate + (target - rate) * (1 - Math.exp(-d / TAU_S))
		return { rate: Math.abs(next - target) < 1e-4 ? target : next, extra: (next - 1) * d }
	}

	/** Comments → spaces (same length), so literals and braces inside them do not count. */
	const mask = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '))

	/** The float literals of a source: { at, len, v }, plus the masked text. */
	function parse(src) {
		const m = mask(src)
		const lits = []
		NUM_RE.lastIndex = 0
		for (let x; (x = NUM_RE.exec(m));) lits.push({ at: x.index, len: x[0].length, v: parseFloat(x[0]) })
		return { m, lits }
	}

	/** Same text between the literals → { a, b, changed: literal indices }; anything else → null. */
	function diff(srcA, srcB) {
		const a = parse(srcA)
		const b = parse(srcB)
		if (a.lits.length !== b.lits.length) return null
		const gap = (src, lits, i) =>
			src.slice(i ? lits[i - 1].at + lits[i - 1].len : 0, i < lits.length ? lits[i].at : src.length)
		for (let i = 0; i <= a.lits.length; i++) if (gap(srcA, a.lits, i) !== gap(srcB, b.lits, i)) return null // comments too
		const changed = []
		for (let i = 0; i < a.lits.length; i++) if (a.lits[i].v !== b.lits[i].v) changed.push(i)
		return { a, b, changed }
	}

	/** Can this literal be a uniform: in a function body, not in a `const`; a #define's when all its uses can. */
	function eligible(m, lit) {
		return okAt(m, lit.at, 4)
	}

	/** A #define's value may glide when every use of the macro may (macros in macros: up to `left` deep). */
	function okAt(m, at, left) {
		const lineStart = m.lastIndexOf('\n', at - 1) + 1
		const def = /^\s*#\s*define\s+(\w+)/.exec(m.slice(lineStart, at))
		if (def) {
			if (left <= 0) return false
			const self = lineStart + def[0].length - def[1].length
			const re = new RegExp(`\\b${def[1]}\\b`, 'g')
			for (let x; (x = re.exec(m)); ) if (x.index !== self && !okAt(m, x.index, left - 1)) return false
			return true
		}
		if (/^\s*#/.test(m.slice(lineStart, at))) return false // #if / #ifdef / #undef …
		let depth = 0
		let stmt = 0
		for (let i = 0; i < at; i++) {
			const c = m[i]
			if (c === '{') depth++
			else if (c === '}') depth--
			if (c === '{' || c === '}' || c === ';') stmt = i + 1
		}
		return depth > 0 && !/\bconst\b/.test(m.slice(stmt, at))
	}

	/** The source with the literals in `uni` (index → slot) as `name[slot]`, the array declared on top. */
	function build(src, lits, uni, name) {
		let out = src
		const idx = [...uni.keys()].sort((x, y) => y - x)
		for (const i of idx) out = out.slice(0, lits[i].at) + `${name}[${uni.get(i)}]` + out.slice(lits[i].at + lits[i].len)
		return `uniform float ${name}[${SLOTS}];\n` + out
	}

	/**
	 * The glide for one player: `apply(data)` takes a CG UPDATE's `{ common?, passes? }` (true = handled), `frame(dt)`
	 * eases the uniforms. `toy` needs the WO-580 ShaderToyLite patch (setGlide / compiled).
	 */
	function createGlide({ toy, config, passConfig }) {
		const st = {}
		const set = (key, src) => {
			if (key === 'common') toy.setCommon(src)
			else toy[SETTERS[key]](passConfig(Object.assign({}, config.passes[key], { source: src }), key))
			return key === 'common' ? toy.compiled() : toy.compiled(TOY_KEYS[key])
		}
		const hard = (s, key, src) => {
			s.uni = new Map()
			toy.setGlide(s.name, null)
			set(key, src)
		}
		function one(key, src) {
			const base = key === 'common' ? config.common || '' : config.passes?.[key]?.source
			if (key === 'common') config.common = src
			else if (!config.passes[key]) config.passes[key] = { source: src, channels: [] }
			else config.passes[key].source = src
			if (base == null) return void set(key, src)
			const s = (st[key] = st[key] || {
				name: `_hgG_${key}`,
				uni: new Map(),
				cur: new Float32Array(SLOTS),
				to: new Float32Array(SLOTS),
			})
			const d = base === src ? { changed: [] } : diff(base, src)
			if (!d || d.changed.some((i) => !eligible(d.b.m, d.b.lits[i]))) return hard(s, key, src)
			const fresh = d.changed.filter((i) => !s.uni.has(i))
			if (s.uni.size + fresh.length > SLOTS) return hard(s, key, src)
			for (const i of d.changed) if (s.uni.has(i)) s.to[s.uni.get(i)] = d.b.lits[i].v
			if (!fresh.length) return // a drag on the same literals: new targets, no compile
			for (const i of fresh) {
				const slot = s.uni.size
				s.uni.set(i, slot)
				s.cur[slot] = d.a.lits[i].v
				s.to[slot] = d.b.lits[i].v
			}
			toy.setGlide(s.name, s.cur)
			if (!set(key, build(src, d.b.lits, s.uni, s.name))) hard(s, key, src)
		}
		return {
			apply(data) {
				if (data.common != null) one('common', String(data.common))
				const incoming = data.passes && typeof data.passes === 'object' ? data.passes : {}
				for (const key of PASS_KEYS)
					if (incoming[key] && typeof incoming[key].source === 'string') one(key, incoming[key].source)
				return true
			},
			frame(dt) {
				const k = 1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) / TAU_S)
				for (const s of Object.values(st))
					for (let j = 0; j < s.uni.size; j++) {
						const next = s.cur[j] + (s.to[j] - s.cur[j]) * k
						s.cur[j] = Math.abs(next - s.to[j]) <= 1e-6 * Math.max(1, Math.abs(s.to[j])) ? s.to[j] : next
					}
			},
			/** for the smoke: the per-pass state */
			state: () => st,
		}
	}

	const api = {
		rateOf,
		step,
		parse,
		diff,
		eligible,
		build,
		createGlide,
		/** @param {{ toy: any, target: () => number, config?: any, passConfig?: Function }} opts — `target` reads player.js's latest `timeScale` */
		create({ toy, target, config, passConfig }) {
			let rate = rateOf(target())
			let prev = performance.now()
			const glide = config && typeof toy.setGlide === 'function' ? createGlide({ toy, config, passConfig }) : null
			return {
				/** Per rendered frame (ShaderToyLite draw callback). */
				frame() {
					const now = performance.now()
					const dt = (now - prev) / 1000
					const r = step(rate, rateOf(target()), dt)
					prev = now
					rate = r.rate
					if (r.extra !== 0) toy.addTime(r.extra)
					if (glide) glide.frame(dt)
				},
				rate: () => rate,
				/** A CG UPDATE's source part; false = not handled here (player.js applies it the old way). */
				apply: (data) => (glide ? glide.apply(data) : false),
			}
		},
	}
	if (typeof module !== 'undefined' && module.exports) module.exports = api
	else window.__SHADERFX_LIVE__ = api
})()
