/**
 * Local media path resolution and directory scan.
 */
'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')

/** @type {Set<string>} */
const SCAN_EXT = new Set([
	'.mov',
	'.qt',
	'.mp4',
	'.mxf',
	'.mkv',
	'.avi',
	'.webm',
	'.m4v',
	'.mpg',
	'.mpeg',
	'.png',
	'.jpg',
	'.jpeg',
	'.tga',
	'.gif',
	'.bmp',
	'.svg',
	'.wav',
	'.mp3',
	'.aac',
	'.m4a',
	'.flac',
	'.ts',
	'.m2ts',
	'.mts',
])
const HIDDEN_MEDIA_DIRS = new Set(['tb', '.tb'])

function resolveSafe(basePath, filename) {
	if (!basePath || typeof basePath !== 'string') return null
	const cleanFilename = (filename || '')
		.replace(/[<>]/g, '')
		.replace(/\.\./g, '')
		.split(/[/\\]/)
		.filter(Boolean)
		.join(path.sep)
	if (!cleanFilename) return null
	const full = path.resolve(path.join(basePath, cleanFilename))
	const baseResolved = path.resolve(basePath)
	if (full === baseResolved) return null
	const rel = path.relative(baseResolved, full)
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
	return full
}

function getMediaIngestBasePath(config) {
	const p = (config?.local_media_path || '').trim()
	if (p) return path.resolve(p)
	if (os.platform() === 'linux') return '/home/casparcg/highascg/media'
	return path.join(process.cwd(), 'media')
}

function normalizeMediaIdKey(id) {
	return String(id || '')
		.replace(/\\/g, '/')
		.replace(/\/+/g, '/')
}

function findFileByStemUnderDir(dir, stemHint) {
	const want = String(stemHint || '')
		.normalize('NFC')
		.toLowerCase()
	if (!want) return null
	let scanned = 0
	const maxScan = 8000
	const maxDepth = 12
	function walk(d, depth) {
		if (depth > maxDepth || scanned > maxScan) return null
		let entries
		try {
			entries = fs.readdirSync(d, { withFileTypes: true })
		} catch {
			return null
		}
		for (const ent of entries) {
			if (scanned > maxScan) return null
			scanned++
			const full = path.join(d, ent.name)
			if (ent.isDirectory()) {
				if (ent.name.startsWith('.')) continue
				if (HIDDEN_MEDIA_DIRS.has(ent.name.toLowerCase())) continue
				const hit = walk(full, depth + 1)
				if (hit) return hit
			} else if (ent.isFile()) {
				const stem = path.parse(ent.name).name.normalize('NFC').toLowerCase()
				if (stem === want) return full
			}
		}
		return null
	}
	return walk(dir, 0)
}

