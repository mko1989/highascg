'use strict'

/**
 * WO-606 — Shader Live operations (one per endpoint; routes-shader-live.js). Ports the behaviour of the
 * web editor's handlers: per-param set / reset / wiggle / rename, the key-controls panel (macro rides,
 * presets, randomize, pin / hide) and Save-as-child. Every op answers with the fresh view.
 */

const store = require('./shader-store')
const S = require('./shader-live-session')
const { liveShaderInstances } = require('./shader-live-instances')

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)

/** Web hueShift (shader-controls-panel.js) — rotate an rgb triple, keep value/saturation. */
function hueShift([r, g, b], deg) {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const d = max - min
	if (d < 1e-6) return [r, g, b]
	let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	h = (h * 60 + deg + 360) % 360
	const s = d / max
	const f = (n) => {
		const k = (n + h / 60) % 6
		return max - max * s * Math.max(0, Math.min(k, 4 - k, 1))
	}
	return [f(5), f(3), f(1)].map((x) => Math.round(x * 10000) / 10000)
}

async function context(s) {
	const L = await S.libs()
	const params = L.scanShaderCfg(s.cfg)
	const byKey = new Map(params.map((p) => [p.key, p]))
	const labels = s.cfg.paramLabels || {}
	const controls = () => L.buildControls(params, { manifest: S.manifestOf(s.cfg), labelOf: (p) => labels[S.labelKeyOf(p)] }).controls
	return { L, params, byKey, controls }
}

/** Items for every param whose target differs from its current values. */
function diffItems(params, target) {
	const items = []
	for (const p of params) {
		const next = target(p)
		if (next && next.length === p.values.length && !S.same(next, p.values)) items.push({ p, next })
	}
	return items
}

/** WO-580: the clock rate that shows Speed × `k` on top of what the time literals already carry. */
function timeScaleFor(L, params, c, pristine, k) {
	const lit = L.macroFactor(params, c, pristine) || 1
	return Math.min(10, Math.max(0.05, k / lit))
}

function macroItems(c, k, byKey, pristine) {
	const items = []
	for (const key of c.keys) {
		const p = byKey.get(key)
		const base = pristine.get(key)?.[0]
		if (p && base) items.push({ p, next: [c.inverse?.includes(key) ? base / k : base * k] })
	}
	return items
}

/**
 * @param {string} op
 * @param {object} b  request body
 * @param {any} s  session
 * @param {{ ctx: object, id: string }} env
 * @returns {Promise<{ items?: Array<{p:any,next:number[]}>, passes?: string[], error?: string, status?: number, extra?: object }>}
 */
async function run(op, b, s, env) {
	const { L, params, byKey, controls } = await context(s)
	const pristine = s.pristineByKey
	const m = S.manifestOf(s.cfg)
	switch (op) {
		case 'set': {
			const items = []
			for (const it of Array.isArray(b.items) ? b.items : [b]) {
				const p = byKey.get(String(it?.key))
				const vals = Array.isArray(it?.values) ? it.values.map(num) : null
				if (!p || !vals || vals.length !== p.values.length || vals.some((v) => v == null)) return { error: `bad param ${it?.key}`, status: 400 }
				items.push({ p, next: vals })
			}
			return { items }
		}
		case 'macro': {
			const c = controls().find((x) => x.id === String(b.control))
			if (!c || c.widget !== 'macro') return { error: 'unknown macro control', status: 400 }
			const k = Math.max(0.05, num(b.factor) ?? 1) // a divisor macro must never hit 0
			// WO-580: Speed rides the player's clock rate — rewriting the iTime multipliers moved the phase by
			// iTime × Δk (the picture teleported, worse the longer it had been on air) and recompiled every step.
			if (c.id === S.SPEED_MACRO) return { timeScale: timeScaleFor(L, params, c, pristine, k) }
			return { items: macroItems(c, k, byKey, pristine) }
		}
		case 'reset': {
			if (b.key != null) return { items: diffItems(params, (p) => (p.key === String(b.key) ? pristine.get(p.key) : null)) }
			if (b.control != null) {
				const c = controls().find((x) => x.id === String(b.control))
				const items = c ? diffItems(params, (p) => (c.keys.includes(p.key) ? pristine.get(p.key) : null)) : []
				return c?.id === S.SPEED_MACRO ? { items, timeScale: 1 } : { items }
			}
			// Reset all: back to the library source verbatim (recovery for a broken shader), every pass pushed.
			s.cfg.common = s.pristine.common
			for (const [k, v] of Object.entries(s.pristine.passes)) if (v && s.cfg.passes?.[k]) s.cfg.passes[k].source = v.source
			s.dirty = false
			return { passes: ['common', ...L.PASS_KEYS.filter((k) => s.cfg.passes?.[k]?.source)], timeScale: 1 }
		}
		case 'preset': {
			if (b.original) return { items: diffItems(params, (p) => pristine.get(p.key)) }
			const v = m.presets.find((x) => x.name === String(b.name))?.v
			if (!v) return { error: 'unknown preset', status: 404 }
			return { items: diffItems(params, (p) => v[p.key] || pristine.get(p.key)) }
		}
		case 'preset-save': {
			const name = String(b.name || '').trim()
			if (!name) return { error: 'name required', status: 400 }
			const v = {}
			for (const p of params) if (pristine.get(p.key) && !S.same(pristine.get(p.key), p.values)) v[p.key] = [...p.values]
			m.presets = [...m.presets.filter((x) => x.name !== name), { name, v }].slice(-16)
			return { manifest: m }
		}
		case 'preset-delete':
			m.presets = m.presets.filter((x) => x.name !== String(b.name))
			return { manifest: m }
		case 'pin': {
			const key = String(b.key)
			if (!byKey.has(key)) return { error: 'unknown param', status: 400 }
			m.hidden = m.hidden.filter((k) => k !== key)
			if (!m.pinned.some((x) => x.key === key)) m.pinned.push({ key })
			return { manifest: m }
		}
		case 'hide':
			m.hidden = [...new Set([...m.hidden, String(b.key)])]
			m.pinned = m.pinned.filter((x) => x.key !== String(b.key))
			return { manifest: m }
		case 'unhide':
			m.hidden = []
			return { manifest: m }
		case 'label': {
			const p = byKey.get(String(b.key))
			if (!p) return { error: 'unknown param', status: 400 }
			s.cfg.paramLabels = s.cfg.paramLabels || {}
			const lbl = String(b.label ?? '').trim()
			if (lbl) s.cfg.paramLabels[S.labelKeyOf(p)] = lbl
			else delete s.cfg.paramLabels[S.labelKeyOf(p)]
			return { curated: true }
		}
		case 'randomize': {
			const rnd = (lo, hi) => lo + Math.random() * (hi - lo)
			const items = []
			let timeScale
			for (const c of controls()) {
				if (c.id === S.SPEED_MACRO) timeScale = timeScaleFor(L, params, c, pristine, rnd(0.6, 1.7))
				else if (c.widget === 'macro') items.push(...macroItems(c, rnd(0.6, 1.7), byKey, pristine))
				const p = byKey.get(c.keys[0])
				if (!p) continue
				if (c.widget === 'color') items.push({ p, next: [...hueShift(p.values.slice(0, 3), rnd(0, 360)), ...p.values.slice(3)] })
				else if (c.widget === 'slider') {
					const base = pristine.get(c.keys[0]) || p.values
					items.push({ p, next: p.values.map((_, i) => Math.min(p.max, Math.max(p.min, Math.round((base[i] * rnd(0.6, 1.6)) / p.step) * p.step))) })
				}
			}
			return { items, timeScale }
		}
		case 'wiggle':
			return wiggle(b, s, env, byKey, L)
		case 'save':
			return saveChild(s)
		default:
			return { error: `unknown op ${op}`, status: 404 }
	}
}

