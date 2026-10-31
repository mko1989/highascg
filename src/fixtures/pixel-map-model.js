'use strict'

/**
 * WO-807 — region-to-fixture-pixel mappings: `project.pixelMappings` (a SERVER-owned top-level project key, written
 * only by POST /api/fixtures/pixelmap — src/engine/project-client-slices.js) — and the pixel layout of a patched
 * fixture. Pure.
 *
 *   pixelMappings: [{ id, enabled (default true), fixtureId (a patch id, follow-patch.js), pixel (1-based),
 *                     channelNo (Caspar channel), rect { x, y, w, h } (channel pixels), mode "average" | "point",
 *                     colourOrder "auto" | letters of r g b w a c m y (one per DMX channel of the pixel, DMX order) }]
 *
 * Pixels of a fixture come from its GDTF mode (`fx.gdtf.channels`, gdtf-patch.js applyType): every geometry that carries
 * colour channels is one pixel, in DMX order of its first channel. Pixel Line IP "Mode11 70DMX": pixels 1–16 are the RGB
 * cells `Array 109`…`124` (offsets 5–52, stride 3), 17–32 the white segments `Array 125`…`140` (offsets 53–68).
 * Colour → DMX (same rules as the legacy sampling-worker.js extractColors): r g b raw; with a w in the same pixel,
 * w = min(r, g, b) and r g b lose it; a (amber) = min(r, g) / 2; c m y = 255 − r g b; any other colour emitter (lime,
 * UV …) of a mapped pixel is written 0 so it does not tint. 16-bit channels scale to their resolution, big-endian.
 */

const MAX_MAPPINGS = 4096
const MODES = ['average', 'point']
const ORDER_RE = /^[rgbwacmy]{1,16}$/

/** GDTF colour attribute → component letter; '0' = an emitter the map drives dark; null = not a colour channel. */
function compOf(attribute) {
	const a = String(attribute || '')
	if (a === 'ColorAdd_R' || a === 'ColorRGB_Red') return 'r'
	if (a === 'ColorAdd_G' || a === 'ColorRGB_Green') return 'g'
	if (a === 'ColorAdd_B' || a === 'ColorRGB_Blue') return 'b'
	if (a === 'ColorAdd_W' || a === 'ColorAdd_WW' || a === 'ColorAdd_CW') return 'w'
	if (a === 'ColorAdd_RY') return 'a'
	if (a === 'ColorSub_C') return 'c'
	if (a === 'ColorSub_M') return 'm'
	if (a === 'ColorSub_Y') return 'y'
	if (/^Color(Add|RGB)_/.test(a)) return '0'
	return null
}

/** fx (normalized patch entry) → [{ pixel, geometry, order, channels: [{ offsets, res, comp }] }]; [] when untyped. */
function pixelsOf(fx) {
	const groups = new Map()
	for (const c of fx?.gdtf?.channels || []) {
		if (!c.offsets?.length) continue
		const comp = compOf(c.attribute)
		if (!comp) continue
		if (!groups.has(c.geometry)) groups.set(c.geometry, [])
		groups.get(c.geometry).push({ offsets: c.offsets, res: c.res || c.offsets.length, comp })
	}
	const out = []
	for (const [geometry, channels] of groups) {
		if (!channels.some((c) => c.comp !== '0')) continue
		channels.sort((a, b) => a.offsets[0] - b.offsets[0])
		out.push({ geometry, channels, order: channels.map((c) => (c.comp === '0' ? '-' : c.comp)).join('') })
	}
	out.sort((a, b) => a.channels[0].offsets[0] - b.channels[0].offsets[0])
	return out.map((p, i) => ({ pixel: i + 1, ...p }))
}

/** Absolute 1-based DMX slots of a pixel (address + offset − 1). */
function slotsOf(fx, px) {
	return px.channels.flatMap((c) => c.offsets.map((o) => fx.address + o - 1))
}

const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN)

/** One raw entry → a normalized mapping (types coerced; validity is checkMapping's job). */
function normalizeMapping(raw, i) {
	const o = raw && typeof raw === 'object' ? raw : {}
	const r = o.rect && typeof o.rect === 'object' ? o.rect : {}
	const order = String(o.colourOrder ?? 'auto').trim().toLowerCase()
	return {
		id: String(o.id || `pm${i + 1}`).slice(0, 64),
		enabled: o.enabled !== false,
		fixtureId: String(o.fixtureId ?? ''),
		pixel: int(o.pixel ?? 1),
		channelNo: int(o.channelNo),
		rect: { x: int(r.x ?? 0), y: int(r.y ?? 0), w: int(r.w), h: int(r.h) },
		mode: MODES.includes(o.mode) ? o.mode : o.mode == null ? 'average' : String(o.mode),
		colourOrder: order || 'auto',
	}
}

/** Stored slice → normalized list (junk entries keep their place so ids stay stable; ids made unique). */
function normalizeMappings(list) {
	const src = Array.isArray(list) ? list.slice(0, MAX_MAPPINGS) : []
	const seen = new Set()
	return src.map((raw, i) => {
		const m = normalizeMapping(raw, i)
		while (seen.has(m.id)) m.id += '_'
		seen.add(m.id)
		return m
	})
}

