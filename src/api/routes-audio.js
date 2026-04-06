/**
 * Audio API — device list (no Caspar), volume (AMCP), routing config.
 * @see 06_WO_AUDIO_PLAYOUT.md T4.2
 */

'use strict'

const defaults = require('../../config/default')
const { listAudioDevices } = require('../audio/audio-devices')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {string} path
 * @param {string} query
 */
function handleGet(path, query) {
	if (path !== '/api/audio/devices') return null
	const refresh = query.refresh === '1' || query.refresh === 'true'
	const data = listAudioDevices({ refresh })
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
}

/**
 * @param {string} path
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(path, body, ctx) {
	if (path === '/api/audio/config') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
		}
		const ar = b.audioRouting
		if (!ar || typeof ar !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Expected { audioRouting: { ... } }' }) }
		}
		const base = defaults.audioRouting || {}
		ctx.config.audioRouting = { ...base, ...(ctx.config.audioRouting || {}), ...ar }
		if (ctx.configManager) {
			const newConfig = {
				...ctx.configManager.get(),
				audioRouting: ctx.config.audioRouting,
			}
			ctx.configManager.save(newConfig)
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, audioRouting: ctx.config.audioRouting }) }
	}

	if (path === '/api/audio/volume') {
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid body' }) }
		}
		const channel = b.channel != null ? parseInt(String(b.channel), 10) : 1
		const amcp = ctx.amcp
		try {
			if (b.master === true) {
				const r = await amcp.mixer.mixerMastervolume(channel, b.volume, b.duration, b.tween, b.defer)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
			}
			const layer = b.layer != null ? parseInt(String(b.layer), 10) : 0
			const r = await amcp.mixer.mixerVolume(channel, layer, b.volume, b.duration, b.tween, b.defer)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(r) }
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	if (path === '/api/audio/route') {
		return {
			status: 501,
			headers: JSON_HEADERS,
			body: jsonBody({
				error:
					'Channel routing is not exposed via AMCP in this build. Configure audio buses in Caspar config / HighAsCG config generator.',
			}),
		}
	}

	return null
}

module.exports = { handleGet, handlePost }
