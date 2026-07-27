/**
 * routes-playlist.js — Manual playlist advance API (WO-224).
 *
 * Endpoints:
 *   POST /api/playlist/next — { channel, layerNumber } → trigger next item in manual-advance playlist
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const liveSceneState = require('../state/live-scene-state')
const { normalizeProgramLayerBank, physicalProgramLayer } = require('../engine/scene-transition')
const { triggerPlaylistAdvance } = require('../engine/scene-take-lbg-playlist')

/**
 * Owner request 2026-07-26 — Playlists footer panel: enumerate every playlist layer currently
 * live on any channel, with items and the active index, so the panel can render dropdowns.
 * @param {object} ctx
 */
function handleStateGet(ctx) {
	const all = liveSceneState.getAll()
	const playlists = []
	const seen = new Set()
	const pushEntry = (scene, layer, channel) => {
		const pKey = `${scene.id}-${layer.layerNumber}`
		if (seen.has(pKey)) return
		seen.add(pKey)
		playlists.push({
			live: channel != null,
			channel: channel != null ? channel : null,
			sceneId: scene.id,
			sceneName: scene.name || scene.id,
			layerNumber: Number(layer.layerNumber),
			advance: layer.playlistAdvance || 'auto',
			loop: layer.playlistLoop !== false,
			activeIndex: (ctx.playlistActiveIndices || {})[pKey] ?? (ctx.playlistStartIndices || {})[pKey] ?? 0,
			startIndex: (ctx.playlistStartIndices || {})[pKey] ?? 0,
			items: layer.playlist.map((it) => ({
				label: it.label || it.value,
				value: it.value,
				duration: it.duration ?? null,
				type: it.type || 'media',
			})),
		})
	}
	for (const chKey of Object.keys(all || {})) {
		const scene = all[chKey]?.scene
		if (!scene || !Array.isArray(scene.layers)) continue
		for (const layer of scene.layers) {
			if (layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length === 0) continue
			pushEntry(scene, layer, parseInt(chKey, 10))
		}
	}
	/* WO-347: also every playlist DEFINED in the project's looks (not live yet) — the operator
	 * sets the start item before playout via action:'set_start'. */
	try {
		const envelope = require('../engine/project-scenes-load').loadProjectScenes()
		for (const scene of envelope?.scenes || []) {
			for (const layer of scene?.layers || []) {
				if (layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length === 0) continue
				pushEntry(scene, layer, null)
			}
		}
	} catch {
		/* project store unavailable — live-only listing */
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, playlists }) }
}

/**
 * Mode-agnostic transport: { channel, layerNumber, action: 'next'|'prev'|'goto', index? }.
 * Unlike the legacy /next (manual-mode only), this drives auto playlists too — a jump simply
 * restages that item; the engine re-arms timers / preloads onward from there.
 */
