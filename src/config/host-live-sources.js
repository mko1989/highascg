'use strict'

const { getChannelMap, getRouteString } = require('./routing-map')
const { getModeDimensions } = require('./config-modes')
const { normalizeNdiSourceName, ndiDisplayLabel, buildNdiHostPlayCommands } = require('./ndi-playback')
const { browserCapturePlayClip } = require('../capture/browser-capture-args')

/** Default layer for webpage / NDI host producers (WO-88). */
const HOST_LAYER = 1
const DEFAULT_HOST_MODE = '1080p5000'

/**
 * @param {string} raw
 * @returns {string}
 */
function slugSourceId(raw) {
	return String(raw || 'source')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 48) || 'source'
}

/**
 * @param {object} item
 * @returns {boolean}
 */
function isWebpageHostCandidate(item) {
	if (!item || typeof item !== 'object') return false
	if (item.routeType === 'webpage_host') return true
	// WO-258: 'browser_display' items also carry type:'browser' (real Firefox + x11grab, not CEF) —
	// exclude them explicitly so the two candidate checks stay mutually exclusive regardless of
	// call-site ordering (see isBrowserDisplayCandidate below).
	if (item.routeType === 'browser_display' || item.mode === 'browser_display') return false
	if (item.type !== 'browser') return false
	if (item.browserAsCg === true) return false
	if (item.routeType === 'layer') return false
	return true
}

/**
 * @param {object} item
 * @returns {boolean}
 */
function isNdiHostCandidate(item) {
	if (!item || typeof item !== 'object') return false
	if (item.routeType === 'ndi_host') return true
	return item.type === 'ndi'
}

/**
 * WO-258: a real Firefox on an off-screen `:0` region, captured via x11grab and relayed into Caspar
 * as a udp:// clip (see src/capture/browser-capture-args.js) — distinct from `webpage_host`, which
 * still plays CEF's `[HTML]` producer (WO-258 scopes CEF to templates only; existing webpage_host
 * items with raw http(s) URLs are left as-is rather than force-migrated, see WO-258 report).
 * @param {object} item
 * @returns {boolean}
 */
function isBrowserDisplayCandidate(item) {
	if (!item || typeof item !== 'object') return false
	if (item.routeType === 'browser_display') return true
	return item.mode === 'browser_display'
}

/**
 * @param {object} item
 * @returns {boolean}
 */
function isHostLiveSource(item) {
	return isWebpageHostCandidate(item) || isNdiHostCandidate(item) || isBrowserDisplayCandidate(item)
}

/**
 * @param {object} config
 * @returns {object[]}
 */
function listExtraLiveSources(config) {
	return Array.isArray(config?.extraLiveSources) ? config.extraLiveSources : []
}

/**
 * @param {object} config
 * @returns {Set<number>}
 */
function usedCasparChannels(config) {
	const map = getChannelMap(config)
	const used = new Set()
	const push = (n) => {
		const v = parseInt(String(n), 10)
		if (Number.isFinite(v) && v >= 1) used.add(v)
	}
	;(map.programChannels || []).forEach(push)
	;(map.previewChannels || []).forEach(push)
	;(map.switcherBusChannels || []).forEach(push)
	push(map.multiviewCh)
	;(map.multiviewChannels || []).forEach(push)
	// WO-381: the operator_gui utility channel is allocated by routing-map.js exactly like
	// multiview, but was never counted here — so suggestNextHostChannel handed a new host live
	// source the Operator GUI's own channel (ch 4 on the live box) and the two collided.
	push(map.operatorGuiCh)
	;(map.operatorGuiChannels || []).forEach(push)
	push(map.inputsCh)
	push(map.streamingCh)
	push(map.monitorCh)
	;(map.audioOnlyChannels || []).forEach(push)
	;(map.decklinkInputChannels || []).forEach(push)
	;(map.liveAudioInputChannels || []).forEach(push)
	;(map.v4l2InputChannels || []).forEach(push)
	;(map.inputChannels || []).forEach((e) => push(e.channel))
	for (const item of listExtraLiveSources(config)) {
		push(item.hostChannel)
		const parsed = parseRouteValue(item.value)
		if (parsed) push(parsed.channel)
	}
	return used
}

