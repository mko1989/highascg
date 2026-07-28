/**
 * media-duration.js — WO-370: the REAL length of a media clip, from `state.media` (the same
 * CLS-backed list `media-exists.js` indexes). Playlist rows must show each clip's own length
 * instead of the timeless default; the data was already in the client's hands, unused.
 *
 * The trap this file exists to survive (WO-370 §1d): the same asset can appear twice with
 * contradictory numbers — a CINF-derived row whose frame-count/timebase maths is wrong
 * (`fps: 0.04`, `durationMs: 30257742` = 8.4 h) next to the correct ffprobe row
 * (`fps: 23.98`, `durationMs: 52636`). Normalisation (case-insensitive, extension-stripped,
 * basename fallback — same shape as media-exists.js) is exactly what collapses those two onto
 * one key, so the tie-break is explicit here:
 *
 *   1. drop implausible entries (no positive duration, or a sub-1 fps — the CINF-maths tell);
 *   2. prefer probed entries (they carry `codec`/`resolution`) over CINF-only ones;
 *   3. if what survives still disagrees by more than an order of magnitude, return null.
 *
 * null means "no trustworthy length" and callers must render NOTHING — never a made-up number.
 */

/** @type {Map<string, number|null>} */
let _byId = new Map()
/** @type {Map<string, number|null>} */
let _byBase = new Map()
let _ready = false

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

/** @param {object} m @returns {{ms: number, probed: boolean} | null} */
function candidateOf(m) {
	const ms = Number(m?.durationMs)
	if (!Number.isFinite(ms) || ms <= 0) return null
	const fps = Number(m?.fps)
	// fps present but below 1 fps: the CINF frame-count/timebase miscalculation — its duration lies.
	if (Number.isFinite(fps) && fps > 0 && fps < 1) return null
	return { ms, probed: Boolean(m?.codec || m?.resolution) }
}

/** @param {Array<{ms: number, probed: boolean}>} cands @returns {number | null} */
function pick(cands) {
	if (!cands.length) return null
	const probed = cands.filter((c) => c.probed)
	const pool = probed.length ? probed : cands
	const vals = pool.map((c) => c.ms)
	const min = Math.min(...vals)
	const max = Math.max(...vals)
	if (min > 0 && max / min > 10) return null // contradictory survivors — refuse to guess
	return pool[0].ms
}

function push(map, key, cand) {
	if (!key) return
	const arr = map.get(key)
	if (arr) arr.push(cand)
	else map.set(key, [cand])
}

function rebuild(media) {
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
	_byId = new Map([...ids].map(([k, v]) => [k, pick(v)]))
	_byBase = new Map([...bases].map(([k, v]) => [k, pick(v)]))
	_ready = _byId.size > 0
}

/** Call once at app init; keeps the index live. @param {object} stateStore */
export function initMediaDurationIndex(stateStore) {
	rebuild(stateStore.getState()?.media)
	stateStore.on?.('media', (media) => rebuild(media))
	stateStore.on?.('*', (path) => {
		if (path === 'media' || path === '*') rebuild(stateStore.getState()?.media)
	})
}

/** Test seam — build the index from a plain media array. @param {Array<object>} media */
export function _setMediaForTest(media) {
	rebuild(media)
}

/**
 * Real length of a media value, or null when unknown/untrustworthy.
 * @param {string} value @returns {number | null}
 */
export function mediaDurationMs(value) {
	const raw = String(value || '').trim()
	if (!raw || !_ready) return null
	const exact = _byId.get(norm(raw))
	if (exact != null) return exact
	if (_byId.has(norm(raw))) return null // known id, untrustworthy duration — do not fall back
	const base = _byBase.get(baseOf(raw))
	return base != null ? base : null
}

/**
 * Compact clip length for minimal rows (WO-353): `0:53`, `1:24:06`. Empty string when unknown.
 * @param {number | null | undefined} ms
 */
export function formatClipDuration(ms) {
	if (ms == null || !Number.isFinite(Number(ms)) || Number(ms) <= 0) return ''
	const s = Math.round(Number(ms) / 1000)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
	return `${m}:${String(s % 60).padStart(2, '0')}`
}
