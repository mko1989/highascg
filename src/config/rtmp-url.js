'use strict'

/**
 * Combine RTMP ingest base URL and stream key for FFmpeg (e.g. YouTube: `rtmp://…/live2` + key).
 * @param {string} serverUrl
 * @param {string} streamKey
 * @returns {string}
 */
function joinRtmpServerUrlAndStreamKey(serverUrl, streamKey) {
	const s = String(serverUrl || '').trim().replace(/\/+$/, '')
	const k = String(streamKey || '').trim().replace(/^\/+/, '')
	if (!s && !k) return ''
	if (!k) return s
	if (!s) return k
	return `${s}/${k}`
}

/**
 * Effective FLV URL for FFmpeg: prefers server URL + stream key; falls back to legacy single `rtmpUrl`.
 * @param {Record<string, unknown>} raw - one destination object
 * @returns {string}
 */
function getEffectiveRtmpDestinationUrl(raw) {
	if (!raw || typeof raw !== 'object') return ''
	const server = String(raw.rtmpServerUrl ?? '').trim()
	const key = String(raw.streamKey ?? '').trim()
	const legacy = String(raw.rtmpUrl || raw.url || '').trim()
	if (server || key) return joinRtmpServerUrlAndStreamKey(server, key)
	return legacy
}

module.exports = { joinRtmpServerUrlAndStreamKey, getEffectiveRtmpDestinationUrl }
