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
	// A timer parked on a preview channel to be prepared (POST /api/timers/bus) is not part of the look: the
	// preview's whole-channel CLEAR took it with everything else, so it is put straight back.
	if (isPreviewCasparChannel(self?.config, ch) && typeof amcp.batchSendChunked === 'function') {
		try {
			const lines = require('./screen-timers').linesForReAdd(ch)
			if (lines.length) await amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
		} catch (_) {}
	}
	if (self && opts.clearMatrix !== false) {
		try {
			playbackTracker.clearChannelFromMatrix(self, ch)
		} catch (_) {}
	}
}

module.exports = { clearCasparChannel, isPreviewCasparChannel }
