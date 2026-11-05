/**
 * WO-951 — import a NewTek LiveGraphics-style `.gtzip` lower third as a CG Studio template (owner 05.11: "see if we
 * can import this kind of lower thirds templates like the one attached in the gtzip").
 *
 * A .gtzip is a ZIP: document.xml (a WPF/XAML-like `<Composition Width Height>` of `<Layer>`s, each with its own
 * Composition of Rectangle / Image / TextBlock / Ellipse, plus `<Storyboard>`s: the default one plays in,
 * Type="TransitionOut" plays out), resources.xml (image file name → the ZIP entry holding it), the image entries and a
 * thumbnail. The import writes `template/studio/lt-<name>.html` on the lt-engine contract the CG Studio exports use
 * (`LTEngine.init({ titleSel, subtitleSel, animateIn, animateOut })`, GSAP from ../lower-thirds/vendor), with the
 * images under `template/studio/assets/lt-<name>/` — so it is listed, taken and edited like any studio lower third:
 * the largest text is the title (h1), the next the subtitle (div.subtitle p), the inspector fills them.
 *
 * What maps: placement / size, solid fills (#AARRGGBB), Skew, images, text (font, size, weight, alignment, "Shrink"
 * auto-size), Fly / Expand / Fade / Rotate with Delay / Duration / Direction / Interpolation. What does not (reported
 * in `warnings`, never silently): masks, gradients, other storyboards (Page1…), effects other than Skew.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { parseXml, kids, attr } = require('../stage/mvr-gdtf')

const SHAPES = new Set(['Rectangle', 'Ellipse', 'Image', 'TextBlock'])
const FONT_FALLBACK = "'URW Gothic', 'Avant Garde', Futura, 'DejaVu Sans', Arial, sans-serif"
const EASE = {
	CubicEasingIn: 'power2.in',
	CubicEasingOut: 'power2.out',
	CubicEasingInOut: 'power2.inOut',
	Linear: 'none',
}

/** document.xml text: BOM / UTF-16 detected from the bytes; the declaration is dropped (this one says utf-16, is ASCII). */
function decodeXml(buf) {
	let text
	if (buf[0] === 0xff && buf[1] === 0xfe) text = buf.subarray(2).toString('utf16le')
	else if (buf[0] === 0xfe && buf[1] === 0xff) text = Buffer.from(buf.subarray(2)).swap16().toString('utf16le')
	else if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = buf.subarray(3).toString('utf8')
	else if (buf.length > 1 && buf[1] === 0 && buf[0] !== 0) text = buf.toString('utf16le')
	else text = buf.toString('utf8')
	return text.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[^>]*\?>/, '')
}

const nums = (s) =>
	String(s ?? '')
		.split(',')
		.map((v) => Number(v.trim()))
const num = (s, i, d = 0) => (Number.isFinite(nums(s)[i]) ? nums(s)[i] : d)

/** #AARRGGBB / #RRGGBB → CSS; null when not a colour. */
function cssColor(s) {
	const m = /^#([0-9a-f]{8}|[0-9a-f]{6})$/i.exec(String(s || '').trim())
	if (!m) return null
	const h = m[1].length === 8 ? m[1] : 'FF' + m[1]
	const [a, r, g, b] = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16))
	return a === 255 ? '#' + h.slice(2).toLowerCase() : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

/** `<Shape.Prop><Brush Color=…/></Shape.Prop>` → CSS colour, or { gradient: true } for anything but a solid brush. */
function brushOf(node, prop) {
	for (const k of kids(node)) {
		if (k['#name'] !== `${node['#name']}.${prop}`) continue
		for (const b of kids(k)) {
			if (b['#name'] === 'Brush' && cssColor(attr(b, 'Color'))) return cssColor(attr(b, 'Color'))
			return { gradient: b['#name'] }
		}
	}
	return null
}

