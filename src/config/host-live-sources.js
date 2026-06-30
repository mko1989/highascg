'use strict'

const { getChannelMap, getRouteString } = require('./routing-map')
const { getModeDimensions } = require('./config-modes')

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
 * @param {object} item
 * @returns {boolean}
 */
function isHostLiveSource(item) {
	return isWebpageHostCandidate(item) || isNdiHostCandidate(item)
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
	push(map.inputsCh)
	push(map.streamingCh)
	push(map.monitorCh)
	;(map.audioOnlyChannels || []).forEach(push)
	;(map.decklinkInputChannels || []).forEach(push)
	;(map.liveAudioInputChannels || []).forEach(push)
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
	if (!raw) throw new Error('NDI source name required')
	const ndiName = raw.startsWith('ndi://') ? raw : raw.includes('"') ? raw : `ndi://${raw}`
	const display = raw.startsWith('ndi://') ? raw.substring(6).replace(/\/"([^"]+)"/, ' $1') : raw

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
 * @param {object} item
 * @param {object} ctx
 */
function normalizeToHostLiveSource(item, ctx) {
	if (!item || typeof item !== 'object') return item
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
		const kind = isWebpageHostCandidate(item) ? 'webpage_host' : 'ndi_host'
		out.push({
			kind,
			sourceId: item.sourceId,
			channel: hostChannel,
			layer: hostLayer,
			mode: kind === 'ndi_host' ? DEFAULT_HOST_MODE : mode,
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
		const name = String(item.ndiName || item.value || '').trim()
		if (!name) return []
		const esc = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
		return [`PLAY ${ch}-${layer} NDI "${esc}"`, `MIXER ${ch} COMMIT`]
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
	if (r === 'webpage_host') {
		const sid = String(slotOrSourceId ?? ch ?? '').trim()
		return sid ? `host_webpage_${sid}` : `host_webpage_ch_${ch}`
	}
	if (r === 'ndi_host') {
		const sid = String(slotOrSourceId ?? ch ?? '').trim()
		return sid ? `host_ndi_${sid}` : `host_ndi_ch_${ch}`
	}
	return `host_${r}_${ch}`
}

module.exports = {
	HOST_LAYER,
	DEFAULT_HOST_MODE,
	isHostLiveSource,
	isWebpageHostCandidate,
	isNdiHostCandidate,
	listHostLiveChannelEntries,
	mergeHostLiveChannelsIntoRouting,
	normalizeToHostLiveSource,
	normalizeWebpageHostSource,
	normalizeNdiHostSource,
	suggestNextHostChannel,
	amcpCommandsForHostLiveSource,
	slugSourceId,
	hostChannelDestinationId,
	resolveWebpagePlayTarget,
}
