'use strict'

const crypto = require('crypto')
const { lookAirFrameKey } = require('./contract')
const liveSceneState = require('../state/live-scene-state')
const { getChannelMap } = require('../config/routing')
const { getCompanionBridgeRegistry } = require('./registry')

/** @type {Map<string, string>} lookId -> content hash */
const _lastHashByLook = new Map()
/** @type {Record<string, { sceneId?: string }>} */
let _lastSceneLiveSnapshot = {}

/**
 * @param {string} dataUri
 * @returns {string}
 */
function hashDataUri(dataUri) {
	const s = String(dataUri ?? '')
	if (!s) return ''
	const body = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s
	if (!body) return ''
	return crypto.createHash('sha256').update(body).digest('hex')
}

/**
 * @param {object} [config]
 * @returns {{ programChannels?: number[], previewChannels?: number[], screenCount?: number }}
 */
function resolveChannelMap(config) {
	try {
		return getChannelMap(config || {})
	} catch {
		return { programChannels: [1], previewChannels: [2], screenCount: 1 }
	}
}

/**
 * Collect look ids currently on PGM or PRV across all screens.
 * @param {Record<string, { sceneId?: string }>} sceneLive
 * @param {ReturnType<typeof resolveChannelMap>} map
 * @returns {Set<string>}
 */
function collectOnAirLookIds(sceneLive, map) {
	/** @type {Set<string>} */
	const out = new Set()
	const live = sceneLive && typeof sceneLive === 'object' ? sceneLive : {}
	const screenCount = Math.max(1, Number(map?.screenCount) || map?.programChannels?.length || 1)

	for (let i = 0; i < screenCount; i += 1) {
		const pgmCh = map?.programChannels?.[i] ?? map?.programCh?.(i + 1)
		if (pgmCh != null) {
			const sid = live[String(pgmCh)]?.sceneId
			if (sid) out.add(String(sid).trim())
		}
		const prvCh = map?.previewChannels?.[i] ?? map?.previewCh?.(i + 1)
		const pgmNum = pgmCh != null ? Number(pgmCh) : NaN
		const prvNum = prvCh != null ? Number(prvCh) : NaN
		if (Number.isFinite(prvNum) && prvNum > 0 && prvNum !== pgmNum) {
			const sid = live[String(prvCh)]?.sceneId
			if (sid) out.add(String(sid).trim())
		}
	}
	return out
}

/**
 * Look ids on air that use this compose-preview channel (PGM or PRV bus).
 * @param {number} channel
 * @param {Record<string, { sceneId?: string }>} sceneLive
 * @param {ReturnType<typeof resolveChannelMap>} map
 * @returns {Set<string>}
 */
function looksOnChannel(channel, sceneLive, map) {
	const ch = parseInt(String(channel), 10)
	/** @type {Set<string>} */
	const out = new Set()
	if (!Number.isFinite(ch) || ch < 1) return out

	const live = sceneLive && typeof sceneLive === 'object' ? sceneLive : {}
	const screenCount = Math.max(1, Number(map?.screenCount) || map?.programChannels?.length || 1)

	for (let i = 0; i < screenCount; i += 1) {
		const pgmChRaw = map?.programChannels?.[i] ?? map?.programCh?.(i + 1)
		const prvChRaw = map?.previewChannels?.[i] ?? map?.previewCh?.(i + 1)
		const pgmCh = pgmChRaw != null ? Number(pgmChRaw) : NaN
		const prvCh = prvChRaw != null ? Number(prvChRaw) : NaN
		const hasPrv = Number.isFinite(prvCh) && prvCh > 0 && prvCh !== pgmCh

		if (pgmCh === ch) {
			const sid = live[String(pgmCh)]?.sceneId
			if (sid) out.add(String(sid).trim())
		}
		if (hasPrv && prvCh === ch) {
			const sid = live[String(prvCh)]?.sceneId
			if (sid) out.add(String(sid).trim())
		}
	}
	return out
}

/**
 * @param {object} ctx
 * @param {string} lookId
 * @param {string} dataUri
 * @param {{ force?: boolean }} [opts]
 */
function pushLookFrame(ctx, lookId, dataUri, opts = {}) {
	const id = String(lookId ?? '').trim()
	if (!id) return
	const uri = String(dataUri ?? '')
	const key = lookAirFrameKey(id)
	const hash = hashDataUri(uri)
	const prev = _lastHashByLook.get(id)
	if (!opts.force && uri && hash && hash === prev) return
	if (!uri) {
		_lastHashByLook.delete(id)
	} else {
		_lastHashByLook.set(id, hash)
	}

	if (ctx?.state && typeof ctx.state.setVariableImmediate === 'function') {
		ctx.state.setVariableImmediate(key, uri)
	} else if (ctx?.state && typeof ctx.state.setVariable === 'function') {
		ctx.state.setVariable(key, uri)
	}
}

/**
 * @param {object} ctx
 * @param {string} lookId
 */
