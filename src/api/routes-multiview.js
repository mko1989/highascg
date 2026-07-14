/**
 * POST /api/multiview/apply — layout cells + route layers; single full-screen CG chrome template (multiview_master) draws all borders/labels/timers.
 * @see companion-module-casparcg-server/src/api-routes.js handleMultiviewApply
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getChannelMap } = require('../config/routing')
const persistence = require('../utils/persistence')
const {
	applyMultiviewLayout,
	fetchMultiviewInfoXml,
	resolveMultiviewChannel,
	getLastAppliedDebug,
} = require('../engine/multiview-apply')
const liveSceneState = require('../state/live-scene-state')

const MULTIVIEW_APPLY_TIMEOUT_MS = 25_000

async function handleMultiviewApply(body, ctx) {
	const b = parseBody(body)
	const layout = b.layout
	if (!Array.isArray(layout)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layout array required' }) }
	}
	const map = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
	if (resolveMultiviewChannel(b, map) == null) {
		const n = Math.max(1, parseInt(b.n || 1, 10) || 1)
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Multiviewer ${n} not enabled` }) }
	}

	let infoXml = null
	try {
		const info = await fetchMultiviewInfoXml(b, ctx)
		infoXml = info.infoXml
	} catch (e) {
		const raw = (e?.message || (e && typeof e.toString === 'function' ? e.toString() : '') || String(e) || '').trim()
		const isConnection = /not connected|socket|econnrefused|etimedout|econnreset|connection refused|network/i.test(raw) ||
			raw.toLowerCase().includes('not connected')
		const msg = isConnection
			? 'CasparCG is not connected. Check module Settings → Connection and ensure CasparCG server is running.'
			: (raw.includes('404') || raw.includes('401')
				? `Channel ${resolveMultiviewChannel(b, map)} does not exist on CasparCG. Enable "Multiview channel" in module Settings → Screens, then use "Apply server config and restart" to create it.`
				: raw)
		return { status: isConnection ? 503 : 400, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}

	const n = Math.max(1, parseInt(b.n || 1, 10) || 1)
	const timeoutPromise = new Promise((_, reject) => {
		setTimeout(() => reject(new Error('Multiview apply timed out')), MULTIVIEW_APPLY_TIMEOUT_MS)
	})

	try {
		const result = await Promise.race([applyMultiviewLayout(b, ctx, { infoXml }), timeoutPromise])
		const storeKey = n === 1 ? 'multiviewLayout' : `multiviewLayout_${n}`
		if (!ctx._multiviewLayouts) ctx._multiviewLayouts = {}
		ctx._multiviewLayouts[n] = b
		// WO-156: keep the legacy singular in sync so boot/reconnect re-apply never uses a
		// stale layout (the plural map is the source of truth; singular kept for old readers).
		if (n === 1) ctx._multiviewLayout = b
		persistence.set(storeKey, b)
		// T190.2: Include debug info in response
		const responseBody = { ok: true }
		if (result?.debug) {
			responseBody.debug = result.debug
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(responseBody) }
	} catch (e) {
		if (e?.message === 'Multiview apply timed out') {
			ctx.log('warn', 'Multiview apply timed out')
			return {
				status: 504,
				headers: JSON_HEADERS,
				body: jsonBody({
					error: 'Multiview apply timed out. CasparCG may be slow or unresponsive. Try again or check the server.',
				}),
			}
		}
		const msg = e?.message || String(e)
		const status = /not connected|CasparCG is not connected/i.test(msg) ? 503 : 502
		return { status, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}
}

/**
 * T190.2: Handle GET /api/multiview/debug — return last-applied debug record + live scene state + playback matrix.
 */
async function handleMultiviewDebug(ctx) {
	const debug = getLastAppliedDebug()
	if (!debug) {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ debug: null }) }
	}

	// Extract distinct routed source channels from the debug record
	const sourceChannels = new Set()
	if (debug.cells && Array.isArray(debug.cells)) {
		for (const cell of debug.cells) {
			const route = cell.route
			if (typeof route === 'string') {
				const m = route.match(/^route:\/\/(\d+)/)
				if (m) {
					const ch = parseInt(m[1], 10)
					if (Number.isFinite(ch)) sourceChannels.add(ch)
				}
			}
		}
	}

	// Build response with live scene state info for each source channel
	const payload = { ...debug }
	payload.sourceChannels = {}

	for (const chNum of sourceChannels) {
		const chStr = String(chNum)
		const liveScene = liveSceneState.getChannel(chNum)
		const layers = liveScene?.scene?.layers || []

		// Extract crop effect params from each layer
		const layersDebug = layers.map((layer) => {
			const layerDebug = {
				num: layer.num,
				type: layer.type,
			}
			// Extract crop effect if present
			if (layer.effects && Array.isArray(layer.effects)) {
				const cropEffect = layer.effects.find((e) => e.type === 'crop')
				if (cropEffect) {
					layerDebug.crop = cropEffect
				}
			}
			return layerDebug
		})

		// Get playback-matrix entries for this channel (prefix match)
		const playbackMatrix = ctx._playbackMatrix || {}
		const matrixEntries = {}
		for (const key of Object.keys(playbackMatrix)) {
			if (key.startsWith(`${chNum}-`)) {
				matrixEntries[key] = playbackMatrix[key]
			}
		}

		// Get programLayerBankByChannel for this channel
		const bankByChannel = ctx.programLayerBankByChannel || {}
		const activeBank = bankByChannel[chStr] || null

		payload.sourceChannels[chStr] = {
			layers: layersDebug,
			playbackMatrix: matrixEntries,
			programLayerBank: activeBank,
		}
	}

	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ debug: payload }) }
}

async function handlePost(path, body, ctx) {
	if (path !== '/api/multiview/apply') return null
	if (!ctx.amcp) return null
	return handleMultiviewApply(body, ctx)
}

async function handleGet(path, ctx) {
	if (path !== '/api/multiview/debug') return null
	return handleMultiviewDebug(ctx)
}

module.exports = { handlePost, handleGet, handleMultiviewApply, handleMultiviewDebug }
