'use strict'

/**
 * WO-603 — server copy of client/lib/media-duration.js (WO-353 / WO-360): the real length of a media value, or null
 * when unknown or untrustworthy (sub-1-fps CINF lengths lie; contradictory candidates refuse to guess). Probed rows
 * (codec / resolution known) win over CLS-only rows. Pure: callers pass the media rows.
 */

function norm(v) {
	return String(v || '')
		.trim()
		.replace(/\\/g, '/')
		.replace(/\.[a-z0-9]{2,4}$/i, '')
		.toLowerCase()
}

function baseOf(v) {
	const n = norm(v)
	return n.split('/').filter(Boolean).pop() || n
}

function candidateOf(m) {
	const ms = Number(m?.durationMs)
	if (!Number.isFinite(ms) || ms <= 0) return null
	const fps = Number(m?.fps)
	if (Number.isFinite(fps) && fps > 0 && fps < 1) return null
	return { ms, probed: Boolean(m?.codec || m?.resolution) }
}

function pick(cands) {
	if (!cands.length) return null
	const probed = cands.filter((c) => c.probed)
	const pool = probed.length ? probed : cands
	const vals = pool.map((c) => c.ms)
	const min = Math.min(...vals)
	const max = Math.max(...vals)
	if (min > 0 && max / min > 10) return null
	return pool[0].ms
}

function push(map, key, cand) {
	if (!key) return
	const arr = map.get(key)
	if (arr) arr.push(cand)
	else map.set(key, [cand])
}

/** @param {object[]} media */
function buildDurationIndex(media) {
	const ids = new Map()
	const bases = new Map()
	for (const m of media || []) {
		const id = norm(m?.id ?? m?.name)
		if (!id) continue
		const cand = candidateOf(m)
		if (!cand) continue
		push(ids, id, cand)
		push(bases, baseOf(id), cand)
	}
	const byId = new Map([...ids].map(([k, v]) => [k, pick(v)]))
	const byBase = new Map([...bases].map(([k, v]) => [k, pick(v)]))
	return { byId, byBase, ready: byId.size > 0 }
}

/** @returns {number|null} */
function mediaDurationMs(value, index) {
	const raw = String(value || '').trim()
	if (!raw || !index?.ready) return null
	const exact = index.byId.get(norm(raw))
	if (exact != null) return exact
	if (index.byId.has(norm(raw))) return null
	const base = index.byBase.get(baseOf(raw))
	return base != null ? base : null
}

/** `0:53`, `1:24:06`; '' when unknown. */
function formatClipDuration(ms) {
	if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return ''
	const s = Math.round(Number(ms) / 1000)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
	return `${m}:${String(s % 60).padStart(2, '0')}`
}

module.exports = { buildDurationIndex, mediaDurationMs, formatClipDuration }