const slug = (s) =>
	String(s || '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)

/**
 * The composition as a flat element list (canvas px, document order = stacking order) + the storyboards.
 * @param {object} root parsed <Composition>
 */
function readComposition(root, warnings) {
	const out = []
	const used = new Set()
	const domId = (name, kind) => {
		let base = 'gt-' + (slug(name) || kind.toLowerCase())
		let id = base
		for (let n = 2; used.has(id); n++) id = `${base}-${n}`
		used.add(id)
		return id
	}
	const walk = (comp, ox, oy, layer) => {
		for (const n of kids(comp)) {
			const kind = n['#name']
			const x = ox + num(attr(n, 'Location'), 0)
			const y = oy + num(attr(n, 'Location'), 1)
			if (kind === 'Layer') {
				const inner = kids(n).find((k) => k['#name'] === 'Layer.Composition')
				const c = inner && kids(inner).find((k) => k['#name'] === 'Composition')
				if (c) walk(c, x, y, attr(n, 'Name') || layer)
				continue
			}
			if (!SHAPES.has(kind)) {
				if (!/\./.test(kind) && kind !== 'Storyboard')
					warnings.push(`"${attr(n, 'Name') || kind}": ${kind} is not imported`)
				continue
			}
			const name = attr(n, 'Name') || kind
			const el = {
				kind,
				name,
				layer,
				id: domId(name, kind),
				x,
				y,
				w: num(attr(n, 'Dimensions'), 0),
				h: num(attr(n, 'Dimensions'), 1),
			}
			const fill = brushOf(n, 'Fill')
			if (fill && fill.gradient) warnings.push(`"${name}": ${fill.gradient} fill imported as transparent`)
			else if (fill) el.fill = fill
			for (const k of kids(n)) {
				if (k['#name'] === `${kind}.Effects`)
					for (const e of kids(k)) {
						if (attr(e, 'Type') === 'Skew') el.skew = [num(attr(e, 'Angle'), 0), num(attr(e, 'Angle'), 1)]
						else warnings.push(`"${name}": effect ${attr(e, 'Type') || e['#name']} is not imported`)
					}
				if (k['#name'] === `${kind}.Mask`) warnings.push(`"${name}": its mask is not imported (drawn unmasked)`)
				if (k['#name'] === 'Image.Bitmap') {
					const bm = kids(k).find((b) => b['#name'] === 'Bitmap')
					if (bm) el.source = String(attr(bm, 'Source') || '')
				}
			}
			if (kind === 'TextBlock') {
				el.text = String(attr(n, 'Text') ?? '')
				el.font = String(attr(n, 'FontFamily') || '')
				el.size = Number(attr(n, 'FontSize')) || 0
				el.weight = /bold/i.test(String(attr(n, 'FontWeight') || '')) ? 700 : 400
				el.valign = String(attr(n, 'VerticalAlign') || 'Top')
				el.halign = String(attr(n, 'HorizontalAlign') || attr(n, 'TextAlignment') || 'Left')
				el.shrink = /shrink/i.test(String(attr(n, 'AutoSize') || ''))
			}
			out.push(el)
		}
	}
	walk(root, 0, 0, '')
	const boards = { in: [], out: [] }
	for (const sb of kids(root)) {
		if (sb['#name'] !== 'Storyboard') continue
		const type = String(attr(sb, 'Type') || 'In')
		const list = type === 'In' ? boards.in : type === 'TransitionOut' ? boards.out : null
		if (!list) {
			warnings.push(`storyboard "${type}" is not imported (only the in and out animations are)`)
			continue
		}
		for (const a of kids(sb).flatMap((k) => (k['#name'] === 'Storyboard.Animations' ? kids(k) : [])))
			list.push({
				type: a['#name'],
				object: String(attr(a, 'Object') || ''),
				delay: Number(attr(a, 'Delay')) || 0,
				duration: Number(attr(a, 'Duration')) || 0.5,
				direction: String(attr(a, 'Direction') || ''),
				ease: EASE[String(attr(a, 'Interpolation') || '')] || (type === 'In' ? 'power2.out' : 'power2.in'),
			})
	}
	return { elements: out, boards }
}

/** resources.xml → { "folder\\IMAGE1.gif": "<zip entry guid>" }. */
async function readResources(zip) {
	const f = zip.file('resources.xml')
	if (!f) return {}
	const root = await parseXml(decodeXml(Buffer.from(await f.async('uint8array'))))
	const out = {}
	for (const r of kids(root)) {
		const src = kids(r).find((k) => k['#name'] === 'source')
		if (r['#name'] === 'resource' && src && attr(src, 'guid'))
			out[String(attr(r, 'filename'))] = String(attr(src, 'guid'))
	}
	return out
}

/**
 * Parse a .gtzip in memory: the model + the image files it uses.
 * @param {Buffer} buf
 * @returns {Promise<{ width: number, height: number, elements: object[], boards: object, images: Record<string, Buffer>,
 *   thumbnail: Buffer | null, warnings: string[] }>}
 */
async function parseGtzip(buf) {
	const zip = await JSZip.loadAsync(buf)
	const doc = zip.file('document.xml')
	if (!doc) throw new Error('not a .gtzip: no document.xml in it')
	const root = await parseXml(decodeXml(Buffer.from(await doc.async('uint8array'))))
	if (root?.['#name'] !== 'Composition') throw new Error('not a .gtzip: document.xml has no <Composition>')
	const warnings = []
	const { elements, boards } = readComposition(root, warnings)
	const res = await readResources(zip)
	const images = {}
	for (const el of elements) {
		if (el.kind !== 'Image') continue
		const entry = zip.file(res[el.source] || el.source)
		const file = path.basename(String(el.source).replace(/\\/g, '/')).replace(/[^A-Za-z0-9._-]/g, '_') || `${el.id}.png`
		if (!entry) {
			warnings.push(`"${el.name}": image ${el.source} is not in the file`)
			continue
		}
		el.file = file.toLowerCase()
		images[el.file] = Buffer.from(await entry.async('uint8array'))
	}
	const thumb = zip.file('thumbnail.png')
	return {
		width: num(attr(root, 'Width'), 0, 1920) || 1920,
		height: num(attr(root, 'Height'), 0, 1080) || 1080,
		elements,
		boards,
		images,
		thumbnail: thumb ? Buffer.from(await thumb.async('uint8array')) : null,
		warnings,
	}
}

/**
 * Import a .gtzip into `studioDir`: lt-<name>.html + assets/lt-<name>/… (a free id: -2, -3 … when taken).
 * @param {Buffer} buf
 * @param {{ name: string, studioDir: string }} opts
 */
async function importGtzip(buf, opts) {
	const { buildHtml } = require('./gtzip-import-html')
	const model = await parseGtzip(buf)
	const base = 'lt-' + (slug(String(opts.name || '').replace(/\.gtzip$/i, '')) || 'imported')
	let id = base
	for (let n = 2; fs.existsSync(path.join(opts.studioDir, id + '.html')); n++) id = `${base}-${n}`
	const built = buildHtml(model, { id, title: String(opts.name || id) })
	const { html, fields } = built
	model.warnings.push(...built.warnings)
	const assetDir = path.join(opts.studioDir, 'assets', id)
	fs.mkdirSync(assetDir, { recursive: true })
	for (const [f, bytes] of Object.entries(model.images)) fs.writeFileSync(path.join(assetDir, f), bytes)
	if (model.thumbnail) fs.writeFileSync(path.join(assetDir, 'thumbnail.png'), model.thumbnail)
	fs.writeFileSync(path.join(opts.studioDir, id + '.html'), html, 'utf8')
	return {
		ok: true,
		id,
		casparPath: 'studio/' + id,
		htmlPath: 'studio/' + id + '.html',
		fields,
		warnings: model.warnings,
	}
}

module.exports = { decodeXml, cssColor, parseGtzip, importGtzip, slug, FONT_FALLBACK, num }
