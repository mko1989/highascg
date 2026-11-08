'use strict'

/**
 * WO-999 step 3 — the library shape of a FragCoord shader (`dialect: 'fragcoord'`), run natively by the Godot Visuals
 * (godot/client/features/visuals/fragcoord_rd.gd), never converted to Shadertoy's conventions:
 *
 *   { id, name, dialect: 'fragcoord', common,
 *     passes: { main: { source, format? }, pass1..pass8: same | null },
 *     audio: { enabled }, opts: { alpha }, values?: { u_x: number | number[] },
 *     source: { site: 'fragcoord', slug, url, title, author, authorUrl, license, licenseUrl, licenseKind,
 *               golf?: { common?, main?, passN? } } }
 *
 * `source` is provenance and attribution — the license an import was gated on (fragcoord-import.js), kept with the
 * shader because attribution licenses (MIT, CC-BY…) require it. Caspar's HTML player only runs Shadertoy configs, so
 * these get no template export (shader-store.js).
 */

const FC_PASS_KEYS = ['main', 'pass1', 'pass2', 'pass3', 'pass4', 'pass5', 'pass6', 'pass7', 'pass8']
const FC_FORMATS = [
	'rgba8',
	'rgba16f',
	'rgba32f',
	'rgb16f',
	'rgb32f',
	'rg16f',
	'rg32f',
	'r16f',
	'r32f',
	'rgb8',
	'rg8',
	'r8',
]
const LICENSE_KINDS = ['open', 'nc', 'none']

const str = (v, max = 400) => String(v ?? '').slice(0, max)

/**
 * @param {any} payload raw config (validated id/name/common by the caller)
 * @param {{ maxSource: number }} lim
 * @returns {{ passes: Record<string, {source: string, format?: string}|null>, values?: object, source?: object }}
 */
function normalizeFragcoordParts(payload, lim) {
	const raw = payload.passes && typeof payload.passes === 'object' ? payload.passes : {}
	/** @type {Record<string, {source: string, format?: string}|null>} */
	const passes = {}
	for (const key of FC_PASS_KEYS) {
		const p = raw[key]
		if (!p || typeof p !== 'object' || !String(p.source || '').trim()) {
			passes[key] = null
			continue
		}
		const source = String(p.source)
		if (source.length > lim.maxSource) throw new Error(`${key} source too large`)
		passes[key] = { source, ...(FC_FORMATS.includes(p.format) ? { format: p.format } : {}) }
	}
	if (!passes.main) throw new Error('main pass source is required')

	/** @type {Record<string, number|number[]>} */
	const values = {}
	if (payload.values && typeof payload.values === 'object') {
		for (const [k, v] of Object.entries(payload.values)) {
			if (!/^[A-Za-z_]\w{0,63}$/.test(k)) continue
			if (typeof v === 'number' && Number.isFinite(v)) values[k] = v
			else if (Array.isArray(v) && v.length <= 4 && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
				values[k] = v
			if (Object.keys(values).length >= 64) break
		}
	}

	const s = payload.source && typeof payload.source === 'object' ? payload.source : null
	let source
	if (s && s.site === 'fragcoord') {
		source = {
			site: 'fragcoord',
			slug: str(s.slug, 40),
			url: str(s.url),
			title: str(s.title, 200),
			author: str(s.author, 100),
			authorUrl: str(s.authorUrl),
			license: str(s.license, 200),
			licenseUrl: str(s.licenseUrl),
			licenseKind: LICENSE_KINDS.includes(s.licenseKind) ? s.licenseKind : 'none',
		}
		if (s.golf && typeof s.golf === 'object') {
			const golf = {}
			for (const k of ['common', ...FC_PASS_KEYS]) {
				if (typeof s.golf[k] === 'string' && s.golf[k].length <= lim.maxSource) golf[k] = s.golf[k]
			}
			if (Object.keys(golf).length) source.golf = golf
		}
	}
	return { passes, ...(Object.keys(values).length ? { values } : {}), ...(source ? { source } : {}) }
}

/** True when any pass or common names `u_audio` — the library's ♪ flag for a FragCoord shader. */
function fragcoordUsesAudio(common, passes) {
	return [common, ...Object.values(passes).map((p) => p?.source || '')].some((t) => /\bu_audio\b/.test(t))
}

module.exports = { FC_PASS_KEYS, FC_FORMATS, normalizeFragcoordParts, fragcoordUsesAudio }
