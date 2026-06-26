/**
 * Live stream / record status — event-driven from WebSocket (no polling).
 * Shape matches GET /api/streaming-channel: { rtmp?, record? }.
 */
import { api } from './api-client.js'

/** @type {{ rtmp: object, record: object } | null} */
let status = null
/** @type {Set<(st: object | null) => void>} */
const listeners = new Set()

const INACTIVE = { active: false, outputId: null, activeOutputs: [] }

function notify() {
	for (const fn of listeners) {
		try {
			fn(status)
		} catch (e) {
			console.warn('[streaming-channel-state]', e)
		}
	}
}

/**
 * Strict on-air flag — rejects truthy strings like "idle", stale "true" strings, etc.
 * @param {unknown} v
 */
export function parseActiveFlag(v) {
	if (v === true || v === 1) return true
	if (v === false || v === 0 || v == null) return false
	const s = String(v).trim().toLowerCase()
	if (s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'running' || s === 'live') return true
	if (
		s === 'false' ||
		s === '0' ||
		s === 'no' ||
		s === 'off' ||
		s === 'idle' ||
		s === 'stopped' ||
		s === 'stop' ||
		s === ''
	) {
		return false
	}
	return false
}

/** Settings config — not runtime stream/rec status. */
function isStreamingChannelSettingsConfig(p) {
	if (!p || typeof p !== 'object') return false
	const o = /** @type {Record<string, unknown>} */ (p)
	if (o.rtmp != null || o.record != null) return false
	return (
		'videoSource' in o ||
		'audioSource' in o ||
		'dedicatedOutputChannel' in o ||
		'contentLayer' in o ||
		('enabled' in o && !('active' in o))
	)
}

/**
 * @param {unknown} slice
 * @param {'rtmp' | 'record'} kind
 */
function normalizeOutputSlice(slice, kind) {
	if (!slice || typeof slice !== 'object') return { ...INACTIVE }
	const s = /** @type {Record<string, unknown>} */ (slice)
	const active = parseActiveFlag(s.active ?? s.running ?? s.isActive ?? s.live)
	const outputIdRaw = s.outputId ?? s.output ?? s.id ?? null
	const outputId = outputIdRaw != null && String(outputIdRaw).trim() ? String(outputIdRaw).trim() : null
	const activeOutputs = Array.isArray(s.activeOutputs)
		? s.activeOutputs.map((x) => String(x).trim()).filter(Boolean)
		: active && outputId
			? [outputId]
			: []
	const isActive = active && activeOutputs.length > 0
	return {
		active: isActive,
		outputId: isActive ? outputId || activeOutputs[0] || null : null,
		activeOutputs: isActive ? activeOutputs : [],
		...(kind === 'record' && s.path != null ? { path: String(s.path) } : {}),
		...(Array.isArray(s.logs) ? { logs: s.logs } : {}),
	}
}

/**
 * @param {unknown} raw
 * @returns {{ rtmp: object, record: object } | null}
 */
export function normalizeStreamingChannelStatus(raw) {
	if (!raw || typeof raw !== 'object') return null
	const p = /** @type {Record<string, unknown>} */ (raw)
	if (isStreamingChannelSettingsConfig(p)) return null

	if (p.rtmp != null || p.record != null) {
		return {
			rtmp: normalizeOutputSlice(p.rtmp, 'rtmp'),
			record: normalizeOutputSlice(p.record, 'record'),
		}
	}

	const streaming = p.streaming && typeof p.streaming === 'object' ? p.streaming : null
	const recording = p.recording && typeof p.recording === 'object' ? p.recording : null
	if (streaming || recording) {
		const streamIds = Array.isArray(streaming?.activeOutputs)
			? streaming.activeOutputs.map((x) => String(x).trim()).filter(Boolean)
			: []
		const recIds = Array.isArray(recording?.activeOutputs)
			? recording.activeOutputs.map((x) => String(x).trim()).filter(Boolean)
			: []
		return {
			rtmp: {
				active: streamIds.length > 0,
				outputId: streamIds[0] || null,
				activeOutputs: streamIds,
			},
			record: {
				active: recIds.length > 0,
				outputId: recIds[0] || null,
				activeOutputs: recIds,
			},
		}
	}
	return null
}