/** Oscillate one value on the PREVIEW instances only (~1.3 s), then restore — never touches the working copy. */
async function wiggle(b, s, env, byKey, L) {
	const p = byKey.get(String(b.key))
	if (!p) return { error: 'unknown param', status: 400 }
	const prv = liveShaderInstances(env.ctx).filter((i) => i.shaderId === env.id && i.isPrv)
	if (!prv.length) return { error: 'Load this shader on preview first', status: 409 }
	const orig = [...p.values]
	const span = Number.isFinite(p.max) && Number.isFinite(p.min) ? p.max - p.min : 0
	const source = S.sourceOf(s.cfg, p.passKey)
	const push = (vals) => {
		const src = L.rewriteParamValues(source, p, vals)
		return S.pushPayload(env.ctx, prv, p.passKey === 'common' ? { common: src } : { passes: { [p.passKey]: { source: src } } })
	}
	try {
		for (let i = 0; i < 8; i++) {
			const phase = Math.sin((i / 7) * Math.PI * 2)
			await push(orig.map((v) => {
				const next = v + (span > 0 ? span * 0.12 : Math.max(0.2, Math.abs(v) * 0.5)) * phase
				return Number.isFinite(p.min) && Number.isFinite(p.max) ? Math.min(p.max, Math.max(p.min, next)) : next
			}))
			await new Promise((r) => setTimeout(r, 150))
		}
	} finally {
		await push(orig)
	}
	return {}
}

/** A save never overwrites the source shader — it lands as a CHILD (`<root>-cN`, parentId = root). */
async function saveChild(s) {
	const rootId = s.cfg.parentId || s.cfg.id
	const ids = new Set((await store.listShaders()).map((x) => x.id))
	let n = 2
	while (ids.has(`${rootId}-c${n}`)) n++
	const baseName = String(s.cfg.name || rootId).replace(/ c\d+$/, '')
	const child = { ...(await bakedSpeed(s)), id: `${rootId}-c${n}`, name: `${baseName} c${n}`, parentId: rootId }
	await store.saveShader(child)
	s.dirty = false
	return { extra: { savedAs: child.id } }
}

/** WO-580: the config with the speed ride baked into the time literals (a saved shader is plain ShaderToy GLSL). */
async function bakedSpeed(s) {
	const k = S.timeScaleOf(s)
	if (k === 1) return s.cfg
	const { L, params, byKey, controls } = await context(s)
	const c = controls().find((x) => x.id === S.SPEED_MACRO)
	if (!c) return s.cfg
	const copy = { cfg: JSON.parse(JSON.stringify(s.cfg)) }
	const lit = L.macroFactor(params, c, s.pristineByKey) || 1
	await S.applyBatch(copy, macroItems(c, lit * k, byKey, s.pristineByKey))
	return copy.cfg
}

module.exports = { run, hueShift }
