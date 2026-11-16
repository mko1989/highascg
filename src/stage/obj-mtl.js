'use strict'

/**
 * WO-1098 — MTL materials and where their pictures are (our own code; MTL is a plain text format).
 *
 *   parseMtl(text) → Map name → { name, kd: [r,g,b] (sRGB 0…1), ks, ns, d (opacity 0…1), mapKd, mapD }
 *   textureIndex(files) → an index of the images we were given (loose files, a folder, a zip, a SketchUp file's
 *     materials/<name>/… folders) — files: [{ rel, read() → Promise<Buffer>, material?, tileM? }]
 *   findTexture(index, mapPath, materialName) → { file, how } | null
 *
 * The lookup order (what a SketchUp export needs — its MTL names "Hilton DT Marcin1/M_20150401_121811_3_.jpg" in a
 * folder that often does not come along):
 *   1. the path as written (back / forward slashes, case-insensitive), relative to the MTL;
 *   2. the file name anywhere in what we were given;
 *   3. the exporter's variant "<name>_N_" → "<name>" (SketchUp bakes a scaled / projected placement into a numbered
 *      copy of the same picture: the base picture is approximately right, not exact);
 *   4. by name, normalised (the exporter writes material names with every character outside [A-Za-z0-9] as "_" and a
 *      leading digit as "M_"): the file stem, or the SketchUp material folder the picture sits in ("Zas_ona3" →
 *      materials/Zasłona3 — whose material.xml points at materials/Zasłona2/Zasłona1.png).
 */

const path = require('path')

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png'])

/** sRGB 0…1 → linear (glTF baseColorFactor is linear). */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

/** A map statement's file: the options (-s u v w, -o …, -bm x, -clamp on …) dropped, the rest is the path (spaces kept). */
function mapPath(arg) {
	const t = String(arg).trim().split(/\s+/)
	const OPT = new Set(['-s', '-o', '-t', '-bm', '-mm', '-clamp', '-blendu', '-blendv', '-boost', '-texres', '-imfchan', '-cc', '-type'])
	const val = (x) => /^-?\d*\.?\d+(e-?\d+)?$/i.test(x) || /^(on|off|[rgbmlz])$/i.test(x)
	let i = 0
	while (i < t.length && OPT.has(t[i].toLowerCase())) {
		i++
		for (let n = 0; n < 3 && i < t.length - 1 && val(t[i]); n++) i++ // up to 3 values, never the last token (the file)
	}
	return t.slice(i).join(' ')
}

function parseMtl(text) {
	const out = new Map()
	let m = null
	const nums = (a) => a.trim().split(/\s+/).slice(0, 3).map(Number).map((x) => (Number.isFinite(x) ? x : 0))
	for (const raw of String(text).split(/\r?\n/)) {
		const s = raw.trim()
		if (!s || s[0] === '#') continue
		const sp = s.indexOf(' ')
		const kw = (sp < 0 ? s : s.slice(0, sp)).toLowerCase()
		const arg = sp < 0 ? '' : s.slice(sp + 1).trim()
		if (kw === 'newmtl') {
			m = { name: arg, kd: [0.8, 0.8, 0.8], ks: [0, 0, 0], ns: null, d: 1, mapKd: '', mapD: '' }
			out.set(arg, m)
		} else if (!m) continue
		else if (kw === 'kd') {
			const k = nums(arg)
			m.kd = [k[0], k.length > 1 ? k[1] : k[0], k.length > 2 ? k[2] : k[0]]
		} else if (kw === 'ks') m.ks = nums(arg)
		else if (kw === 'ns') m.ns = Number(arg) || 0
		else if (kw === 'd') m.d = Math.max(0, Math.min(1, Number(arg.split(/\s+/).pop()) || 0))
		else if (kw === 'tr') m.d = Math.max(0, Math.min(1, 1 - (Number(arg) || 0)))
		else if (kw === 'map_kd') m.mapKd = mapPath(arg)
		else if (kw === 'map_d') m.mapD = mapPath(arg)
	}
	return out
}

/** glTF PBR guesses from Phong: Ns (shininess) → roughness; no Ns → from Ks (SketchUp writes Ks 0.33 everywhere). */
function pbrOf(m) {
	const ks = Math.max(...(m.ks || [0]))
	const roughness = m.ns != null && m.ns > 0 ? Math.sqrt(2 / (m.ns + 2)) : ks > 0.6 ? 0.45 : 0.85
	return { roughness: Math.max(0.05, Math.min(1, Math.round(roughness * 100) / 100)), metallic: 0 }
}

