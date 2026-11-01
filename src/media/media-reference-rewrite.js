/**
 * WO-592 A — media "links": when a file is renamed/moved, every reference to it follows.
 *
 * References live in projects as `{ type, value, label }` objects on scene layers (`source`,
 * `playlist[]`) and timeline clips (`source`) — the same set `normalizeProjectMediaRefs` walks.
 * A `value` comes in three shapes and is rewritten IN ITS OWN SHAPE:
 *   - media-root relative with extension      `testowe/clip.mov`
 *   - project relative (project-scoped media)  `clip.mov` → resolves under `projects/<slug>/`
 *   - Caspar CLS form (uppercase, no ext)      `PROJECTS/DTLODZ/CLIP`
 * Matching: a value WITH an extension must equal the old path (case-insensitive, NFC); only an
 * extension-less value matches by CLS id — so renaming `clip.mov` never drags `clip.mp4` along.
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { toCasparClsMediaId } = require('./caspar-cls-id')
const {
	isProjectScopedMediaEnabled,
	expandMediaIdToMediaRoot,
	projectMediaIdPrefixesForSlug,
	getProjectMediaRelId,
} = require('./project-media-root')
const { getMediaIngestBasePath, resolveSafe } = require('./local-media-paths')

const NON_MEDIA_TYPES = new Set(['template', 'html', 'timeline', 'effect', 'live'])
const URL_LIKE = /^(https?|rtsp|rtmp|srt|udp|ndi|alsa|decklink|route):/i

const nfc = (s) => String(s || '').normalize('NFC').replace(/\\/g, '/').trim()
const hasExt = (p) => /\.[a-z0-9]{2,5}$/i.test(path.posix.basename(p))
const stripExt = (p) => (hasExt(p) ? p.slice(0, p.lastIndexOf('.')) : p)

/**
 * Visit every media reference object in a project (mutable, in place).
 * @param {object} project
 * @param {(ref: object, where: { kind: 'look' | 'timeline', id: string, name: string }) => void} fn
 */
function forEachProjectMediaRef(project, fn) {
	if (!project || typeof project !== 'object') return
	const sb = project.scenes
	const scenes = Array.isArray(sb) ? sb : Array.isArray(sb?.scenes) ? sb.scenes : []
	for (const scene of scenes) {
		const where = { kind: 'look', id: String(scene?.id || ''), name: String(scene?.name || scene?.id || '') }
		for (const layer of scene?.layers || []) {
			if (layer?.source) fn(layer.source, where)
			for (const item of layer?.playlist || []) if (item) fn(item, where)
		}
	}
	const tb = project.timelines
	const timelines = Array.isArray(tb) ? tb : Array.isArray(tb?.timelines) ? tb.timelines : []
	for (const tl of timelines) {
		const where = { kind: 'timeline', id: String(tl?.id || ''), name: String(tl?.name || tl?.id || '') }
		for (const layer of tl?.layers || []) for (const clip of layer?.clips || []) if (clip?.source) fn(clip.source, where)
	}
}

/**
 * Does a media-root-relative file (or, extension-less, any file with that stem) exist on disk?
 * @returns {(rel: string) => boolean}
 */
function diskExistsFn(config) {
	const base = getMediaIngestBasePath(config || {})
	return (rel) => {
		const abs = resolveSafe(base, rel)
		if (!abs) return false
		try {
			if (fs.statSync(abs).isFile()) return true
		} catch {
			/* try stem resolution below */
		}
		if (hasExt(rel)) return false
		try {
			const leaf = path.basename(abs)
			return fs.readdirSync(path.dirname(abs)).some((n) => path.parse(n).name === leaf)
		} catch {
			return false
		}
	}
}

const isProjectNamespaced = (v) => /^(projects|exfat\/projects|bridge\/projects)\//i.test(v)

/**
 * Media-root-relative form of a stored value, or null for non-media refs.
 *
 * Under project-scoped media a stored id is project-relative first and falls back to the media
 * root — the same order playback uses (caspar-cls-id.js resolveClipForAmcpLoad: the project folder
 * when the file is on disk there, else the plain media-root lookup). So a bare `x.png` that only
 * exists at the media root resolves to `x.png`, not `projects/<slug>/x.png` (WO-918 F22).
 * Neither on disk → project-scoped for a bare id (legacy), the value as stored for a pathed one.
 * @param {(rel: string) => boolean} [exists] - media-root-relative existence probe (default: disk)
 * @returns {string|null}
 */
function resolveRefValue(ref, slug, config, exists) {
	if (!ref || typeof ref !== 'object') return null
	if (NON_MEDIA_TYPES.has(String(ref.type || 'media').toLowerCase())) return null
	const value = nfc(ref.value)
	if (!value || URL_LIKE.test(value)) return null
	if (!slug || !isProjectScopedMediaEnabled(config)) return value
	const probe = exists || diskExistsFn(config)
	const bare = !value.includes('/')
	if (!bare && (isProjectNamespaced(value) || value.startsWith('../'))) return value
	const scoped = bare ? nfc(expandMediaIdToMediaRoot(value, slug, config)) : nfc(`${getProjectMediaRelId(slug, config)}/${value}`)
	if (probe(scoped)) return scoped
	if (probe(value)) return value
	return bare ? scoped : value
}

