/**
 * Audio API — device list (no Caspar), volume (AMCP), routing config.
 * @see 06_WO_AUDIO_PLAYOUT.md T4.2
 */

'use strict'

const defaults = require('../config/defaults')
const { normalizeAudioRouting } = require('../config/config-generator')
const { listAudioDevices, listPortAudioDevices } = require('../audio/audio-devices')
const {
	getAlsaMixerState,
	setAlsaMixerControl,
	resolveSuggestedAlsaMixerCard,
	alsaMixerErrorResponse,
} = require('../audio/alsa-mixer')
const {
	normalizeAudioPreview,
	resolveAudioPreviewChannel,
	resolveAudioPreviewDefaultRoute,
} = require('../config/audio-preview')
const { listConfiguredLiveAudioSlots, normalizeAlsaCaptureUri } = require('../config/live-audio-input')
const { getChannelMap } = require('../config/routing')
const { startInputCapture } = require('../audio/live-input-start')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

/**
 * Apply an input-strip volume to every live look layer consuming the target via a LAYER route.
 *
 * A DeckLink input lives on its dedicated host channel (WO-53), and the mixer strip's volume/mute
 * targets that host layer — e.g. MIXER 5-4 VOLUME 0. But a look puts the input on a program
 * channel with `route://5-4`, and a layer route taps the source layer's frames BEFORE the host
 * channel's mixer applies volume. So the mute changed a mix nobody listens to while PGM kept
 * playing the input's audio untouched (owner, live-verified: ch3 layer 10 = route://5-4, Caspar
 * log shows MIXER 5-4 VOLUME 0, PGM2 output unchanged).
 *
 * Exact `route://ch-layer` matches only. A bare channel route (`route://ch`) taps the source
 * channel's MIX — post-mixer — so the host command already reaches it and fanning out would apply
 * the gain twice. Values are LINEAR, same convention the take pipeline uses for look layers
 * (scene-take-pgm-only.js `MIXER ${cl} VOLUME ${vol}`), so a later re-take simply reasserts the
 * look's own volume — take remains the authority on look state.
 * @param {object} amcp
 * @param {number} channel host channel the strip targeted
 * @param {number} layer host layer the strip targeted
 * @param {{ volume?: unknown, duration?: unknown, tween?: unknown, defer?: unknown }} b
 * @returns {Promise<Array<{ channel: number, layer: number }>>} consumers that were updated
 */
async function fanOutVolumeToRouteConsumers(amcp, channel, layer, b) {
	/** @type {Array<{ channel: number, layer: number }>} */
	const applied = []
	let liveState
	try {
		liveState = require('../state/live-scene-state').getAll()
	} catch {
		return applied
	}
	const routeExact = `route://${channel}-${layer}`
	for (const [chStr, entry] of Object.entries(liveState || {})) {
		const consumerCh = parseInt(chStr, 10)
		if (!Number.isFinite(consumerCh) || consumerCh === channel) continue
		for (const l of entry?.scene?.layers || []) {
			if (String(l?.source?.value || '').trim() !== routeExact) continue
			const consumerLayer = parseInt(String(l?.layerNumber), 10)
			if (!Number.isFinite(consumerLayer)) continue
			try {
				await amcp.mixer.mixerVolume(consumerCh, consumerLayer, b.volume, b.duration, b.tween, b.defer)
				applied.push({ channel: consumerCh, layer: consumerLayer })
			} catch {
				/* one consumer failing must not block the others */
			}
		}
	}
	return applied
}

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
 * @param {object} [ctx]
 */
