'use strict'

/**
 * WO-1012 stage B — a Zoom source (presenter / share / gallery) as a HOST CHANNEL: a dedicated Caspar channel that
 * plays the source's shm ring, so the operator routes it like any input (device graph, looks: route://<ch>-<layer>).
 *
 * The fourth host-live kind next to webpage_host / ndi_host / browser_display (host-live-sources.js), stored as an
 * `extraLiveSources` entry:
 *   { type: 'zoom', routeType: 'zoom_host', source: 'share', hostChannel, hostLayer, sourceId: 'zoom_share',
 *     label: 'Zoom share', value: 'route://<ch>-<layer>', hostRole: 'zoom_host' }
 *
 * The ring `zoom-<source>` (src/zoom/zoom-grab.js) has a fixed size, so the channel runs DEFAULT_HOST_MODE like the
 * NDI and browser hosts. Caspar's shm producer (WO-742) waits for a writer and re-opens the segment by itself, so the
 * PLAY is safe when the grab is not running yet: no ready-check before it (unlike browser_display's capture bridge).
 */

const { getRouteString } = require('./routing-map')

const ZOOM_SOURCES = ['presenter', 'share', 'gallery']
const ZOOM_HOST_ROLE = 'zoom_host'

/** @param {string} source */
function zoomRingName(source) {
	return `zoom-${source}`
}

/**
 * @param {object} item
 * @returns {boolean}
 */
function isZoomHostCandidate(item) {
	if (!item || typeof item !== 'object') return false
	return item.routeType === ZOOM_HOST_ROLE || item.type === 'zoom'
}

/**
 * The Zoom source an entry plays: `source`, else the `zoom_<source>` sourceId, else the `shm://zoom-<source>` value.
 * @param {object} item
 * @returns {string} '' when it names none of the three
 */
function zoomSourceOf(item) {
	const candidates = [
		item?.source,
		String(item?.sourceId || '').replace(/^zoom_/, ''),
		String(item?.value || '').replace(/^shm:\/\/zoom-/i, ''),
	]
	for (const c of candidates) {
		const s = String(c || '').trim().toLowerCase()
		if (ZOOM_SOURCES.includes(s)) return s
	}
	return ''
}

/**
 * @param {object} item
 * @param {object} ctx — `{ config }`; a missing hostChannel takes the next free channel of that config
 */
function normalizeZoomHostSource(item, ctx) {
	const source = zoomSourceOf(item)
	if (!source) throw new Error(`Zoom source must be one of ${ZOOM_SOURCES.join(', ')}`)
	// Lazy: host-live-sources.js requires this module.
	const { HOST_LAYER, suggestNextHostChannel } = require('./host-live-sources')
	let hostChannel = parseInt(String(item.hostChannel ?? ''), 10)
	if (!Number.isFinite(hostChannel) || hostChannel < 1) hostChannel = suggestNextHostChannel(ctx?.config || {})
	const hostLayer = parseInt(String(item.hostLayer ?? HOST_LAYER), 10) || HOST_LAYER
	const sourceId = String(item.sourceId || `zoom_${source}`).trim()
	return {
		type: 'zoom',
		routeType: ZOOM_HOST_ROLE,
		source,
		ring: zoomRingName(source),
		value: getRouteString(hostChannel, hostLayer),
		label: String(item.label || `Zoom ${source}`).trim() || sourceId,
		hostChannel,
		hostLayer,
		sourceId,
		interactiveCapable: false,
		hostRole: ZOOM_HOST_ROLE,
	}
}

/**
 * @param {number} ch
 * @param {number} layer
 * @param {object} item
 * @returns {string[]}
 */
function zoomHostPlayCommands(ch, layer, item) {
	const source = zoomSourceOf(item)
	if (!source) return []
	return [`PLAY ${ch}-${layer} SHM NAME ${zoomRingName(source)}`, `MIXER ${ch}-${layer} FILL 0 0 1 1`, `MIXER ${ch} COMMIT`]
}

module.exports = {
	ZOOM_SOURCES,
	isZoomHostCandidate,
	zoomSourceOf,
	normalizeZoomHostSource,
	zoomHostPlayCommands,
}
