'use strict'

/**
 * WO-1098 — what the operator handed over for a venue import, as one flat list of files: loose files and folders in
 * the staging directory, the files inside any .zip (the natural way to hand over an OBJ with its .mtl and texture
 * folder), and the pictures inside a SketchUp .skp. A .skp is a ZIP container: we read its materials/<name>/ folders —
 * the pictures and each material.xml's name, picture path and texture size — and NEVER its model (model.dat is
 * SketchUp's closed format; the geometry has to come as OBJ).
 *
 *   gather(dir, limits?) → Promise<{ files: [{ rel, size, read() → Promise<Buffer>, stream() → Readable, from: 'file'|'zip'|'skp' }],
 *                            skpMaterials: [{ name, image, tileM }], skps: string[], zips: string[], errors: string[] }>
 *
 * WO-1106 B5 — a zip bomb must not take the worker (and node with it) down: before anything is inflated, a zip / .skp
 * with more than ZIP_LIMITS.entries entries is refused, and the entries we would read count against ZIP_LIMITS.bytes of
 * DECLARED uncompressed size over the whole upload (a zip over it is refused). Every entry is then inflated as a stream
 * that stops at its declared size, so a lying header cannot inflate past the budget either.
 */

const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const { Readable, PassThrough } = require('stream')
const { skpMaterials } = require('./obj-mtl')

const MAX_FILES = 20000
const MAX_DEPTH = 12
const ZIP_LIMITS = { bytes: 2 * 1024 ** 3, entries: 20000 } // per upload (declared, uncompressed) / per zip

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

const GB = (n) => `${Math.round((n / 1024 ** 3) * 10) / 10} GB`

/** An entry's inflated bytes as a stream that errors once it passes the size its header declared (WO-1106 B5). */
function cappedStream(e, cap) {
	const src = e.nodeStream('nodebuffer')
	let got = 0
	let dead = false
	const out = new PassThrough()
	const fail = (err) => {
		if (dead) return
		dead = true
		src.pause()
		src.destroy?.()
		out.destroy(err)
	}
	src.on('data', (d) => {
		if (dead) return
		got += d.length
		if (got > cap) return fail(new Error(`${e.name} unpacks past its declared ${cap} bytes`))
		if (!out.write(d)) src.pause()
	})
	out.on('drain', () => !dead && src.resume())
	src.on('end', () => !dead && out.end())
	src.on('error', fail)
	return out
}

const readAll = (s) => new Promise((resolve, reject) => {
	const parts = []
	s.on('data', (d) => parts.push(d))
	s.on('end', () => resolve(Buffer.concat(parts)))
	s.on('error', reject)
})

/**
 * A ZIP's entries as files (rel = the path inside, prefixed by `prefix`), plus its SketchUp material records.
 * `budget` { left, limits }: the upload's remaining declared bytes — charged here, before anything is inflated.
 */
async function zipFiles(buf, prefix, from, budget = { left: ZIP_LIMITS.bytes, limits: ZIP_LIMITS }) {
	const z = await JSZip.loadAsync(buf, { createFolders: false }) // reads the central directory only
	const all = Object.entries(z.files)
	if (all.length > budget.limits.entries) throw new Error(`${all.length} entries, more than ${budget.limits.entries}`)
	const keep = all.filter(([name, e]) => !(e.dir || name.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')) &&
		!(from === 'skp' && !name.startsWith('materials/'))) // the model (model.dat) is never read
	const sizeOf = (e) => Math.max(0, Number(e._data?.uncompressedSize) || 0)
	const declared = keep.reduce((s, [, e]) => s + sizeOf(e), 0)
	if (declared > budget.left) throw new Error(`unpacks to ${GB(declared)}, over the ${GB(budget.limits.bytes)} an upload may unpack to`)
	budget.left -= declared
	const files = []
	const xml = []
	for (const [name, e] of keep) {
		const cap = sizeOf(e)
		if (from === 'skp' && /\/material\.xml$/i.test(name)) {
			xml.push([name, (await readAll(cappedStream(e, cap))).toString('utf8')])
			continue
		}
		const rel = prefix ? `${prefix}/${name}` : name
		files.push({ rel, size: cap, from, read: () => readAll(cappedStream(e, cap)), stream: () => cappedStream(e, cap) })
	}
	const mats = skpMaterials(xml).map((m) => ({ ...m, image: prefix ? `${prefix}/${m.image}` : m.image }))
	return { files, mats }
}

async function gather(dir, limits = ZIP_LIMITS) {
	const files = []
	const skps = [], zips = [], errors = []
	let skpMats = []
	const budget = { left: limits.bytes, limits }
	for (const rel of walk(dir)) {
		const abs = path.join(dir, rel)
		const ext = path.extname(rel).toLowerCase()
		if (ext === '.zip' || ext === '.skp') {
			try {
				// a zip's own files keep their inner paths (a zipped "Hilton/…" folder stays "Hilton/…"); a .skp's pictures go
				// under "<file>.skp/" so they never shadow a loose texture of the same name
				const r = await zipFiles(fs.readFileSync(abs), ext === '.skp' ? rel : path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), ext.slice(1),
					budget)
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

module.exports = { gather, memoryFiles, ZIP_LIMITS }