function handleGet(path, query, ctx) {
	if (path === '/api/audio/devices') {
		const refresh = query.refresh === '1' || query.refresh === 'true'
		const data = listAudioDevices({ refresh })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	}
	if (path === '/api/audio/live-inputs') {
		const cfg = ctx?.config || {}
		const map = getChannelMap(cfg)
		const configured = listConfiguredLiveAudioSlots(cfg)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				inputsCh: map.inputsCh,
				liveAudioInputChannels: map.liveAudioInputChannels,
				liveAudioCount: map.liveAudioCount,
				configured,
				status: ctx?._liveAudioInputsStatus ?? null,
			}),
		}
	}
	if (path === '/api/audio/portaudio-devices') {
		const refresh = query.refresh === '1' || query.refresh === 'true'
		const outputsOnly = query.outputsOnly !== '0' && query.outputsOnly !== 'false'
		const data = listPortAudioDevices({ refresh, outputsOnly })
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
	}
	if (path === '/api/audio/alsa-mixer') {
		const cardRaw = query.card != null ? parseInt(String(query.card), 10) : 0
		if (!Number.isFinite(cardRaw) || cardRaw < 0) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'invalid card' }) }
		}
		const refresh = query.refresh === '1' || query.refresh === 'true'
		try {
			const suggestedCard = resolveSuggestedAlsaMixerCard(ctx.config)
			const data = getAlsaMixerState(cardRaw, { refresh, suggestedCard })
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(data) }
		} catch (e) {
			const { status, error } = alsaMixerErrorResponse(e)
			return { status, headers: JSON_HEADERS, body: jsonBody({ error }) }
		}
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
			const fanout = await fanOutVolumeToRouteConsumers(amcp, channel, layer, b)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(fanout.length ? { ...r, fanout } : r) }
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
		const map = getChannelMap(ctx.config)
		const previewCh = resolveAudioPreviewChannel(ctx.config, map)
		const monitorCh = previewCh ?? map.monitorCh
		if (!monitorCh) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Audio preview not enabled (set audioPreview or monitor channel)' }),
			}
		}
		const ap = normalizeAudioPreview(ctx.config)

		let src = ''
		if (source === 'multiview' && map.multiviewCh != null) src = `route://${map.multiviewCh}`
		else if (source.startsWith('pgm_')) {
			const n = parseInt(source.split('_')[1], 10) || 1
			src = `route://${map.programCh(n)}`
		} else if (source.startsWith('prv_') || source.startsWith('preview_')) {
			const n = parseInt(source.split('_')[1], 10) || 1
			const p = map.previewCh(n)
			if (p != null) src = `route://${p}`
		}

		if (!src) {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `Invalid source: ${source}` }) }
		}

		try {
			await ctx.amcp.play(monitorCh, ap.soloLayerStart, src)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, source, previewCh: monitorCh, bus: ap.bus }),
			}
		} catch (e) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/audio/solo') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid body' }) }
		}
		const solos = Array.isArray(b.solos) ? b.solos : [] // [{ channel, layer }]
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}

		const map = getChannelMap(ctx.config)
		const previewCh = resolveAudioPreviewChannel(ctx.config, map)
		const monitorCh = previewCh ?? map.monitorCh
		if (!monitorCh) {
			return {
				status: 400,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'Audio preview not enabled (set audioPreview or monitor channel)' }),
			}
		}
		const ap = normalizeAudioPreview(ctx.config)
		const layer0 = ap.soloLayerStart
		const maxLayers = ap.soloLayerStart + ap.soloLayerCount - 1

		try {
			if (solos.length === 0) {
				const defaultRoute = resolveAudioPreviewDefaultRoute(ctx.config, map)
				if (defaultRoute) await ctx.amcp.play(monitorCh, layer0, defaultRoute)
				for (let l = layer0 + 1; l <= maxLayers; l++) {
					try {
						await ctx.amcp.clear(monitorCh, l)
					} catch (_) {}
				}
				return {
					status: 200,
					headers: JSON_HEADERS,
					body: jsonBody({ ok: true, mode: 'default', previewCh: monitorCh, route: defaultRoute }),
				}
			}
			for (let i = 0; i < solos.length; i++) {
				const s = solos[i]
				await ctx.amcp.play(monitorCh, layer0 + i, `route://${s.channel}-${s.layer}`)
			}
			for (let l = layer0 + solos.length; l <= maxLayers; l++) {
				try {
					await ctx.amcp.clear(monitorCh, l)
				} catch (_) {}
			}
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, mode: 'solo', count: solos.length, previewCh: monitorCh, bus: ap.bus }),
			}
		} catch (e) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/audio/live-inputs/apply') {
		if (!ctx.amcp) {
			return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
		}
		const { setupLiveAudioInputs, setupLiveAudioPgmRoutes } = require('../config/routing-setup')
		try {
			await setupLiveAudioInputs(ctx)
			await setupLiveAudioPgmRoutes(ctx)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ ok: true, status: ctx._liveAudioInputsStatus ?? null }),
			}
		} catch (e) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	// Start (or restart) ONE input's capture producer — the counterpart of the inspector/Sources
	// Stop button. Deliberately per-input: /live-inputs/apply re-PLAYs every configured slot and
	// would glitch inputs that are still on air.
	if (path === '/api/audio/inputs/start') {
		const b = parseBody(body) || {}
		try {
			const res = await startInputCapture(ctx, b)
			const { status, ...payload } = res
			if (!res.ok) {
				apiLog(ctx, 'warn', `[input-start] ${b?.kind || 'live_audio'} slot ${b?.slot}: ${res.reason}`)
				return { status: status || 502, headers: JSON_HEADERS, body: jsonBody({ ...payload, error: res.reason }) }
			}
			apiLog(ctx, 'info', `[input-start] ${res.kind} slot ${res.slot} capture started on ${res.channel}-${res.layer}`)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(payload) }
		} catch (e) {
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
		}
	}

	if (path === '/api/audio/alsa-mixer') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
		}
		try {
			const result = setAlsaMixerControl(b, (level, msg) => apiLog(ctx, level, msg))
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(result) }
		} catch (e) {
			const { status, error } = alsaMixerErrorResponse(e)
			return { status, headers: JSON_HEADERS, body: jsonBody({ error }) }
		}
	}

	if (path === '/api/audio/live-inputs/config') {
		const b = parseBody(body)
		if (!b || typeof b !== 'object') {
			return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Invalid JSON body' }) }
		}
		const cs = { ...(ctx.config.casparServer || {}), ...(b.casparServer || {}) }
		if (b.live_audio_input_count != null) cs.live_audio_input_count = b.live_audio_input_count
		for (let i = 1; i <= 8; i++) {
			const key = `live_audio_input_${i}_device`
			if (b[key] != null) cs[key] = normalizeAlsaCaptureUri(String(b[key]))
		}
		if (b.live_audio_pgm_always_on != null) cs.live_audio_pgm_always_on = b.live_audio_pgm_always_on
		ctx.config.casparServer = { ...defaults.casparServer, ...cs }
		if (ctx.configManager) {
			ctx.configManager.save({ ...ctx.configManager.get(), casparServer: ctx.config.casparServer })
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, casparServer: ctx.config.casparServer }) }
	}

	return null
}

module.exports = { handleGet, handlePost }
