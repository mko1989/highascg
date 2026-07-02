'use strict'

const fs = require('fs')
const { getRouteString, readCasparSetting } = require('./routing-map')
const {
	LOOK_LAYER_MIN,
	PGM_AUDIO_TRACK_LAYER_MAX,
} = require('../engine/look-layer-ranges')

/**
 * WO-53: each ALSA input has its own (cheap) channel; ALSA plays at this layer on that channel.
 * (Historically this was the base layer on a shared inputs host; kept as 10 for continuity.)
 */
const LIVE_AUDIO_LAYER_BASE = 10

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeAlsaCaptureUri(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	if (/^alsa:\/\//i.test(s)) return s
	if (/^hw:/i.test(s) || /^plughw:/i.test(s) || /^default/i.test(s)) return `alsa://${s}`
	return `alsa://${s}`
}

/**
 * Extract hw card,device from alsa:// or hw: style URIs for conflict checks.
 * @param {string} raw
 * @returns {string|null} e.g. "0,0"
 */
function parseAlsaHwIdentity(raw) {
	const s = String(raw || '').trim().split(/\s+/)[0]
	if (!s) return null
	const uri = normalizeAlsaCaptureUri(s).replace(/^alsa:\/\//i, '')
	const m = uri.match(/^(?:plug)?hw:(\d+),(\d+)/i)
	return m ? `${m[1]},${m[2]}` : null
}

/**
 * Caspar ffmpeg producer accepts `-buffer_size N` after the clip on PLAY (reduces ALSA xruns).
 * @param {object} cfg
 * @returns {number|null}
 */
function resolveLiveAudioAlsaBufferSize(cfg) {
	const raw = readCasparSetting(cfg, 'live_audio_alsa_buffer_size')
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return null
	const n = parseInt(String(raw ?? 131072), 10)
	return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {object} cfg
 * @param {number} slot 1–8
 * @returns {string}
 */
function resolveLiveAudioInputDevice(cfg, slot) {
	const raw = readCasparSetting(cfg, `live_audio_input_${slot}_device`)
	return normalizeAlsaCaptureUri(raw)
}

/**
 * Layer the ALSA producer plays on (its own dedicated channel — WO-53).
 * @param {number} _slot 1–8
 * @returns {number}
 */
function resolveLiveAudioHostLayer(_slot) {
	return LIVE_AUDIO_LAYER_BASE
}

/**
 * Dedicated Caspar channel for an ALSA input slot (WO-53).
 * @param {object} cfg
 * @param {number} slot 1–8
 * @returns {number|null}
 */
function resolveLiveAudioChannel(cfg, slot) {
	const { getChannelMap } = require('./routing-map')
	const map = getChannelMap(cfg)
	const chans = Array.isArray(map.liveAudioInputChannels) ? map.liveAudioInputChannels : []
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1 || n > chans.length) return null
	return chans[n - 1]
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null} route://… (full channel — its own channel hosts only this input) for looks/PGM
 */
function resolveLiveAudioRouteString(cfg, slot) {
	const ch = resolveLiveAudioChannel(cfg, slot)
	if (ch == null) return null
	return getRouteString(ch)
}

/**
 * @param {string} uri
 * @param {object} cfg
 * @returns {string}
 */
function appendAlsaBufferSizeToClip(uri, cfg) {
	const buf = resolveLiveAudioAlsaBufferSize(cfg)
	if (buf == null) return uri
	return `${uri} -buffer_size ${buf}`
}

/**
 * Global / per-screen PortAudio ALSA hw identities (e.g. "0,0") that may block exclusive capture.
 * @param {object} cfg
 * @returns {string[]}
 */
function listPortAudioHwIdentities(cfg) {
	const cs = cfg?.casparServer && typeof cfg.casparServer === 'object' ? cfg.casparServer : cfg
	/** @type {Set<string>} */
	const out = new Set()
	const addRaw = (raw) => {
		const id = parseAlsaHwIdentity(raw)
		if (id) out.add(id)
	}

	const card = readCasparSetting(cfg, 'default_alsa_card')
	const dev = readCasparSetting(cfg, 'default_alsa_device')
	if (card !== undefined && card !== '' && dev !== undefined && dev !== '') {
		addRaw(`hw:${card},${dev}`)
	}

	const globalPa =
		cs?.caspar_global_portaudio === true ||
		cs?.caspar_global_portaudio === 'true' ||
		readCasparSetting(cfg, 'caspar_global_portaudio') === true ||
		readCasparSetting(cfg, 'caspar_global_portaudio') === 'true'

	for (let n = 1; n <= 8; n++) {
		const perScreenEn = readCasparSetting(cfg, `screen_${n}_portaudio_enabled`)
		if (!globalPa && perScreenEn !== true && perScreenEn !== 'true') continue
		addRaw(readCasparSetting(cfg, `screen_${n}_portaudio_device_name`))
	}
	addRaw(readCasparSetting(cfg, 'multiview_portaudio_device_name'))
	addRaw(readCasparSetting(cfg, 'monitor_portaudio_device'))

	const configPath = String(readCasparSetting(cfg, 'configPath') || cfg?.configPath || '').trim()
	if (configPath) {
		try {
			const xml = fs.readFileSync(configPath, 'utf8')
			const block = xml.match(/<portaudio>([\s\S]*?)<\/portaudio>/i)
			if (block) {
				const inner = block[1]
				const dm = inner.match(/<device>([^<]+)<\/device>/i)
				const dnm = inner.match(/<device-name>([^<]+)<\/device-name>/i)
				if (dm?.[1]?.trim()) addRaw(dm[1].trim())
				if (dnm?.[1]?.trim()) addRaw(dnm[1].trim())
			}
		} catch (_) {}
	}

	return [...out]
}

/**
 * Capture URI for PLAY: uses dsnoop when the same hw card is used by PortAudio output.
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null}
 */
function resolveLiveAudioCaptureBaseUri(cfg, slot) {
	const configured = resolveLiveAudioInputDevice(cfg, slot)
	if (!configured) return null
	const body = configured.replace(/^alsa:\/\//i, '')
	if (/^(dsnoop|plugdsnoop):/i.test(body)) return configured

	const captureHw = parseAlsaHwIdentity(configured)
	if (!captureHw) return configured

	const exclusive =
		readCasparSetting(cfg, 'live_audio_capture_exclusive') === true ||
		readCasparSetting(cfg, 'live_audio_capture_exclusive') === 'true'
	if (exclusive) return configured

	const dsnoopOff =
		readCasparSetting(cfg, 'live_audio_capture_dsnoop') === false ||
		readCasparSetting(cfg, 'live_audio_capture_dsnoop') === 'false'
	if (dsnoopOff) return configured

	const portAudioHws = listPortAudioHwIdentities(cfg)
	const shared = portAudioHws.includes(captureHw)
	if (shared) {
		return normalizeAlsaCaptureUri(`dsnoop:${captureHw}`)
	}
	return configured
}

/**
 * Ordered PLAY clip variants (primary + fallbacks) for recovery after ffmpeg open failures.
 * When capture bridge is enabled, only the UDP ingest clip is used (Caspar cannot open alsa://).
 * @param {object} cfg
 * @param {number} slot
 * @returns {string[]}
 */
function listLiveAudioPlayClipVariants(cfg, slot) {
	const { isLiveAudioBridgeEnabled, liveAudioBridgePlayClip } = require('../audio/live-audio-bridge')
	if (isLiveAudioBridgeEnabled(cfg)) {
		return [liveAudioBridgePlayClip(slot)]
	}
	const configured = resolveLiveAudioInputDevice(cfg, slot)
	if (!configured) return []
	const hw = parseAlsaHwIdentity(configured)
	/** @type {string[]} */
	const uris = []
	const addUri = (raw) => {
		const u = normalizeAlsaCaptureUri(raw)
		if (u && !uris.includes(u)) uris.push(u)
	}

	addUri(resolveLiveAudioCaptureBaseUri(cfg, slot))
	if (hw) {
		addUri(`dsnoop:${hw}`)
		addUri(`plughw:${hw}`)
		if (!/^hw:/i.test(configured.replace(/^alsa:\/\//i, ''))) addUri(`hw:${hw}`)
	} else {
		addUri(configured)
	}

	return uris.map((u) => appendAlsaBufferSizeToClip(u, cfg))
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null} AMCP PLAY clip (udp://… when bridge enabled, else alsa://…)
 */
function resolveLiveAudioPlayClip(cfg, slot) {
	const { isLiveAudioBridgeEnabled, liveAudioBridgePlayClip } = require('../audio/live-audio-bridge')
	if (isLiveAudioBridgeEnabled(cfg)) return liveAudioBridgePlayClip(slot)
	const uri = resolveLiveAudioCaptureBaseUri(cfg, slot)
	if (!uri) return null
	return appendAlsaBufferSizeToClip(uri, cfg)
}

/**
 * @param {object} cfg
 * @returns {{ count: number, slots: Array<{ slot: number, layer: number, device: string, clip: string, route: string|null }> }}
 */
function listConfiguredLiveAudioSlots(cfg) {
	const count = Math.min(8, Math.max(0, parseInt(String(readCasparSetting(cfg, 'live_audio_input_count') ?? 0), 10) || 0))
	const slots = []
	for (let i = 1; i <= count; i++) {
		const clip = resolveLiveAudioPlayClip(cfg, i)
		if (!clip) continue
		slots.push({
			slot: i,
			channel: resolveLiveAudioChannel(cfg, i),
			layer: resolveLiveAudioHostLayer(i),
			device: readCasparSetting(cfg, `live_audio_input_${i}_device`),
			clip,
			route: resolveLiveAudioRouteString(cfg, i),
		})
	}
	return { count, slots }
}

/**
 * Which main-screen PGM buses receive always-on live-audio route:// layers on startup.
 * Default: every program output when screen_count > 1 (so PortAudio on PGM 2 hears USB without a manual toggle).
 * @param {object} cfg
 * @returns {number[]} screen indices 1…screenCount
 */
function resolveLiveAudioPgmTargetScreens(cfg) {
	const { getChannelMap } = require('./routing-map')
	const map = getChannelMap(cfg)
	const screenCount = Math.max(1, map.screenCount || 1)

	const rawList = readCasparSetting(cfg, 'live_audio_pgm_screens')
	if (Array.isArray(rawList) && rawList.length) {
		return rawList
			.map((n) => parseInt(String(n), 10))
			.filter((n) => Number.isFinite(n) && n >= 1 && n <= screenCount)
	}
	if (typeof rawList === 'string' && rawList.trim()) {
		return rawList
			.split(/[,;\s]+/)
			.map((n) => parseInt(String(n), 10))
			.filter((n) => Number.isFinite(n) && n >= 1 && n <= screenCount)
	}

	const allRaw = readCasparSetting(cfg, 'live_audio_pgm_all_screens')
	const allExplicitOff = allRaw === false || allRaw === 'false' || allRaw === 0 || allRaw === '0'
	const allExplicitOn = allRaw === true || allRaw === 'true' || allRaw === 1 || allRaw === '1'
	const useAll = allExplicitOn || (!allExplicitOff && screenCount > 1)

	if (useAll) {
		return Array.from({ length: screenCount }, (_, i) => i + 1)
	}

	const single = Math.max(1, parseInt(String(readCasparSetting(cfg, 'live_audio_pgm_screen') ?? 1), 10) || 1)
	return [Math.min(single, screenCount)]
}

/**
 * PGM layers used by live_audio_pgm_always_on routes (must stay within audio track slots 1–9).
 * @param {object} cfg
 * @returns {Array<{ channel: number, layer: number, slot: number, screen: number }>}
 */
function listLiveAudioPgmProtectedLayers(cfg) {
	const alwaysOn =
		readCasparSetting(cfg, 'live_audio_pgm_always_on') !== false &&
		readCasparSetting(cfg, 'live_audio_pgm_always_on') !== 'false'
	if (!alwaysOn) return []
	const { slots } = listConfiguredLiveAudioSlots(cfg)
	if (!slots.length) return []
	const baseLayer = Math.min(
		PGM_AUDIO_TRACK_LAYER_MAX,
		Math.max(1, parseInt(String(readCasparSetting(cfg, 'live_audio_pgm_layer') ?? 2), 10) || 2),
	)
	const { getChannelMap } = require('./routing-map')
	const map = getChannelMap(cfg)
	const out = []
	for (const screen of resolveLiveAudioPgmTargetScreens(cfg)) {
		const pgmCh = map.programCh(screen)
		if (!Number.isFinite(pgmCh) || pgmCh < 1) continue
		for (let i = 0; i < slots.length; i++) {
			const layer = baseLayer + i
			if (layer < 1 || layer > PGM_AUDIO_TRACK_LAYER_MAX) continue
			out.push({ channel: pgmCh, layer, slot: slots[i].slot, screen })
		}
	}
	return out
}

module.exports = {
	LIVE_AUDIO_LAYER_BASE,
	LOOK_LAYER_MIN,
	PGM_AUDIO_TRACK_LAYER_MAX,
	normalizeAlsaCaptureUri,
	parseAlsaHwIdentity,
	appendAlsaBufferSizeToClip,
	listPortAudioHwIdentities,
	resolveLiveAudioCaptureBaseUri,
	listLiveAudioPlayClipVariants,
	resolveLiveAudioAlsaBufferSize,
	resolveLiveAudioInputDevice,
	resolveLiveAudioHostLayer,
	resolveLiveAudioChannel,
	resolveLiveAudioRouteString,
	resolveLiveAudioPlayClip,
	listConfiguredLiveAudioSlots,
	resolveLiveAudioPgmTargetScreens,
	listLiveAudioPgmProtectedLayers,
}
