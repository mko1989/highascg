'use strict'

/**
 * WO-603 slice 1 — ingest files the on-box operator dropped from the desktop (Godot `Window.files_dropped` gives
 * local paths). The server copies from the path instead of the client uploading the bytes over HTTP, and walks
 * dropped folders itself (replaces the web WO-591 `webkitGetAsEntry` walk + one multipart request per folder).
 *
 * Same placement as the web drop (client/components/sources-panel-ingest-logic.js): a dropped file lands in the
 * target folder, a dropped folder lands as `<target>/<folder>/…` with its subfolders; same-name files are replaced
 * (web /api/ingest/upload overwrites) and a `.zip` is unpacked next to itself and removed.
 */

const fs = require('fs')
const path = require('path')
const { resolveSafe, getMediaIngestBasePath } = require('./local-media')
const { getDefaultIngestSubdir } = require('./project-media-root')
const { extractZipSafely } = require('../utils/safe-unzip')

const MAX_FILES = 50000
const COPY_BUF = 1024 * 1024

/** True when `p` is `root` or lies under it. */
function isInside(root, p) {
	const rel = path.relative(root, p)
	return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * Pure-ish (reads the filesystem, writes nothing): the files a drop copies and where each lands, or why not.
 * Symlinks are skipped (never followed out of the dropped tree); the media root itself is never a source.
 * @param {unknown} paths - absolute local paths (Godot files_dropped)
 * @param {string} mediaBase - the media root on disk
 * @returns {{ files: { src: string, rel: string, bytes: number }[], skipped: number } | { status: number, error: string }}
 */
function planLocalIngest(paths, mediaBase) {
	const list = Array.isArray(paths) ? paths.map((p) => String(p || '')).filter(Boolean) : []
	if (!list.length) return { status: 400, error: 'paths[] required' }
	const root = path.resolve(mediaBase)
	const files = []
	let skipped = 0
	const walk = (full, rel) => {
		let st
		try {
			st = fs.lstatSync(full)
		} catch (e) {
			return `${full}: ${e.code || e.message}`
		}
		if (st.isSymbolicLink()) {
			skipped++
		} else if (st.isFile()) {
			if (files.length >= MAX_FILES) return `More than ${MAX_FILES} files in one drop.`
			files.push({ src: full, rel, bytes: st.size })
		} else if (st.isDirectory()) {
			let names
			try {
				names = fs.readdirSync(full).sort()
			} catch (e) {
				return `${full}: ${e.code || e.message}`
			}
			for (const n of names) {
				const err = walk(path.join(full, n), `${rel}/${n.normalize('NFC')}`)
				if (err) return err
			}
		} else {
			skipped++ // sockets, devices, fifos
		}
		return null
	}
	for (const p of list) {
		if (!path.isAbsolute(p)) return { status: 400, error: `"${p}" is not an absolute path.` }
		const full = path.resolve(p)
		if (isInside(root, full) || isInside(full, root)) {
			return { status: 400, error: `"${p}" is inside the media folder (or contains it) — use Move/Copy instead.` }
		}
		const err = walk(full, path.basename(full).normalize('NFC'))
		if (err) return { status: 400, error: err }
	}
	if (!files.length) return { status: 400, error: 'Nothing to ingest — no regular files in the drop.' }
	return { files, skipped }
}

/**
 * `sub` with each segment spelled like an existing directory when one matches case-insensitively: the media tree
 * also lists Caspar CLS ids, which are upper-cased ("PROJECTS/AIRPORT" for projects/airport) — a drop there must not
 * create a second, upper-case folder. Segments with no match keep their spelling (a new folder).
 */
function matchExistingCase(base, sub) {
	let dir = base
	const out = []
	for (const seg of sub.split('/').filter(Boolean)) {
		let hit = seg
		try {
			const want = seg.normalize('NFC').toLowerCase()
			const names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
			hit = names.find((n) => n === seg) || names.find((n) => n.normalize('NFC').toLowerCase() === want) || seg
		} catch {
			/* dir does not exist yet: keep the rest as given */
		}
		out.push(hit)
		dir = path.join(dir, hit)
	}
	return out.join('/')
}

/**
 * The target directory: `folder` (a media-tree folder id, relative to the media root) or the web default
 * (the active project's media folder when project-scoped media is on, else the root).
 * @returns {{ dir: string, folder: string } | { status: number, error: string }}
 */
function resolveTarget(config, folder, store) {
	const base = getMediaIngestBasePath(config)
	const raw = String(folder || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || getDefaultIngestSubdir(config, store)
	if (!raw) return { dir: base, folder: '' }
	const sub = matchExistingCase(base, raw)
	const dir = resolveSafe(base, sub)
	if (!dir) return { status: 400, error: `Invalid target folder "${folder}".` }
	return { dir, folder: path.relative(base, dir).split(path.sep).join('/') }
}

async function copyOne(src, dest, isCancelled, onBytes) {
	await fs.promises.mkdir(path.dirname(dest), { recursive: true })
	const tmp = `${dest}.partial`
	await new Promise((resolve, reject) => {
		const rs = fs.createReadStream(src, { highWaterMark: COPY_BUF })
		const ws = fs.createWriteStream(tmp, { highWaterMark: COPY_BUF })
		rs.on('data', (c) => {
			onBytes(c.length)
			if (isCancelled()) rs.destroy(new Error('Cancelled'))
		})
		rs.on('error', (e) => {
			ws.destroy()
			reject(e)
		})
		ws.on('error', reject)
		ws.on('finish', resolve)
		rs.pipe(ws)
	}).catch((e) => {
		fs.rmSync(tmp, { force: true })
		throw e
	})
	fs.renameSync(tmp, dest)
}

/**
 * Copy a planned drop into `dir`. Progress goes to `report` (throttled by the caller's broadcast).
 * @returns {Promise<{ imported: number, unzipped: number, bytes: number }>}
 */
async function copyPlanned(plan, dir, { isCancelled = () => false, report = () => {} } = {}) {
	const total = plan.files.reduce((a, f) => a + f.bytes, 0)
	let done = 0
	let imported = 0
	let unzipped = 0
	for (let i = 0; i < plan.files.length; i++) {
		if (isCancelled()) throw new Error('Cancelled')
		const f = plan.files[i]
		const dest = resolveSafe(dir, f.rel)
		if (!dest) continue
		await copyOne(f.src, dest, isCancelled, (n) => {
			done += n
			report({ fileRel: f.rel, fileIndex: i, fileTotal: plan.files.length, bytesDone: done, bytesTotal: total })
		})
		imported++
		if (path.extname(dest).toLowerCase() === '.zip') {
			await extractZipSafely(dest, path.dirname(dest))
			fs.rmSync(dest, { force: true })
			unzipped++
		}
	}
	return { imported, unzipped, bytes: done }
}

module.exports = { planLocalIngest, resolveTarget, copyPlanned, isInside, MAX_FILES }
