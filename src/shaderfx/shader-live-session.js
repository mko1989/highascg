'use strict'

/**
 * WO-606 — Shader Live, server side (directive D: the node composes, clients only render). The web
 * editor (client/components/shader-live-editor.js + shader-controls-panel.js) kept the working copy,
 * rewrote GLSL literals and pushed `CG UPDATE` from the browser; here the node holds one working
 * copy per shader id and every operation is an endpoint (routes-shader-live.js).
 *
 * The scanner / control synthesis stay the web's own pure ESM modules (client/lib/shader-controls.js,
 * shader-param-scan.js, shader-param-naming.js), loaded with a dynamic import — one implementation,
 * no drift. Params are addressed by their stable `key` (assignKeys), never by index.
 */

const path = require('path')
const { pathToFileURL } = require('url')
const store = require('./shader-store')
const { liveShaderInstances } = require('./shader-live-instances')

const LIB = path.join(__dirname, '..', '..', 'client', 'lib')
/** @type {Promise<any>|null} */
let _libs = null
function libs() {
	if (!_libs) {
		const load = (f) => import(pathToFileURL(path.join(LIB, f)).href)
		_libs = Promise.all([load('shader-controls.js'), load('shader-param-scan.js'), load('shader-param-naming.js')]).then((m) => Object.assign({}, ...m))
	}
	return _libs
}

/** @type {Map<string, { cfg: any, pristine: { common: string, passes: Record<string, any> }, pristineByKey: Map<string, number[]>, dirty: boolean }>} */
const sessions = new Map()

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
const clone = (o) => JSON.parse(JSON.stringify(o))

/** Operator-label identity (web labelKeyOf): deep keys ride the raw code context, named ones the name. */
const labelKeyOf = (p) => `${p.passKey}:${p.deep ? `deep:${p.context || p.name}` : p.name}`

const manifestOf = (cfg) => ({ pinned: [], hidden: [], presets: [], ...(cfg?.controls || {}) })

function sourceOf(cfg, passKey) {
	return passKey === 'common' ? cfg?.common || '' : cfg?.passes?.[passKey]?.source || ''
}
function setSource(cfg, passKey, src) {
	if (passKey === 'common') cfg.common = src
	else cfg.passes[passKey].source = src
}

/** True while the working copy differs from the library source (still true after a Save-as-child). */
function edited(s) {
	if ((s.cfg.common || '') !== s.pristine.common) return true
	return Object.entries(s.pristine.passes).some(([k, v]) => v && sourceOf(s.cfg, k) !== v.source)
}

/**
 * Open (or reuse) the working copy. An unedited session always re-reads the library, so edits made in
 * another editor (FX modal, web Shader Live) show up; an edited one keeps the operator's live edits.
 * @param {string} id
 */
async function open(id) {
	const sid = String(id || '').toLowerCase()
	const cur = sessions.get(sid)
	if (cur && (cur.dirty || edited(cur))) return cur
	const cfg = await store.getShader(sid)
	if (!cfg) return null
	const L = await libs()
	const s = {
		cfg: clone(cfg),
		pristine: {
			common: cfg.common || '',
			passes: Object.fromEntries(Object.entries(cfg.passes || {}).map(([k, v]) => [k, v ? { source: v.source } : null])),
		},
		pristineByKey: new Map(L.scanShaderCfg(cfg).map((p) => [p.key, [...p.values]])),
		dirty: false,
	}
	sessions.set(sid, s)
	return s
}

/** The advanced fold-away order (web advancedHtml): named params, then deep ones by category, same-base names clustered. */
function advancedGroups(L, params) {
	const groups = [{ title: 'Shader parameters', keys: params.filter((p) => !p.deep).map((p) => p.key) }]
	const byCat = new Map()
	params.forEach((p, i) => {
		if (!p.deep) return
		const cat = p.category || 'Other values'
		if (!byCat.has(cat)) byCat.set(cat, [])
		byCat.get(cat).push({ p, i })
	})
	for (const items of byCat.values()) {
		items.sort((a, b) => {
			const ba = L.baseLabelOf(a.p.name)
			const bb = L.baseLabelOf(b.p.name)
			return ba < bb ? -1 : ba > bb ? 1 : a.i - b.i
		})
	}
	const order = [...L.DEEP_CATEGORY_ORDER, ...[...byCat.keys()].filter((c) => !L.DEEP_CATEGORY_ORDER.includes(c))]
	for (const c of order) if (byCat.has(c)) groups.push({ title: c, keys: byCat.get(c).map(({ p }) => p.key) })
	return groups.filter((g) => g.keys.length)
}

