/**
 * Audio API — device list (no Caspar), volume (AMCP), routing config.
 * @see 06_WO_AUDIO_PLAYOUT.md T4.2
 */

'use strict'

const defaults = require('../config/defaults')
const { normalizeAudioRouting } = require('../config/config-generator')
const { listAudioDevices, listPortAudioDevices } = require('../audio/audio-devices')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * @param {object} ctx
 * @param {'info'|'warn'|'error'|'debug'} level
 * @param {string} msg
 */
function apiLog(ctx, level, msg) {
	if (ctx && typeof ctx.log === 'function') ctx.log(level, msg)
}

/**
 * @param {string} path
 * @param {string} query
 */
function handleGet(path, query) {
	if (path === '/api/audio/devices') {
		const refresh = query.refresh === '1' || query.refresh === 'true'
		const data = listAudioDevices({ refresh })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	}
	if (path === '/api/audio/portaudio-devices') {
		const refresh = query.refresh === '1' || query.refresh === 'true'
		const outputsOnly = query.outputsOnly !== '0' && query.outputsOnly !== 'false'
		const data = listPortAudioDevices({ refresh, outputsOnly })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	}
	return null
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
		ctx.config.audioRouting = normalizeAudioRouting({ ...base, ...(ctx.config.audioRouting || {}), ...ar })
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

	if (path === '/api/audio/default-device') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
		}
		if (b.card == null || b.device == null) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Missing card or device' }) }
		}
		const card = parseInt(b.card, 10)
		const device = parseInt(b.device, 10)
		const scope = b.scope === 'system' ? 'system' : 'user'
		apiLog(
			ctx,
			'info',
			`[Audio] POST /api/audio/default-device card=${card} device=${device} scope=${scope} (user=~/.asoundrc, system=/etc/asound.conf)`
		)
		const { setDefaultAlsaDevice } = require('../audio/audio-devices')
		const res = setDefaultAlsaDevice(card, device, { scope })
		if (!res.ok) {
			apiLog(ctx, 'error', `[Audio] ALSA default write failed (${scope}): ${res.error || 'unknown'}`)
			return {
				status: 500,
				headers: JSON_HEADERS,
				body: jsonBody({
					ok: false,
					scope,
					error: res.error || 'Failed to write ALSA default',
				}),
			}
		}
		apiLog(ctx, 'info', `[Audio] ALSA default updated (${res.scope || scope}) → ${res.path || '?'}`)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ ok: true, scope: res.scope || scope, path: res.path }),
		}
	}
	if (path === '/api/audio/monitor-source') {
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid body' }) }
		}
		const source = String(b.source || 'pgm_1').toLowerCase()
		const map = (require('../config/routing-map')).getChannelMap(ctx.config)
		const monitorCh = map.monitorCh
		if (!monitorCh) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Monitor channel not enabled in config' }) }
		}

		let src = ''
		if (source === 'multiview' && map.multiviewCh != null) src = `route://${map.multiviewCh}`
		else if (source.startsWith('pgm_')) {
			const n = parseInt(source.split('_')[1], 10) || 1
			src = `route://${map.programCh(n)}`
		} else if (source.startsWith('prv_')) {
			const n = parseInt(source.split('_')[1], 10) || 1
			const p = map.previewCh(n)
			if (p != null) src = `route://${p}`
		}

		if (!src) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Invalid source: ${source}` }) }
		}

		try {
			await ctx.amcp.play(monitorCh, 1, src)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, source, monitorCh }) }
		} catch (e) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	return null
}

module.exports = { handleGet, handlePost }