function resolveMediaFileOnDisk(config, filename) {
	const idNorm = normalizeMediaIdKey(filename).trim()
	if (!idNorm || idNorm.includes('..')) return null
	const rawVariants = [...new Set([idNorm, idNorm.normalize('NFC'), idNorm.normalize('NFD')].filter((s) => s && !s.includes('..')))]
	const seenBase = new Set()
	const candidates = []
	for (const idv of rawVariants) {
		const baseIds = [idv]
		if (/^MEDIA\//i.test(idv)) {
			baseIds.push(idv.replace(/^MEDIA\//i, ''))
		} else {
			baseIds.push('MEDIA/' + idv)
		}
		for (const base of baseIds) {
			if (seenBase.has(base)) continue
			seenBase.add(base)
			const leaf = base.split('/').pop() || base
			candidates.push(base)
			if (!path.extname(leaf)) {
				for (const ext of SCAN_EXT) {
					candidates.push(base + ext)
				}
			}
		}
	}
	const cfg = config || {}
	const projectCandidates = (() => {
		try {
			const pmr = require('./project-media-root')
			return pmr.getProjectMediaResolveCandidates(cfg, idNorm)
		} catch {
			return []
		}
	})()
	const bases = []
	const cfgPath = (cfg.local_media_path || '').trim()
	if (cfgPath) bases.push(path.resolve(cfgPath))
	bases.push(getMediaIngestBasePath(cfg))
	bases.push(getMediaIngestBasePath({ ...cfg, local_media_path: '' }))
	const seenBases = new Set()
	for (const b of bases) {
		const r = path.resolve(b)
		if (seenBases.has(r)) continue
		seenBases.add(r)
		for (const cand of [...projectCandidates, ...candidates]) {
			const fp = resolveSafe(r, cand)
			if (!fp) continue
			try {
				if (!fs.existsSync(fp)) continue
				const st = fs.statSync(fp)
				if (st.isFile()) return fp
			} catch {
				/* ignore */
			}
		}
	}
	const leafHints = new Set()
	for (const idv of rawVariants) {
		const a = idv.split('/').pop()
		if (a) leafHints.add(a)
		const b = idv.replace(/^MEDIA\//i, '').split('/').pop()
		if (b) leafHints.add(b)
	}
	const leafHintsArr = [...leafHints]
	for (const b of bases) {
		const r = path.resolve(b)
		if (!fs.existsSync(r)) continue
		try {
			if (!fs.statSync(r).isDirectory()) continue
		} catch {
			continue
		}
		for (const stem of leafHintsArr) {
			if (!stem) continue
			const hit = findFileByStemUnderDir(r, stem)
			if (hit) return hit
		}
	}
	return null
}

/**
 * WO-833 (3i): resolve a media id for a DESTRUCTIVE or id-addressed file operation (delete / move / copy).
 *
 * {@link resolveMediaFileOnDisk} is built for READERS (scene refs, thumbnails, LOADBG): it tries the ACTIVE
 * project's copy of a bare id before the id as given, and finally falls back to "any file anywhere whose stem
 * matches, case-folded" — so deleting `B/INTRO` could remove `a/intro.mp4`, and deleting `intro.mp4` removed the
 * project's copy instead of the root one the operator clicked. For the file manager the id the operator gave must
 * be the file that is touched, so here:
 *  - the id as given (and its `MEDIA/`-stripped form) is the only location tried — no project-scoped candidate,
 *    no stem walk, no cross-folder or case-folded match;
 *  - an extension-less id probes `SCAN_EXT` in the SAME folder and only succeeds when exactly one file matches;
 *  - an id naming a directory returns null (the caller handles folders; a same-stem file must never stand in).
 * @param {object} config
 * @param {string} filename media id (root-relative, as listed by the media browser)
 * @returns {string|null} absolute path of a regular file, or null
 */
function resolveMediaFileOnDiskExact(config, filename) {
	const idNorm = normalizeMediaIdKey(filename).trim()
	if (!idNorm || idNorm.includes('..')) return null
	const cfg = config || {}
	const rels = new Set()
	for (const v of [idNorm, idNorm.normalize('NFC'), idNorm.normalize('NFD')]) {
		if (!v || v.includes('..')) continue
		rels.add(v)
		if (/^MEDIA\//i.test(v)) rels.add(v.replace(/^MEDIA\//i, ''))
	}
	const bases = new Set()
	const cfgPath = (cfg.local_media_path || '').trim()
	if (cfgPath) bases.add(path.resolve(cfgPath))
	bases.add(getMediaIngestBasePath(cfg))
	bases.add(getMediaIngestBasePath({ ...cfg, local_media_path: '' }))
	const statOf = (fp) => {
		try {
			return fs.statSync(fp)
		} catch {
			return null
		}
	}
	for (const b of bases) {
		for (const rel of rels) {
			const fp = resolveSafe(b, rel)
			if (!fp) continue
			const st = statOf(fp)
			if (st && st.isFile()) return fp
			if (st && st.isDirectory()) return null
		}
	}
	for (const b of bases) {
		for (const rel of rels) {
			if (path.extname(rel.split('/').pop() || '')) continue
			const hits = []
			for (const ext of SCAN_EXT) {
				const fp = resolveSafe(b, rel + ext)
				const st = fp ? statOf(fp) : null
				if (st && st.isFile()) hits.push(fp)
			}
			if (hits.length === 1) return hits[0]
			if (hits.length > 1) return null // ambiguous (INTRO.mov + INTRO.mp4): never guess on a destructive op
		}
	}
	return null
}

function scanMediaRecursiveForBrowser(basePath, maxFiles = 2500) {
	const out = []
	if (!basePath || !fs.existsSync(basePath)) return out
	const stat = fs.statSync(basePath)
	if (!stat.isDirectory()) return out

	function walk(relDir) {
		if (out.length >= maxFiles) return
		const full = path.join(basePath, relDir)
		let entries
		try {
			entries = fs.readdirSync(full, { withFileTypes: true })
		} catch {
			return
		}
		for (const ent of entries) {
			if (out.length >= maxFiles) return
			const name = ent.name
			if (name.startsWith('.')) continue
			const rel = (relDir ? `${relDir}/${name}` : name).replace(/\\/g, '/')
			if (ent.isDirectory()) {
				if (HIDDEN_MEDIA_DIRS.has(name.toLowerCase())) continue
				out.push({ id: rel, isDir: true })
				walk(rel)
			} else {
				const ext = path.extname(name).toLowerCase()
				if (SCAN_EXT.has(ext)) out.push({ id: rel, isDir: false })
			}
		}
	}
	walk('')
	return out.sort((a, b) => a.id.localeCompare(b.id))
}

module.exports = {
	resolveSafe,
	getMediaIngestBasePath,
	normalizeMediaIdKey,
	resolveMediaFileOnDisk,
	resolveMediaFileOnDiskExact,
	scanMediaRecursiveForBrowser,
}