/** What a client renders: key controls (sections / macros / palette), every param, the advanced order. */
async function view(id, s) {
	const L = await libs()
	const params = L.scanShaderCfg(s.cfg)
	const m = manifestOf(s.cfg)
	const labels = s.cfg.paramLabels || {}
	const built = L.buildControls(params, { manifest: m, labelOf: (p) => labels[labelKeyOf(p)] })
	const out = {
		id,
		name: s.cfg.name || id,
		parentId: s.cfg.parentId || null,
		dirty: false,
		sections: L.SECTION_ORDER,
		controls: built.controls.map((c) => (c.widget === 'macro' ? { ...c, factor: L.macroFactor(params, c, s.pristineByKey) } : c)),
		hiddenCount: built.hiddenCount,
		hiddenManual: m.hidden.length,
		presets: m.presets.map((p) => p.name),
		params: params.map((p) => ({
			key: p.key,
			name: p.name,
			label: labels[labelKeyOf(p)] || '',
			passKey: p.passKey,
			deep: !!p.deep,
			kind: p.kind,
			vec: p.vec,
			values: p.values,
			min: p.min,
			max: p.max,
			step: p.step,
			desc: p.desc || '',
			expr: p.expr || '',
			context: p.context || '',
			changed: !same(s.pristineByKey.get(p.key), p.values),
		})),
		advanced: advancedGroups(L, params),
	}
	// Reverting the last change (↺, Original) clears it — literal values, not source text (7.0 vs 7.).
	out.dirty = s.dirty && out.params.some((p) => p.changed)
	return out
}

/** CG UPDATE one pass onto every live instance of the shader; a 403 (PLAY-hosted html) re-hosts via CG ADD once. */
async function pushLive(ctx, id, s, passKeys) {
	const targets = liveShaderInstances(ctx).filter((i) => i.shaderId === id)
	const errors = []
	for (const passKey of passKeys) {
		const payload = passKey === 'common' ? { common: s.cfg.common } : { passes: { [passKey]: { source: sourceOf(s.cfg, passKey) } } }
		errors.push(...(await pushPayload(ctx, targets, payload)))
	}
	return { targets: targets.length, errors }
}

/** AMCP quoted-string escaping: backslashes first, then quotes (web cgUpdateJson). */
const cgJson = (payload) => JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/"/g, '\\"')

async function pushPayload(ctx, targets, payload) {
	const json = cgJson(payload)
	const errors = []
	for (const t of targets) {
		const update = () => ctx.amcp.raw(`CG ${t.channel}-${t.pLayer} UPDATE 0 "${json}"`)
		try {
			await update()
		} catch (e) {
			const msg = String(e?.message || e)
			if (/403|PARAMETER_ILLEGAL/.test(msg) && t.cgName) {
				try {
					await ctx.amcp.raw(`CG ${t.channel}-${t.pLayer} ADD 0 "${t.cgName}" 1 "{}"`)
					await update()
					continue
				} catch (e2) {
					errors.push(`${t.channel}-${t.pLayer}: ${String(e2?.message || e2)}`)
					continue
				}
			}
			errors.push(`${t.channel}-${t.pLayer}: ${msg}`)
		}
	}
	return errors
}

/**
 * Several params at once (one source rewrite + one push per pass). Right-to-left keeps earlier spans valid.
 * @param {Array<{ p: any, next: number[] }>} items
 * @returns {Promise<string[]>} the touched pass keys
 */
async function applyBatch(s, items) {
	const L = await libs()
	const byPass = new Map()
	for (const it of items) {
		if (!byPass.has(it.p.passKey)) byPass.set(it.p.passKey, [])
		byPass.get(it.p.passKey).push(it)
	}
	for (const [passKey, list] of byPass) {
		list.sort((a, b) => b.p.spans[0].start - a.p.spans[0].start)
		let src = sourceOf(s.cfg, passKey)
		for (const { p, next } of list) src = L.rewriteParamValues(src, p, next, { preserveInt: !!p.intLiteral })
		setSource(s.cfg, passKey, src)
	}
	if (byPass.size) s.dirty = true
	return [...byPass.keys()]
}

/** Persist curation (labels / manifest) WITHOUT baking in live edits — the library keeps its pristine source. */
async function persistCuration(s) {
	const lib = (await store.getShader(s.cfg.id)) || s.cfg
	await store.saveShader({ ...lib, controls: s.cfg.controls, paramLabels: s.cfg.paramLabels })
}

module.exports = { libs, open, view, pushLive, pushPayload, applyBatch, persistCuration, labelKeyOf, manifestOf, sourceOf, same, sessions }