/**
 * @param {object | null | undefined} st
 * @param {string} outputId
 */
export function isStreamOutputLive(st, outputId) {
	const id = String(outputId || '').trim()
	if (!id) return false
	const rtmp = st?.rtmp
	if (!rtmp || !parseActiveFlag(rtmp.active)) return false
	const outs = Array.isArray(rtmp.activeOutputs) ? rtmp.activeOutputs.map(String) : []
	if (outs.length) return outs.includes(id)
	return String(rtmp.outputId || '').trim() === id
}

/**
 * @param {object | null | undefined} st
 * @param {string} outputId
 */
export function isRecordOutputLive(st, outputId) {
	const id = String(outputId || '').trim()
	if (!id) return false
	const rec = st?.record
	if (!rec || !parseActiveFlag(rec.active)) return false
	const outs = Array.isArray(rec.activeOutputs) ? rec.activeOutputs.map(String) : []
	if (outs.length) return outs.includes(id)
	return String(rec.outputId || '').trim() === id
}

/**
 * @param {unknown} next
 * @param {{ merge?: boolean }} [opts]
 */
export function setStreamingChannelStatus(next, opts = {}) {
	const norm = normalizeStreamingChannelStatus(next)
	if (!norm) return
	if (opts.merge && status) {
		status = {
			rtmp: norm.rtmp?.active ? norm.rtmp : status.rtmp?.active ? status.rtmp : norm.rtmp,
			record: norm.record?.active ? norm.record : status.record?.active ? status.record : norm.record,
		}
	} else {
		status = norm
	}
	notify()
}

export function getStreamingChannelStatus() {
	return status
}

/**
 * @param {(st: object | null) => void} fn
 */
export function subscribeStreamingChannelStatus(fn) {
	listeners.add(fn)
	try {
		fn(status)
	} catch {}
	return () => listeners.delete(fn)
}

/**
 * @param {string} path
 * @param {unknown} value
 */
export function ingestStreamingChannelChange(path, value) {
	const p = String(path || '')
	if (p === 'streamingChannel' || p === 'streaming-channel' || p === 'streaming_channel') {
		setStreamingChannelStatus(value)
	}
}

/** @param {unknown} data */
export function ingestStreamingChannelWsEvent(data) {
	setStreamingChannelStatus(data)
}

/**
 * @param {unknown} res
 * @param {{ action?: 'start_stream' | 'stop_stream' | 'start_record' | 'stop_record', outputId?: string }} [hint]
 */
export function applyStreamingChannelActionResponse(res, hint = {}) {
	if (res && typeof res === 'object') {
		const r = /** @type {Record<string, unknown>} */ (res)
		if (r.status) {
			setStreamingChannelStatus(r.status)
			return
		}
		if (r.rtmp != null || r.record != null) {
			setStreamingChannelStatus(r)
			return
		}
	}

	const prev = status || { rtmp: { ...INACTIVE }, record: { ...INACTIVE } }
	if (hint.action === 'stop_stream') {
		setStreamingChannelStatus({ ...prev, rtmp: { ...INACTIVE } })
		return
	}
	if (hint.action === 'stop_record') {
		setStreamingChannelStatus({ ...prev, record: { ...INACTIVE } })
		return
	}
	if (hint.action === 'start_stream' && hint.outputId) {
		setStreamingChannelStatus({
			...prev,
			rtmp: { active: true, outputId: hint.outputId, activeOutputs: [hint.outputId] },
		})
		return
	}
	if (hint.action === 'start_record' && hint.outputId) {
		setStreamingChannelStatus({
			...prev,
			record: { active: true, outputId: hint.outputId, activeOutputs: [hint.outputId] },
		})
	}
}

let refreshPromise = null

/** One-shot GET — use on connect / after local actions / tab focus. Not a poll loop. */
export async function refreshStreamingChannelStatus() {
	if (refreshPromise) return refreshPromise
	refreshPromise = (async () => {
		try {
			const st = await api.get('/api/streaming-channel')
			setStreamingChannelStatus(st)
			return status
		} catch {
			return status
		} finally {
			refreshPromise = null
		}
	})()
	return refreshPromise
}

export async function bootstrapStreamingChannelStatus() {
	return refreshStreamingChannelStatus()
}

export function clearStreamingChannelStatus() {
	status = null
	notify()
}
