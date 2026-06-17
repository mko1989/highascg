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
		for (const cand of candidates) {
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
	scanMediaRecursiveForBrowser,
}