function refMatchesPath(resolved, filePath) {
	const f = nfc(filePath)
	if (hasExt(resolved)) return resolved.toLowerCase() === f.toLowerCase()
	return toCasparClsMediaId(resolved) === toCasparClsMediaId(f)
}

/** New stored value for `to`, keeping the old value's shape (project-relative / CLS). */
function rewriteValueShape(oldValue, resolved, to, slug, config) {
	let out = nfc(to)
	if (slug && resolved !== nfc(oldValue)) {
		for (const prefix of projectMediaIdPrefixesForSlug(slug, config)) {
			if (out.toLowerCase().startsWith(prefix.toLowerCase())) {
				out = out.slice(prefix.length)
				break
			}
		}
	}
	return hasExt(nfc(oldValue)) ? out : toCasparClsMediaId(out)
}

function rewriteLabel(label, oldValue, newValue, from, to) {
	const l = nfc(label)
	if (!l) return label
	const lc = l.toLowerCase()
	if (lc === nfc(from).toLowerCase()) return nfc(to)
	if (lc === nfc(oldValue).toLowerCase()) return newValue
	const fb = path.posix.basename(nfc(from))
	const tb = path.posix.basename(nfc(to))
	if (lc === fb.toLowerCase()) return tb
	if (lc === stripExt(fb).toLowerCase()) return stripExt(tb)
	return label
}

/**
 * Pure: rewrite every reference to a renamed file. Returns a deep copy + change count.
 * @param {object} project
 * @param {string} slug
 * @param {Array<{ from: string, to: string }>} renames - media-root-relative paths with extension
 * @param {object} [config]
 * @returns {{ project: object, changed: number }}
 */
function rewriteProjectMediaRefs(project, slug, renames, config) {
	const next = JSON.parse(JSON.stringify(project || {}))
	let changed = 0
	const list = (renames || []).filter((r) => r && r.from && r.to && nfc(r.from) !== nfc(r.to))
	if (!list.length) return { project: next, changed }
	// The files have already moved on disk when this runs: judge each ref against the PRE-move
	// layout (a source path still counts as existing, a destination as not yet there).
	const disk = diskExistsFn(config)
	const key = (p) => nfc(p).toLowerCase()
	const froms = new Set(list.map((r) => key(r.from)))
	const tos = new Set(list.map((r) => key(r.to)))
	const exists = (rel) => froms.has(key(rel)) || (!tos.has(key(rel)) && disk(rel))
	forEachProjectMediaRef(next, (ref) => {
		const resolved = resolveRefValue(ref, slug, config, exists)
		if (!resolved) return
		const hit = list.find((r) => refMatchesPath(resolved, r.from))
		if (!hit) return
		const oldValue = ref.value
		ref.value = rewriteValueShape(oldValue, resolved, hit.to, slug, config)
		if (ref.label != null) ref.label = rewriteLabel(ref.label, oldValue, ref.value, hit.from, hit.to)
		changed++
	})
	return { project: next, changed }
}

/**
 * Where is a file used? One row per look/timeline (deduped).
 * @returns {Array<{ kind: string, id: string, name: string, count: number }>}
 */
function findProjectMediaUsage(project, slug, filePath, config) {
	const rows = new Map()
	forEachProjectMediaRef(project, (ref, where) => {
		const resolved = resolveRefValue(ref, slug, config)
		if (!resolved || !refMatchesPath(resolved, filePath)) return
		const key = `${where.kind}:${where.id}`
		const row = rows.get(key) || { ...where, count: 0 }
		row.count++
		rows.set(key, row)
	})
	return [...rows.values()]
}

/**
 * WO-603 Gather: the catalog files a project references (one entry per file, media-root relative).
 * @param {string[]} catalogIds - media-root file ids (with extension)
 * @returns {string[]}
 */
function projectReferencedFiles(project, slug, catalogIds, config) {
	const files = (catalogIds || []).map(nfc).filter(Boolean)
	const known = new Set(files.map((f) => f.toLowerCase()))
	const exists = (rel) => known.has(rel.toLowerCase()) || (!hasExt(rel) && files.some((f) => toCasparClsMediaId(f) === toCasparClsMediaId(rel)))
	const out = new Set()
	forEachProjectMediaRef(project, (ref) => {
		const resolved = resolveRefValue(ref, slug, config, exists)
		if (!resolved) return
		const hit = files.find((f) => refMatchesPath(resolved, f))
		if (hit) out.add(hit)
	})
	return [...out]
}

module.exports = {
	rewriteProjectMediaRefs,
	findProjectMediaUsage,
	projectReferencedFiles,
}
