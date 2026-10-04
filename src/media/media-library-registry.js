/**
 * WO-592 A — media library registry: one stable entry ("link") per file under the media root.
 *
 *   data/media-library/registry.json  { version: 1, items: { [id]: Entry } }
 *   Entry = { id, path, dev, ino, size, mtimeMs, addedAt, missingSince?, defaults?, versions? }
 *
 * `path` is media-root relative WITH extension (NFC). Projects keep storing paths (every AMCP emit
 * site stays untouched); the registry is what lets a rename/move — through the UI or outside it
 * (shell mv, Syncthing, USB) — be recognised so media-reference-rewrite can make every look and
 * timeline follow. Reconcile re-links a vanished entry to a new path by (dev, ino), else by a
 * unique (size, mtimeMs) match. Server-written runtime state: listed in .stignore.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getMediaIngestBasePath } = require('./local-media-paths')

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'media-library')
let registryDir = DEFAULT_DIR
/** @type {{ version: number, items: Record<string, object> } | null} */
let cache = null

const nfc = (s) => String(s || '').normalize('NFC').replace(/\\/g, '/')
const keyOf = (p) => nfc(p).toLowerCase()

function registryFile() {
	return path.join(registryDir, 'registry.json')
}

function load() {
	if (cache) return cache
	try {
		const j = JSON.parse(fs.readFileSync(registryFile(), 'utf8'))
		cache = j && typeof j.items === 'object' ? j : { version: 1, items: {} }
	} catch {
		cache = { version: 1, items: {} }
	}
	return cache
}

function save() {
	const reg = load()
	fs.mkdirSync(registryDir, { recursive: true })
	const tmp = registryFile() + '.tmp'
	fs.writeFileSync(tmp, JSON.stringify(reg, null, 1), 'utf8')
	fs.renameSync(tmp, registryFile())
}

function newId() {
	return `m_${crypto.randomBytes(6).toString('hex')}`
}

/** @returns {object|null} */
function getEntryByPath(p) {
	const k = keyOf(p)
	return Object.values(load().items).find((e) => keyOf(e.path) === k) || null
}

function getEntry(id) {
	return load().items[id] || null
}

/**
 * Every file under the media root (dot/AppleDouble files skipped).
 * @returns {Array<{ path: string, dev: number, ino: number, size: number, mtimeMs: number }>}
 */
function walkMediaFiles(base) {
	const out = []
	const walk = (dir, rel, depth) => {
		if (depth > 16) return
		let names
		try {
			names = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return
		}
		for (const d of names) {
			if (d.name.startsWith('.')) continue
			const abs = path.join(dir, d.name)
			const r = rel ? `${rel}/${d.name}` : d.name
			let st
			try {
				st = fs.statSync(abs)
			} catch {
				continue
			}
			if (st.isDirectory()) walk(abs, r, depth + 1)
			else if (st.isFile()) out.push({ path: nfc(r), dev: st.dev, ino: st.ino, size: st.size, mtimeMs: Math.round(st.mtimeMs) })
		}
	}
	walk(base, '', 0)
	return out
}

/**
 * Pure reconcile of a registry against a disk listing (mutates `reg`).
 * @returns {{ added: number, relinked: Array<{ from: string, to: string, id: string }>, missing: number }}
 */
function reconcileRegistry(reg, files, now = Date.now()) {
	const byKey = new Map()
	for (const e of Object.values(reg.items)) byKey.set(keyOf(e.path), e)
	const seen = new Set()
	const unmatched = []
	for (const f of files) {
		const e = byKey.get(keyOf(f.path))
		if (e) {
			Object.assign(e, { dev: f.dev, ino: f.ino, size: f.size, mtimeMs: f.mtimeMs })
			delete e.missingSince
			seen.add(e.id)
		} else unmatched.push(f)
	}
	const gone = Object.values(reg.items).filter((e) => !seen.has(e.id))
	const relinked = []
	let added = 0
	for (const f of unmatched) {
		let e = gone.find((g) => g.ino === f.ino && g.dev === f.dev)
		if (!e) {
			const same = gone.filter((g) => g.size === f.size && g.mtimeMs === f.mtimeMs)
			if (same.length === 1) e = same[0]
		}
		if (e) {
			gone.splice(gone.indexOf(e), 1)
			relinked.push({ from: e.path, to: f.path, id: e.id })
			Object.assign(e, { path: f.path, dev: f.dev, ino: f.ino, size: f.size, mtimeMs: f.mtimeMs })
			delete e.missingSince
		} else {
			const id = newId()
			reg.items[id] = { id, ...f, addedAt: now }
			added++
		}
	}
	for (const e of gone) if (!e.missingSince) e.missingSince = now
	return { added, relinked, missing: gone.length }
}

/** Disk walk + reconcile + save. */
function reconcileWithDisk(config) {
	const reg = load()
	const result = reconcileRegistry(reg, walkMediaFiles(getMediaIngestBasePath(config)))
	if (result.added || result.relinked.length || result.missing) save()
	return result
}

/** Record UI-initiated renames (paths media-root relative). Unknown `from` paths are adopted. */
function recordRenames(renames) {
	const reg = load()
	for (const { from, to } of renames) {
		const e = getEntryByPath(from)
		if (e) e.path = nfc(to)
		else {
			const id = newId()
			reg.items[id] = { id, path: nfc(to), addedAt: Date.now() }
		}
	}
	save()
}

/** Final delete: forget the entry (nothing may re-link to it later). Returns removed entries. */
function forgetPaths(paths) {
	const reg = load()
	const removed = []
	for (const p of paths) {
		const e = getEntryByPath(p)
		if (e) {
			removed.push(e)
			delete reg.items[e.id]
		}
	}
	if (removed.length) save()
	return removed
}

/** Patch an entry's per-file defaults (trim/mute). */
function setDefaults(id, patch) {
	const e = getEntry(id)
	if (!e) return null
	e.defaults = { ...(e.defaults || {}), ...patch }
	save()
	return e
}

function _setRegistryDirForTests(dir) {
	registryDir = dir || DEFAULT_DIR
	cache = null
}

module.exports = {
	load,
	save,
	getEntry,
	getEntryByPath,
	walkMediaFiles,
	reconcileRegistry,
	reconcileWithDisk,
	recordRenames,
	forgetPaths,
	setDefaults,
	_setRegistryDirForTests,
}
