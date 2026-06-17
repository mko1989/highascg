'use strict'

const { getChannelMap } = require('../config/routing')
const playbackTracker = require('../state/playback-tracker')

/**
 * Whether a Caspar channel is a mapped preview (PRV) bus — safe for whole-channel CLEAR.
 * @param {object} [cfg]
 * @param {number} ch
 */
function isPreviewCasparChannel(cfg, ch) {
	const map = getChannelMap(cfg || {})
	const n = parseInt(ch, 10)
	if (!Number.isFinite(n)) return false
	return (map.previewChannels || []).some((p) => Number(p) === n)
}

/**
 * Whether a Caspar channel is the multiview (MVR) output bus.
 * @param {object} [cfg]
 * @param {number} ch
 */
function isMultiviewCasparChannel(cfg, ch) {
	const map = getChannelMap(cfg || {})
	const n = parseInt(ch, 10)
	if (!Number.isFinite(n)) return false
	const mvChs = Array.isArray(map.multiviewChannels)
		? map.multiviewChannels
		: map.multiviewCh != null
			? [map.multiviewCh]
			: []
	return mvChs.some((c) => Number(c) === n)
}

/**
 * Caspar `CLEAR <channel>` — one command clears every layer on the channel.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number|string} channel
 * @param {{ _playbackMatrix?: object, config?: object }} [self]
 * @param {{ clearMatrix?: boolean }} [opts]
 */
async function clearCasparChannel(amcp, channel, self, opts = {}) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || ch < 1 || !amcp) return
	try {
		await amcp.clear(ch)
	} catch {
		try {
			await amcp.raw(`CLEAR ${ch}`)
		} catch (_) {}
	}
	try {
		await amcp.mixerCommit(ch)
	} catch (_) {}
	if (self && opts.clearMatrix !== false) {
		try {
			playbackTracker.clearChannelFromMatrix(self, ch)
		} catch (_) {}
	}
}

module.exports = { clearCasparChannel, isPreviewCasparChannel, isMultiviewCasparChannel }
