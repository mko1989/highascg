/**
 * Dedupe media browser rows that refer to the same Caspar clip (CLS often lists variants:
 * with/without extension, different casing). Same basename key as web normalizeMediaIdForMatch (mixer-fill.js).
 */

'use strict'

/**
 * CLS often lists the same clip twice with encoding hints in the filename (e.g. "clip.mp4" vs "clip_h265.mp4").
 * Strip common trailing tags after extension removal so they merge like normalizeMediaIdForMatch (mixer-fill.js).
 * @param {string} base - basename without extension, lowercased
 */
function stripEncodingTechSuffixVariants(base) {
	let s = String(base || '').trim()
	s = s.replace(/\s*\(h\.?265\)\s*$/i, '')
	s = s.replace(/\s*\[h\.?265\]\s*$/i, '')
	s = s.replace(/\s+h\.?265$/i, '')
	s = s.replace(/_h\.?265$/i, '')
	s = s.replace(/_hevc$/i, '')
	s = s.replace(/\s*\(hevc\)\s*$/i, '')
	s = s.replace(/\s+hevc$/i, '')
	return s.trim()
}

/**
 * Lowercase basename without extension — same logical file for Caspar PLAY / ffprobe.
 * @param {string} id
 */
function canonicalMediaBasenameKey(id) {
	let base = String(id || '')
		.toLowerCase()
		.replace(/\\/g, '/')
		.replace(/^.*\//, '')
		.replace(/\.[^./]+$/, '')
		.trim()
	base = stripEncodingTechSuffixVariants(base)
	return base
}

/**
 * Prefer rows with resolution/ffprobe metadata and ids that include a file extension.
 * @param {{ id?: string, resolution?: string, codec?: string, durationMs?: number, fps?: number, type?: string, fileSize?: number, cinf?: string, label?: string }} m
 */
function rowScore(m) {
	let s = 0
	if (m.resolution) s += 100
	if (m.codec) s += 25
	if (m.durationMs > 0) s += 10
	if (m.fps != null && m.fps > 0) s += 5
	const base = String(m.id || '').split(/[/\\]/).pop() || ''
	if (/\.[a-z0-9]{2,8}$/i.test(base)) s += 15
	return s
}

/**
 * @param {object[]} rows
 */
function basenameHasExtension(id) {
	const base = String(id || '').split(/[/\\]/).pop() || ''
	return /\.[a-z0-9]{2,8}$/i.test(base)
}

function mergeMediaRows(rows) {
	if (rows.length === 0) return null
	if (rows.length === 1) return { ...rows[0] }
	const sorted = [...rows].sort((a, b) => {
		const d = rowScore(b) - rowScore(a)
		if (d !== 0) return d
		const extDiff = Number(basenameHasExtension(b.id)) - Number(basenameHasExtension(a.id))
		if (extDiff !== 0) return extDiff
		return String(a.id).localeCompare(String(b.id), undefined, { sensitivity: 'base' })
	})
	const out = { ...sorted[0] }
	for (let i = 1; i < sorted.length; i++) {
		const r = sorted[i]
		if (!out.resolution && r.resolution) out.resolution = r.resolution
		if (out.durationMs == null && r.durationMs != null) out.durationMs = r.durationMs
		if (out.fps == null && r.fps != null) out.fps = r.fps
		if (!out.codec && r.codec) out.codec = r.codec
		if (!out.type && r.type) out.type = r.type
		if (!out.fileSize && r.fileSize) out.fileSize = r.fileSize
		if (!out.cinf && r.cinf) out.cinf = r.cinf
		if (!out.label && r.label) out.label = r.label
	}
	const primary = sorted[0]
	out.id = primary.id
	out.label = out.label || primary.label || primary.id
	return out
}

/**
 * @param {object[]} media
 * @returns {object[]}
 */
function dedupeMediaList(media) {
	if (!Array.isArray(media) || media.length < 2) return media || []
	const byKey = new Map()
	for (const m of media) {
		const key = canonicalMediaBasenameKey(m.id)
		if (!key) continue
		const list = byKey.get(key) || []
		list.push(m)
		byKey.set(key, list)
	}
	const out = []
	for (const [, rows] of byKey) {
		if (rows.length === 1) out.push({ ...rows[0] })
		else out.push(mergeMediaRows(rows))
	}
	return out.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { sensitivity: 'base' }))
}

module.exports = { dedupeMediaList, canonicalMediaBasenameKey }