async function handleControlPost(body, ctx) {
	const b = parseBody(body) || {}
	const channel = parseInt(b.channel, 10)
	const layerNumber = parseInt(b.layerNumber, 10)
	const action = String(b.action || 'next')
	/* WO-347: pre-playout start item for a NOT-live playlist — keyed by sceneId, consumed by
	 * setupLayerPlaylists at the next take of that look. Sticky until changed. */
	if (action === 'set_start') {
		const sceneId = String(b.sceneId || '').trim()
		const idx = parseInt(b.index, 10)
		if (!sceneId || !Number.isFinite(layerNumber) || !Number.isFinite(idx) || idx < 0) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'sceneId, layerNumber, index required' }) }
		}
		ctx.playlistStartIndices = ctx.playlistStartIndices || {}
		ctx.playlistStartIndices[`${sceneId}-${layerNumber}`] = idx
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, sceneId, layerNumber, startIndex: idx }) }
	}
	if (!Number.isFinite(channel) || channel < 1 || !Number.isFinite(layerNumber)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'channel and layerNumber required' }) }
	}
	const liveEntry = liveSceneState.getChannel(channel)
	const scene = liveEntry?.scene
	const layer = scene?.layers?.find((l) => Number(l.layerNumber) === layerNumber)
	if (!layer || layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length === 0) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'No live playlist on that channel/layer' }) }
	}
	const pKey = `${scene.id}-${layerNumber}`
	ctx.playlistActiveIndices = ctx.playlistActiveIndices || {}
	const currentIdx = ctx.playlistActiveIndices[pKey] ?? 0
	const len = layer.playlist.length
	let nextIdx
	if (action === 'goto') {
		nextIdx = parseInt(b.index, 10)
		if (!Number.isFinite(nextIdx) || nextIdx < 0 || nextIdx >= len) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: 'index out of range' }) }
		}
	} else if (action === 'prev') {
		nextIdx = (currentIdx - 1 + len) % len
	} else {
		nextIdx = (currentIdx + 1) % len
	}
	const activeBank = (ctx?.programLayerBankByChannel && ctx.programLayerBankByChannel[String(channel)]) || 'a'
	const pLayer = physicalProgramLayer(layerNumber, activeBank === 'b' ? 'b' : 'a')
	try {
		await triggerPlaylistAdvance(ctx, channel, pLayer, scene, layer, nextIdx)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, channel, layerNumber, currentIndex: currentIdx, nextIndex: nextIdx }),
		}
	} catch (err) {
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: err?.message || String(err) }) }
	}
}

/**
 * @param {string} p
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
	if (p === '/api/playlist/control') return handleControlPost(body, ctx)
	if (p !== '/api/playlist/next') return null

	const b = parseBody(body)
	const channel = parseInt(b.channel, 10)
	const layerNumber = parseInt(b.layerNumber, 10)

	if (!Number.isFinite(channel) || channel < 1) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'Invalid channel' }),
		}
	}

	if (!Number.isFinite(layerNumber)) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'Missing or invalid layerNumber' }),
		}
	}

	// Resolve the live scene layer
	const liveEntry = liveSceneState.getChannel(channel)
	if (!liveEntry || !liveEntry.scene) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'No scene active on this channel' }),
		}
	}

	const scene = liveEntry.scene
	const layer = scene.layers ? scene.layers.find(l => Number(l.layerNumber) === layerNumber) : null

	if (!layer) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'Layer not found' }),
		}
	}

	// Check that it's a playlist with manual advance
	if (layer.sourceMode !== 'list' || !Array.isArray(layer.playlist) || layer.playlist.length === 0) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'Layer is not a playlist' }),
		}
	}

	if (layer.playlistAdvance !== 'manual') {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: false, error: 'Playlist is not in manual advance mode' }),
		}
	}

	// Get the current active index
	const pKey = `${scene.id}-${layerNumber}`
	const self = ctx  // The handler context may have state if needed
	self.playlistActiveIndices = self.playlistActiveIndices || {}
	const currentIdx = self.playlistActiveIndices[pKey] ?? 0

	// Calculate next index
	let nextIdx = currentIdx + 1
	if (nextIdx >= layer.playlist.length) {
		if (layer.playlistLoop !== false) {
			nextIdx = 0
		} else {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: false,
					error: 'At end of playlist and looping is disabled',
				}),
			}
		}
	}

	// Resolve the physical layer using the bank
	const activeBank = (ctx && ctx.programLayerBankByChannel && ctx.programLayerBankByChannel[String(channel)]) || 'a'
	const pLayer = physicalProgramLayer(layerNumber, activeBank === 'b' ? 'b' : 'a')

	// Trigger the playlist advance
	try {
		await triggerPlaylistAdvance(ctx, channel, pLayer, scene, layer, nextIdx)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				channel,
				layerNumber,
				currentIndex: currentIdx,
				nextIndex: nextIdx,
			}),
		}
	} catch (err) {
		return {
			status: 500,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: false,
				error: err?.message || String(err),
			}),
		}
	}
}

module.exports = { handlePost, handleStateGet }
