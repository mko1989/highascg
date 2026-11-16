'use strict'

/**
 * WO-1098 — what the operator handed over for a venue import, as one flat list of files: loose files and folders in
 * the staging directory, the files inside any .zip (the natural way to hand over an OBJ with its .mtl and texture
 * folder), and the pictures inside a SketchUp .skp. A .skp is a ZIP container: we read its materials/<name>/ folders —
 * the pictures and each material.xml's name, picture path and texture size — and NEVER its model (model.dat is
 * SketchUp's closed format; the geometry has to come as OBJ).
 *
 *   gather(dir) → Promise<{ files: [{ rel, size, read() → Promise<Buffer>, stream() → Readable, from: 'file'|'zip'|'skp' }],
 *                            skpMaterials: [{ name, image, tileM }], skps: string[], zips: string[], errors: string[] }>
 */

const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { Readable } = require('stream')
const { skpMaterials } = require('./obj-mtl')

const MAX_FILES = 20000
const MAX_DEPTH = 12

function walk(dir) {
	const out = []
	const go = (rel, depth) => {
		if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
		let ents
		try {
			ents = fs.readdirSync(rel ? path.join(dir, rel) : dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of ents) {
			if (e.name.startsWith('.') || e.name === '__MACOSX') continue
			const r = rel ? `${rel}/${e.name}` : e.name
			if (e.isDirectory()) go(r, depth + 1)
			else if (e.isFile()) out.push(r)
		}
	}
	go('', 0)
	return out
}

/** A ZIP's entries as files (rel = the path inside, prefixed by `prefix`), plus its SketchUp material records. */
async function zipFiles(buf, prefix, from) {
	const z = await JSZip.loadAsync(buf, { createFolders: false })
	const files = []
	const xml = []
	for (const [name, e] of Object.entries(z.files)) {
		if (e.dir || name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')) continue
		if (from === 'skp' && !name.startsWith('materials/')) continue // the model (model.dat) is never read
		if (from === 'skp' && /\/material\.xml$/i.test(name)) {
			xml.push([name, await e.async('string')])
			continue
		}
		const rel = prefix ? `${prefix}/${name}` : name
		files.push({ rel, size: e._data?.uncompressedSize || 0, from, read: () => e.async('nodebuffer'),
			stream: () => e.nodeStream('nodebuffer') })
	}
	const mats = skpMaterials(xml).map((m) => ({ ...m, image: prefix ? `${prefix}/${m.image}` : m.image }))
	return { files, mats }
}

async function gather(dir) {
	const files = []
	const skps = [], zips = [], errors = []
	let skpMats = []
	for (const rel of walk(dir)) {
		const abs = path.join(dir, rel)
		const ext = path.extname(rel).toLowerCase()
		if (ext === '.zip' || ext === '.skp') {
			try {
				// a zip's own files keep their inner paths (a zipped "Hilton/…" folder stays "Hilton/…"); a .skp's pictures go
				// under "<file>.skp/" so they never shadow a loose texture of the same name
				const r = await zipFiles(fs.readFileSync(abs), ext === '.skp' ? rel : path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), ext.slice(1))
				files.push(...r.files)
				skpMats = skpMats.concat(r.mats)
				;(ext === '.skp' ? skps : zips).push(rel)
			} catch (e) {
				errors.push(`${rel}: not a readable ${ext === '.skp' ? 'SketchUp (ZIP) file' : 'ZIP'} (${e.message})`)
			}
			continue
		}
		const st = fs.statSync(abs)
		files.push({ rel, size: st.size, from: 'file', read: () => fs.promises.readFile(abs), stream: () => fs.createReadStream(abs) })
	}
	return { files, skpMaterials: skpMats, skps, zips, errors }
}

/** Test helper: files from memory ({ rel: Buffer|string }). */
function memoryFiles(map) {
	return Object.entries(map).map(([rel, data]) => {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data))
		return { rel, size: buf.length, from: 'file', read: async () => buf, stream: () => Readable.from([buf]) }
	})
}

module.exports = { gather, memoryFiles }
