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
 * @param {string} p
 * @param {string|object} body
 * @param {object} ctx
 */
async function handlePost(p, body, ctx) {
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

module.exports = { handlePost }