/** The exporter's name normalisation: everything outside [A-Za-z0-9] → "_", a leading digit → "M_" prefix; lower case. */
function norm(name) {
	const s = String(name || '').normalize('NFC').replace(/[^A-Za-z0-9]/g, '_')
	return (/^[0-9]/.test(s) ? 'M_' + s : s).toLowerCase()
}

const variantBase = (stem) => {
	const m = /^(.*)_\d+_$/.exec(stem)
	return m ? m[1] : null
}

/**
 * files: [{ rel (path as given, "/" separated), read, material? (SketchUp material name of the folder), via? }]
 * plus SketchUp material records [{ name, image (rel of its picture), tileM: [w, h] }].
 */
function textureIndex(files, skpMaterials = []) {
	const byRel = new Map(), byBase = new Map(), byNorm = new Map(), tile = new Map()
	const images = files.filter((f) => IMAGE_EXT.has(path.extname(f.rel).toLowerCase()))
	for (const f of images) {
		const rel = f.rel.replace(/\\/g, '/').toLowerCase()
		byRel.set(rel, f)
		const base = path.posix.basename(rel)
		if (!byBase.has(base)) byBase.set(base, f)
		const stem = path.posix.basename(f.rel.replace(/\\/g, '/'), path.extname(f.rel))
		if (!byNorm.has(norm(stem))) byNorm.set(norm(stem), f)
	}
	for (const sm of skpMaterials) {
		const f = byRel.get(String(sm.image || '').replace(/\\/g, '/').toLowerCase())
		if (!f) continue
		byNorm.set(norm(sm.name), f) // a SketchUp material name wins over a file stem
		if (sm.tileM) tile.set(norm(sm.name), sm.tileM)
	}
	return { byRel, byBase, byNorm, tile, count: images.length }
}

/** The picture for `mapKd` of material `matName` → { file, how: 'path'|'name'|'variant'|'material', tileM? } | null. */
function findTexture(index, mapKd, matName = '', mtlDir = '') {
	const p = String(mapKd || '').replace(/\\/g, '/')
	const stem = p ? path.posix.basename(p, path.posix.extname(p)) : ''
	const tryNorm = (n) => (n ? index.byNorm.get(norm(n)) || index.byNorm.get(norm(n).replace(/^m_/, '')) : null)
	const tileOf = (n) => index.tile.get(norm(n)) || index.tile.get(norm(n).replace(/^m_/, ''))
	if (p) {
		const rel = (mtlDir ? path.posix.join(mtlDir, p) : p).toLowerCase()
		let f = index.byRel.get(rel) || index.byRel.get(p.toLowerCase())
		if (f) return { file: f, how: 'path', tileM: tileOf(stem) }
		f = index.byBase.get(path.posix.basename(p).toLowerCase())
		if (f) return { file: f, how: 'name', tileM: tileOf(stem) }
		const vb = variantBase(stem)
		if (vb) {
			const ext = path.posix.extname(p)
			f = index.byBase.get((vb + ext).toLowerCase()) || tryNorm(vb)
			if (f) return { file: f, how: 'variant', tileM: tileOf(vb) }
		}
		f = tryNorm(stem)
		if (f) return { file: f, how: 'material', tileM: tileOf(stem) }
	}
	for (const n of [matName, variantBase(String(matName))]) {
		const f = tryNorm(n)
		if (f) return { file: f, how: p ? 'material' : 'material-name', tileM: tileOf(n) }
	}
	return null
}

/**
 * A SketchUp file's material folders (materials/<name>/material.xml) → [{ name, image (rel), tileM: [w, h] metres }].
 * Only the XML attributes are read (name, the image path, xScale / yScale = the texture's size in inches); the model
 * itself (model.dat) is never parsed.
 */
function skpMaterials(entries) {
	const out = []
	for (const [rel, xml] of entries) {
		const dir = path.posix.dirname(rel)
		const name = /<mat:material\s[^>]*\bname="([^"]*)"/.exec(xml)?.[1]
		const img = /<mat:image\s[^>]*\bpath="([^"]*)"/.exec(xml)?.[1]
		if (!name || !img) continue
		const xs = Number(/\bxScale="([^"]*)"/.exec(xml)?.[1]), ys = Number(/\byScale="([^"]*)"/.exec(xml)?.[1])
		const image = img.startsWith('./') ? path.posix.join(dir, img.slice(2)) : img.replace(/\\/g, '/')
		const unxml = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'")
		out.push({ name: unxml(name), image: unxml(image), tileM: xs > 0 && ys > 0 ? [xs * 0.0254, ys * 0.0254] : null })
	}
	return out
}

module.exports = { parseMtl, pbrOf, norm, mapPath, textureIndex, findTexture, skpMaterials, toLinear, IMAGE_EXT }
