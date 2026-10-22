'use strict'

/**
 * WO-683: the custom Caspar build's PortAudio consumer reads only the global `configuration.portaudio.*`
 * (portaudio_consumer.cpp `env::properties()`), so a server drives ONE PortAudio device. The first enabled
 * PortAudio row in `audioOutputs` is that output; any other PortAudio row is skipped by the generator and
 * by every bus-width mirror. A missing `type` reads as PortAudio, as everywhere else.
 */

/** Host APIs the Linux build resolves (`resolve_host_api_type`): auto = ALSA, then JACK. */
const PORTAUDIO_HOST_APIS = ['auto', 'ALSA', 'JACK']

/**
 * @param {unknown} out
 * @returns {boolean}
 */
function isPortAudioRow(out) {
	if (!out || typeof out !== 'object') return false
	const o = /** @type {Record<string, unknown>} */ (out)
	if (o.enabled === false || o.enabled === 'false') return false
	return String(o.type || 'portaudio').toLowerCase() !== 'system-audio'
}

/**
 * @param {unknown} audioOutputs
 * @returns {string} id of the server's PortAudio output, '' when there is none
 */
function portAudioOutputId(audioOutputs) {
	const list = Array.isArray(audioOutputs) ? audioOutputs : []
	for (const out of list) {
		if (!isPortAudioRow(out)) continue
		const id = String(/** @type {Record<string, unknown>} */ (out).id || '').trim()
		if (id) return id
	}
	return ''
}

/**
 * @param {unknown} v
 * @returns {string} one of PORTAUDIO_HOST_APIS (ASIO / WASAPI / CoreAudio and unknown values → 'auto')
 */
function normalizeHostApi(v) {
	const s = String(v ?? '').trim().toLowerCase()
	return PORTAUDIO_HOST_APIS.find((a) => a.toLowerCase() === s) || 'auto'
}

module.exports = { PORTAUDIO_HOST_APIS, isPortAudioRow, portAudioOutputId, normalizeHostApi }