/**
 * @param {string} value
 */
function parseRouteValue(value) {
	const m = String(value || '')
		.trim()
		.match(/^route:\/\/(\d+)(?:-(\d+))?$/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	const layer = m[2] != null ? parseInt(m[2], 10) : HOST_LAYER
	if (!Number.isFinite(channel) || channel < 1) return null
	return { channel, layer: Number.isFinite(layer) ? layer : HOST_LAYER }
}

/**
 * @param {object} config
 * @param {number} [avoid]
 */
function suggestNextHostChannel(config, avoid = 0) {
	const used = usedCasparChannels(config)
	if (avoid > 0) used.add(avoid)
	let ch = 1
	while (used.has(ch)) ch++
	return ch
}

/**
 * @param {string} urlOrTemplate
 * @returns {{ templateOrUrl: string, cefNeedle: string, playArg: string }}
 */
function resolveWebpagePlayTarget(urlOrTemplate) {
	const raw = String(urlOrTemplate || '').trim()
	if (!raw) return { templateOrUrl: '', cefNeedle: '', playArg: '' }
	if (/^https?:\/\//i.test(raw)) {
		let needle = slugSourceId(raw).slice(0, 32) || 'webpage'
		try {
			const host = new URL(raw).hostname
			if (host) needle = host
		} catch (_) {}
		return { templateOrUrl: raw, cefNeedle: needle, playArg: raw }
	}
	const base = raw.split(/[/\\]/).pop() || raw
	const template = base.replace(/\.html$/i, '') || base
	return { templateOrUrl: template, cefNeedle: template, playArg: template }
}

/**
 * @param {object} item
 * @param {object} ctx
 */
function normalizeWebpageHostSource(item, ctx) {
	const config = ctx?.config || {}
	const urlOrTemplate = String(item.templateOrUrl || item.value || item.label || '').trim()
	const { templateOrUrl, cefNeedle, playArg } = resolveWebpagePlayTarget(urlOrTemplate)
	if (!playArg) throw new Error('Webpage URL or template name required')

	let hostChannel = parseInt(String(item.hostChannel ?? ''), 10)
	if (!Number.isFinite(hostChannel) || hostChannel < 1) {
		hostChannel = suggestNextHostChannel(config)
	}
	const hostLayer = parseInt(String(item.hostLayer ?? HOST_LAYER), 10) || HOST_LAYER
	const sourceId = String(item.sourceId || `webpage_${slugSourceId(cefNeedle || templateOrUrl)}`).trim()

	return {
		type: 'browser',
		routeType: 'webpage_host',
		value: getRouteString(hostChannel, hostLayer),
		label: String(item.label || templateOrUrl || cefNeedle).trim() || sourceId,
		hostChannel,
		hostLayer,
		sourceId,
		templateOrUrl,
		cefNeedle,
		playArg,
		interactiveCapable: item.interactiveCapable !== false,
		hostRole: 'webpage_host',
	}
}

/**
 * @param {object} item
 * @param {object} ctx
 */
function normalizeNdiHostSource(item, ctx) {
	const config = ctx?.config || {}
	const raw = String(item.ndiName || item.value || item.label || '').trim()
	const ndiName = normalizeNdiSourceName(raw)
	const display = ndiDisplayLabel(ndiName)

	let hostChannel = parseInt(String(item.hostChannel ?? ''), 10)
	if (!Number.isFinite(hostChannel) || hostChannel < 1) {
		hostChannel = suggestNextHostChannel(config)
	}
	const hostLayer = parseInt(String(item.hostLayer ?? HOST_LAYER), 10) || HOST_LAYER
	const sourceId = String(item.sourceId || `ndi_${slugSourceId(display)}`).trim()

	return {
		type: 'ndi',
		routeType: 'ndi_host',
		value: getRouteString(hostChannel, hostLayer),
		label: String(item.label || display).trim() || sourceId,
		hostChannel,
		hostLayer,
		sourceId,
		ndiName,
		interactiveCapable: false,
		hostRole: 'ndi_host',
		useDirect: false,
	}
}

/**
 * WO-258 T258.3: normalize a `browser_display` extraLiveSources entry — url/width/height/fps drive
 * the real Firefox session + x11grab capture (see src/system/browser-source-session.js,
 * src/capture/browser-capture-*.js); `hostChannel`/`hostLayer`/`value` follow the same host-channel
 * allocation convention as webpage_host/ndi_host.
 * @param {object} item
 * @param {object} ctx
 */
function normalizeBrowserDisplaySource(item, ctx) {
	const config = ctx?.config || {}
	const url = String(item.url || item.value || '').trim()
	if (!/^https?:\/\//i.test(url)) throw new Error('Browser source requires an http(s) URL')

	let hostChannel = parseInt(String(item.hostChannel ?? ''), 10)
	if (!Number.isFinite(hostChannel) || hostChannel < 1) {
		hostChannel = suggestNextHostChannel(config)
	}
	const hostLayer = parseInt(String(item.hostLayer ?? HOST_LAYER), 10) || HOST_LAYER
	const width = Math.max(160, parseInt(String(item.width ?? 1920), 10) || 1920)
	const height = Math.max(120, parseInt(String(item.height ?? 1080), 10) || 1080)
	const fps = Math.max(1, Math.min(60, parseInt(String(item.fps ?? 25), 10) || 25))
	let sourceId = String(item.sourceId || '').trim()
	if (!sourceId) {
		let host = 'browser'
		try {
			host = new URL(url).hostname || 'browser'
		} catch (_) {
			/* fall back to default */
		}
		sourceId = `browser_${slugSourceId(host)}`
	}

	return {
		type: 'browser',
		routeType: 'browser_display',
		mode: 'browser_display',
		value: getRouteString(hostChannel, hostLayer),
		label: String(item.label || url).trim() || sourceId,
		hostChannel,
		hostLayer,
		sourceId,
		url,
		width,
		height,
		fps,
		interactiveCapable: true,
		hostRole: 'browser_display',
	}
}

/**
 * @param {object} item
 * @param {object} ctx
 */
function normalizeToHostLiveSource(item, ctx) {
	if (!item || typeof item !== 'object') return item
	if (isBrowserDisplayCandidate(item)) return normalizeBrowserDisplaySource(item, ctx)
	if (isWebpageHostCandidate(item)) return normalizeWebpageHostSource(item, ctx)
	if (isNdiHostCandidate(item)) return normalizeNdiHostSource(item, ctx)
	return item
}

/**
 * @param {object} config
 * @returns {object[]}
 */
function listHostLiveChannelEntries(config) {
	const mode = String(config?.casparServer?.webpage_host_channel_mode || config?.webpage_host_channel_mode || DEFAULT_HOST_MODE)
	const out = []
	for (const item of listExtraLiveSources(config)) {
		if (!isHostLiveSource(item)) continue
		const hostChannel = parseInt(String(item.hostChannel ?? ''), 10)
		if (!Number.isFinite(hostChannel) || hostChannel < 1) continue
		const hostLayer = parseInt(String(item.hostLayer ?? HOST_LAYER), 10) || HOST_LAYER
		const kind = isBrowserDisplayCandidate(item) ? 'browser_display' : isWebpageHostCandidate(item) ? 'webpage_host' : 'ndi_host'
		out.push({
			kind,
			sourceId: item.sourceId,
			channel: hostChannel,
			layer: hostLayer,
			// browser_display's udp/mpegts producer resamples like NDI does — DEFAULT_HOST_MODE for both,
			// same conservative choice as ndi_host (arbitrary browser width/height/fps isn't guaranteed
			// to be a valid Caspar channel video-mode string).
			mode: kind === 'ndi_host' || kind === 'browser_display' ? DEFAULT_HOST_MODE : mode,
			route: getRouteString(hostChannel, hostLayer),
			label: item.label || item.sourceId || kind,
			item,
		})
	}
	return out
}

/**
 * @param {object} config
 * @param {number} nextCh
 */
function mergeHostLiveChannelsIntoRouting(config, nextCh) {
	const entries = listHostLiveChannelEntries(config)
	let ch = nextCh
	for (const e of entries) {
		ch = Math.max(ch, e.channel + 1)
	}
	return { entries, nextCh: ch }
}

/**
 * @param {object} item
 * @returns {string[]}
 */
function amcpCommandsForHostLiveSource(item) {
	if (!item || !isHostLiveSource(item)) return []
	const ch = parseInt(String(item.hostChannel), 10)
	const layer = parseInt(String(item.hostLayer ?? HOST_LAYER), 10) || HOST_LAYER
	if (!Number.isFinite(ch) || ch < 1) return []

	if (isBrowserDisplayCandidate(item)) {
		// The capture bridge (src/capture/browser-capture-bridge.js) must already be relaying to this
		// port before this PLAY lands — see ensureBrowserDisplaySourceReady in
		// src/config/host-live-sources-browser-runtime.js, which host-live-sources-setup.js calls
		// first for browser_display entries.
		const clip = browserCapturePlayClip(ch)
		return [`PLAY ${ch}-${layer} ${clip}`, `MIXER ${ch}-${layer} FILL 0 0 1 1`, `MIXER ${ch} COMMIT`]
	}
	if (isWebpageHostCandidate(item)) {
		const playArg = item.playArg || item.templateOrUrl || item.cefNeedle
		if (!playArg) return []
		return [
			`PLAY ${ch}-${layer} [HTML] ${playArg} LOOP`,
			`MIXER ${ch}-${layer} FILL 0 0 1 1`,
			`MIXER ${ch} COMMIT`,
		]
	}
	if (isNdiHostCandidate(item)) {
		return buildNdiHostPlayCommands(ch, layer, item.ndiName || item.value || '')
	}
	return []
}

/**
 * Stable destination id for a host-channel row (server + client).
 * @param {string} role
 * @param {number} ch
 * @param {string|number} [slotOrSourceId]
 * @returns {string}
 */
function hostChannelDestinationId(role, ch, slotOrSourceId) {
	const r = String(role || '').trim()
	if (r === 'inputs_host') return 'host_inputs'
	if (r === 'streaming_channel') return 'host_streaming'
	if (r === 'extra_audio') return `host_extra_audio_${ch}`
	if (r === 'decklink_input') {
		const s = parseInt(String(slotOrSourceId ?? ''), 10)
		return s >= 1 ? `host_decklink_input_${s}` : `host_decklink_ch_${ch}`
	}
	if (r === 'live_audio_input') {
		const s = parseInt(String(slotOrSourceId ?? ''), 10)
		return s >= 1 ? `host_live_audio_input_${s}` : `host_live_audio_ch_${ch}`
	}
	if (r === 'v4l2_input') {
		const s = parseInt(String(slotOrSourceId ?? ''), 10)
		return s >= 1 ? `host_v4l2_input_${s}` : `host_v4l2_ch_${ch}`
	}
	if (r === 'webpage_host') {
		const sid = String(slotOrSourceId ?? ch ?? '').trim()
		return sid ? `host_webpage_${sid}` : `host_webpage_ch_${ch}`
	}
	if (r === 'ndi_host') {
		const sid = String(slotOrSourceId ?? ch ?? '').trim()
		return sid ? `host_ndi_${sid}` : `host_ndi_ch_${ch}`
	}
	if (r === 'browser_display') {
		const sid = String(slotOrSourceId ?? ch ?? '').trim()
		return sid ? `host_browser_${sid}` : `host_browser_ch_${ch}`
	}
	return `host_${r}_${ch}`
}

module.exports = {
	HOST_LAYER,
	DEFAULT_HOST_MODE,
	isHostLiveSource,
	isWebpageHostCandidate,
	isNdiHostCandidate,
	isBrowserDisplayCandidate,
	listHostLiveChannelEntries,
	mergeHostLiveChannelsIntoRouting,
	normalizeToHostLiveSource,
	normalizeWebpageHostSource,
	normalizeNdiHostSource,
	normalizeBrowserDisplaySource,
	suggestNextHostChannel,
	amcpCommandsForHostLiveSource,
	slugSourceId,
	hostChannelDestinationId,
	resolveWebpagePlayTarget,
}
