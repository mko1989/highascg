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

const path = require('path')
const { toCasparClsMediaId } = require('./caspar-cls-id')
const {
	isProjectScopedMediaEnabled,
	expandMediaIdToMediaRoot,
	projectMediaIdPrefixesForSlug,
} = require('./project-media-root')

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
 * Media-root-relative form of a stored value, or null for non-media refs.
 * @returns {string|null}
 */
function resolveRefValue(ref, slug, config) {
	if (!ref || typeof ref !== 'object') return null
	if (NON_MEDIA_TYPES.has(String(ref.type || 'media').toLowerCase())) return null
	const value = nfc(ref.value)
	if (!value || URL_LIKE.test(value)) return null
	return slug && isProjectScopedMediaEnabled(config) ? nfc(expandMediaIdToMediaRoot(value, slug, config)) : value
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
	forEachProjectMediaRef(next, (ref) => {
		const resolved = resolveRefValue(ref, slug, config)
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

module.exports = {
	forEachProjectMediaRef,
	resolveRefValue,
	refMatchesPath,
	rewriteProjectMediaRefs,
	findProjectMediaUsage,
}