function clearLookFrame(ctx, lookId) {
	pushLookFrame(ctx, lookId, '')
}

/**
 * Build look_air_frame_* entries for a channel frame (merged into compose preview batch).
 *
 * @param {object} ctx
 * @param {number} channel
 * @param {string} dataUri
 * @returns {Record<string, string>}
 */
function buildLookAirFrameUpdates(ctx, channel, dataUri) {
	/** @type {Record<string, string>} */
	const batch = {}
	if (!getCompanionBridgeRegistry().shouldPushLookAirFrames()) return batch
	const cfg = ctx?.config || {}
	const sceneLive = liveSceneState.getAll()
	const map = resolveChannelMap(cfg)
	const lookIds = looksOnChannel(channel, sceneLive, map)
	for (const lookId of lookIds) {
		const id = String(lookId ?? '').trim()
		if (!id) continue
		const uri = String(dataUri ?? '')
		const hash = hashDataUri(uri)
		if (uri && hash && hash === _lastHashByLook.get(id)) continue
		if (!uri) {
			_lastHashByLook.delete(id)
		} else {
			_lastHashByLook.set(id, hash)
		}
		batch[lookAirFrameKey(id)] = uri
	}
	return batch
}

/**
 * @deprecated Prefer buildLookAirFrameUpdates merged into compose preview batch.
 * @param {object} ctx
 * @param {number} channel
 * @param {string} dataUri
 */
function onChannelComposeFrame(ctx, channel, dataUri) {
	const batch = buildLookAirFrameUpdates(ctx, channel, dataUri)
	if (Object.keys(batch).length === 0) return
	if (ctx?.state && typeof ctx.state.setVariablesImmediate === 'function') {
		ctx.state.setVariablesImmediate(batch)
	} else if (ctx?.state && typeof ctx.state.setVariableImmediate === 'function') {
		for (const [k, v] of Object.entries(batch)) {
			ctx.state.setVariableImmediate(k, v)
		}
	}
}

/**
 * After scene.live broadcast — clear off-air looks; snap on-air from cached JPEG.
 * @param {object} ctx
 */
function onSceneLiveBroadcast(ctx) {
	if (!getCompanionBridgeRegistry().shouldPushLookAirFrames()) return
	const cfg = ctx?.config || {}
	const map = resolveChannelMap(cfg)
	const nextLive = liveSceneState.getAll()
	const prevOnAir = collectOnAirLookIds(_lastSceneLiveSnapshot, map)
	const nextOnAir = collectOnAirLookIds(nextLive, map)

	for (const lookId of prevOnAir) {
		if (!nextOnAir.has(lookId)) {
			clearLookFrame(ctx, lookId)
		}
	}

	for (const lookId of nextOnAir) {
		if (prevOnAir.has(lookId)) continue
		for (const ch of resolveMonitoredChannelsForSnap(map, nextLive, lookId)) {
			const { getCompanionPreviewJpegBuffer } = require('../preview/compose-preview-companion-thumb')
			const buf = getCompanionPreviewJpegBuffer(ch)
			if (buf && buf.length >= 64) {
				const dataUri = `data:image/jpeg;base64,${buf.toString('base64')}`
				onChannelComposeFrame(ctx, ch, dataUri)
				break
			}
		}
	}

	_lastSceneLiveSnapshot = { ...nextLive }
}

/**
 * @param {ReturnType<typeof resolveChannelMap>} map
 * @param {Record<string, { sceneId?: string }>} sceneLive
 * @param {string} lookId
 * @returns {number[]}
 */
function resolveMonitoredChannelsForSnap(map, sceneLive, lookId) {
	/** @type {number[]} */
	const out = []
	const screenCount = Math.max(1, Number(map?.screenCount) || map?.programChannels?.length || 1)
	for (let i = 0; i < screenCount; i += 1) {
		const pgmChRaw = map?.programChannels?.[i] ?? map?.programCh?.(i + 1)
		const prvChRaw = map?.previewChannels?.[i] ?? map?.previewCh?.(i + 1)
		const pgmCh = pgmChRaw != null ? Number(pgmChRaw) : NaN
		const prvCh = prvChRaw != null ? Number(prvChRaw) : NaN
		const live = sceneLive || {}
		if (Number.isFinite(pgmCh) && live[String(pgmCh)]?.sceneId === lookId) out.push(pgmCh)
		if (Number.isFinite(prvCh) && prvCh !== pgmCh && live[String(prvCh)]?.sceneId === lookId) {
			out.push(prvCh)
		}
	}
	return out
}

function resetLookAirFrames(ctx) {
	for (const lookId of [..._lastHashByLook.keys()]) {
		clearLookFrame(ctx, lookId)
	}
	_lastHashByLook.clear()
	_lastSceneLiveSnapshot = {}
}

module.exports = {
	buildLookAirFrameUpdates,
	onChannelComposeFrame,
	onSceneLiveBroadcast,
	clearLookFrame,
	resetLookAirFrames,
	looksOnChannel,
	collectOnAirLookIds,
}
