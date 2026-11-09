/**
 * WO-1009 — show documents in the open project's folder (owner 09.11: "build mvr and glb pdf and xls (excel) doc files
 * upload to project folder"). The folder is the project media folder (`<media>/projects/<slug>`, the Sources "narvil/"
 * folder; project-media-root.js) — so a project rename moves them and project-media sync carries them to the peer box.
 * Only these kinds are listed or accepted; Caspar's media list never shows them (local-media-paths SCAN_EXT).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getProjectMediaRoot } = require('./project-media-root')
const { getMediaIngestBasePath, resolveSafe } = require('./local-media-paths')
const { activeProject } = require('./project-media-gather')

const KINDS = { '.mvr': 'mvr', '.glb': 'model', '.pdf': 'pdf', '.xls': 'sheet', '.xlsx': 'sheet' }
const MIME = {
	'.mvr': 'application/zip',
	'.glb': 'model/gltf-binary',
	'.pdf': 'application/pdf',
	'.xls': 'application/vnd.ms-excel',
	'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const kindOf = (name) => KINDS[path.extname(String(name || '')).toLowerCase()] || ''

/** A plain file name (no folders, no control characters, NFC); '' when nothing usable is left. */
function cleanName(name) {
	const base = path.basename(String(name || '').replace(/\\/g, '/')).normalize('NFC')
	const n = [...base].filter((c) => c.charCodeAt(0) >= 32 && !'<>:"|?*'.includes(c)).join('').trim()
	return n && !n.startsWith('.') ? n : ''
}

/** `{ slug, dir }` of the open project ('' / null when none). */
function folder(ctx) {
	const { slug } = activeProject(ctx)
	if (!slug) return { slug: '', dir: null }
	return { slug, dir: getProjectMediaRoot(ctx.config || {}, null, slug) }
}

/** The project folder's documents (top level only), by name. */
function list(ctx) {
	const { slug, dir } = folder(ctx)
	const files = []
	let ents = []
	try {
		ents = dir ? fs.readdirSync(dir, { withFileTypes: true }) : []
	} catch {}
	for (const e of ents) {
		if (!e.isFile() || e.name.startsWith('.') || !kindOf(e.name)) continue
		try {
			const st = fs.statSync(path.join(dir, e.name))
			files.push({ name: e.name, kind: kindOf(e.name), size: st.size, mtime: st.mtime.toISOString() })
		} catch {}
	}
	files.sort((a, b) => a.name.localeCompare(b.name))
	return { slug, files }
}

/** Absolute path of an existing document `name` in the project folder, else null. */
function resolve(ctx, name) {
	const n = cleanName(name)
	const { dir } = folder(ctx)
	if (!n || !dir || !kindOf(n)) return null
	const p = path.join(dir, n)
	return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null
}

function sha1File(p) {
	const h = crypto.createHash('sha1')
	const fd = fs.openSync(p, 'r')
	try {
		const buf = Buffer.alloc(1 << 20)
		let n
		while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n))
	} finally {
		fs.closeSync(fd)
	}
	return h.digest('hex')
}

/**
 * Move a finished temp file (`tmp`, sha1 `hash`) in as `name`: the same bytes already there → kept as it is
 * (`existed`); another file of that name → "name (2).ext" (never overwrites).
 * @returns {{ name: string, existed: boolean }}
 */
function place(dir, tmp, name, hash) {
	const ext = path.extname(name)
	const stem = name.slice(0, name.length - ext.length)
	for (let i = 1; i < 1000; i++) {
		const n = i === 1 ? name : `${stem} (${i})${ext}`
		const p = path.join(dir, n)
		if (!fs.existsSync(p)) {
			fs.renameSync(tmp, p)
			return { name: n, existed: false }
		}
		if (fs.statSync(p).size === fs.statSync(tmp).size && sha1File(p) === hash) {
			fs.rmSync(tmp, { force: true })
			return { name: n, existed: true }
		}
	}
	fs.rmSync(tmp, { force: true })
	throw new Error(`too many files named ${name}`)
}

/** A temp file in the project folder to stream an upload into: `{ dir, tmp }` or `{ error }`. */
function begin(ctx, name) {
	const n = cleanName(name)
	if (!n || !kindOf(n)) return { error: `not a project document: ${name || '(no name)'} (MVR, GLB, PDF, XLS, XLSX)`, status: 415 }
	const { dir } = folder(ctx)
	if (!dir) return { error: 'No project is open.', status: 409 }
	fs.mkdirSync(dir, { recursive: true })
	return { dir, name: n, tmp: path.join(dir, `.upload-${process.pid}-${crypto.randomBytes(4).toString('hex')}.part`) }
}

/** Store `buf` as `name` (an MVR imported through the previs keeps its file with the show); null when not stored. */
function saveBuffer(ctx, name, buf) {
	const b = begin(ctx, name)
	if (b.error) return null
	fs.writeFileSync(b.tmp, buf)
	return place(b.dir, b.tmp, b.name, crypto.createHash('sha1').update(buf).digest('hex'))
}

function remove(ctx, name) {
	const p = resolve(ctx, name)
	if (!p) return false
	fs.rmSync(p)
	return true
}

const MAX_DOCS = 5000

/**
 * WO-1009 Sources "media only" off: every document under the media root (any folder, not only the open project's),
 * as media-style ids ("projects/narvil/rider.pdf"). Hidden entries are skipped; at most MAX_DOCS.
 * @returns {{ id: string, kind: string, size: number, mtime: string }[]}
 */
function listMediaDocs(config) {
	const root = getMediaIngestBasePath(config || {})
	const out = []
	const walk = (rel, depth) => {
		if (depth > 12 || out.length >= MAX_DOCS) return
		let ents = []
		try {
			ents = fs.readdirSync(rel ? path.join(root, rel) : root, { withFileTypes: true })
		} catch {
			return
		}
		for (const e of ents) {
			if (out.length >= MAX_DOCS || e.name.startsWith('.')) continue
			const id = rel ? `${rel}/${e.name}` : e.name
			if (e.isDirectory()) walk(id, depth + 1)
			else if (e.isFile() && kindOf(e.name)) {
				try {
					const st = fs.statSync(path.join(root, id))
					out.push({ id, kind: kindOf(e.name), size: st.size, mtime: st.mtime.toISOString() })
				} catch {}
			}
		}
	}
	walk('', 0)
	return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** A document under the media root by its id, else null (never outside the root, never another kind). */
function resolveMediaDoc(config, id) {
	const p = resolveSafe(getMediaIngestBasePath(config || {}), String(id || ''))
	return p && kindOf(p) && fs.existsSync(p) && fs.statSync(p).isFile() ? p : null
}

const mimeOf = (name) => MIME[path.extname(name).toLowerCase()] || 'application/octet-stream'

module.exports = { KINDS, kindOf, cleanName, folder, list, resolve, begin, place, saveBuffer, remove, mimeOf, listMediaDocs, resolveMediaDoc }