/**
 * Why mapping m cannot be output, or null. → { problem, fx, px }.
 * @param {{ fixtures: object[], resolutionOf: (ch: number) => ({ w, h } | null) }} env
 */
function checkMapping(m, { fixtures, resolutionOf }) {
	const fx = (fixtures || []).find((f) => f.id === m.fixtureId)
	const fail = (problem) => ({ problem, fx: fx || null, px: null })
	if (!fx) return fail(`fixture "${m.fixtureId}" is not in the patch`)
	if (fx.problem) return fail(`fixture "${fx.name}": ${fx.problem}`)
	if (!fx.gdtf) return fail(`fixture "${fx.name}" has no GDTF type — its pixels are unknown`)
	const pixels = pixelsOf(fx)
	if (!pixels.length) return fail(`fixture "${fx.name}" has no colour pixels in mode "${fx.mode}"`)
	if (!(m.pixel >= 1 && m.pixel <= pixels.length)) return fail(`pixel ${m.pixel} outside 1…${pixels.length} of "${fx.name}"`)
	const px = pixels[m.pixel - 1]
	if (!MODES.includes(m.mode)) return fail(`mode "${m.mode}" is not average | point`)
	if (m.colourOrder !== 'auto') {
		if (!ORDER_RE.test(m.colourOrder)) return fail(`colourOrder "${m.colourOrder}" is not auto or letters of rgbwacmy`)
		if (m.colourOrder.length !== px.channels.length) {
			return fail(`colourOrder "${m.colourOrder}" has ${m.colourOrder.length} letters, pixel ${m.pixel} has ${px.channels.length} channels`)
		}
	}
	if (!(m.channelNo >= 1 && m.channelNo <= 99)) return fail(`channelNo ${m.channelNo} is not 1…99`)
	const res = resolutionOf(m.channelNo)
	if (!res) return fail(`channel ${m.channelNo} is not running in Caspar`)
	const { x, y, w, h } = m.rect
	if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0 || x + w > res.w || y + h > res.h) {
		return fail(`rect ${x},${y} ${w}×${h} is not inside channel ${m.channelNo} (${res.w}×${res.h})`)
	}
	return { problem: null, fx, px }
}

/**
 * Strict check for a write (POST): every entry valid, ids unique, one mapping per fixture pixel.
 * → { ok: true, mappings } | { ok: false, errors: [{ index, id, error }] }
 */
function validateMappings(list, env) {
	if (!Array.isArray(list)) return { ok: false, errors: [{ index: -1, id: null, error: 'mappings must be an array' }] }
	if (list.length > MAX_MAPPINGS) return { ok: false, errors: [{ index: -1, id: null, error: `more than ${MAX_MAPPINGS} mappings` }] }
	const errors = []
	const ids = new Set()
	const targets = new Map()
	const mappings = list.map((raw, i) => {
		const m = normalizeMapping(raw, i)
		if (ids.has(m.id)) errors.push({ index: i, id: m.id, error: `duplicate id "${m.id}"` })
		ids.add(m.id)
		const { problem } = checkMapping(m, env)
		if (problem) errors.push({ index: i, id: m.id, error: problem })
		const t = `${m.fixtureId}#${m.pixel}`
		if (m.enabled && targets.has(t)) errors.push({ index: i, id: m.id, error: `pixel ${m.pixel} of "${m.fixtureId}" is already mapped by "${targets.get(t)}"` })
		else if (m.enabled) targets.set(t, m.id)
		return m
	})
	return errors.length ? { ok: false, errors } : { ok: true, mappings }
}

/** [r, g, b] 0–255 (floats welcome) → one 0–255 value per component letter, unrounded (WO-893: writePixel's scaling rounds). */
function componentValues(rgb, comps) {
	const [r, g, b] = rgb
	const extract = comps.includes('w') && /[rgb]/.test(comps)
	const w = Math.min(r, g, b)
	const v = { r: extract ? r - w : r, g: extract ? g - w : g, b: extract ? b - w : b, w, a: Math.min(r, g) * 0.5,
		c: 255 - r, m: 255 - g, y: 255 - b, 0: 0, '-': 0 }
	return [...comps].map((k) => v[k] ?? 0)
}

/**
 * Write pixel px of fx (rgb, or black when rgb is null) into a 512-byte universe buffer. → [{ slot (1-based), value }].
 * @param {string} [order] colourOrder override ('auto' = the GDTF attributes)
 */
function writePixel(buf, fx, px, rgb, order = 'auto') {
	const comps = order && order !== 'auto' ? order : px.channels.map((c) => c.comp).join('')
	const vals = componentValues(rgb || [0, 0, 0], comps)
	const out = []
	px.channels.forEach((c, i) => {
		const max = 256 ** c.res - 1
		const dmx = Math.round((vals[i] * max) / 255)
		const n = c.offsets.length
		for (let k = 0; k < n; k++) {
			const at = fx.address - 1 + c.offsets[k] - 1
			if (at < 0 || at >= 512) continue
			buf[at] = Math.floor(dmx / 256 ** (n - 1 - k)) & 0xff
			out.push({ slot: at + 1, value: buf[at] })
		}
	})
	return out
}

module.exports = { MAX_MAPPINGS, compOf, pixelsOf, slotsOf, normalizeMapping, normalizeMappings, checkMapping,
	validateMappings, componentValues, writePixel }
