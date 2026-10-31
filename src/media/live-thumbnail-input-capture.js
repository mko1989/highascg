/**
 * Live-thumbnail channel classification (pure; 2026-07-19, reshaped by WO-887).
 *
 * A look layer whose source is a DeckLink / V4L2 input has no media file, so its only possible thumbnail is a
 * PRINT of the dedicated input channel. Since WO-887 every live channel (inputs AND PGM/PRV buses) gets one
 * PRINT per node session (src/media/live-thumbnail-session.js) — the old per-GET backoff gate and the
 * "inputs only" rule are gone. What stays here is which channels have a picture at all:
 *   - audio-only channels (live-audio inputs, `audioOnlyChannels`) print black forever → never captured;
 *   - `listLiveThumbnailChannels` is the "all" set for POST /api/thumbnail/live/recapture.
 */
'use strict'

/** @param {unknown} v @param {Set<number>} out */
function pushChannel(v, out) {
	const n = parseInt(String(v), 10)
	if (Number.isFinite(n) && n > 0) out.add(n)
}

/** @param {unknown} list */
function asArray(list) {
	return Array.isArray(list) ? list : []
}

/**
 * Channels that host a dedicated capture input (DeckLink / V4L2). Pure.
 * @param {object | null | undefined} channelMap
 * @returns {number[]}
 */
function listInputCaptureChannels(channelMap) {
	const out = new Set()
	for (const e of asArray(channelMap?.inputChannels)) {
		if (e && (e.kind === 'decklink' || e.kind === 'v4l2')) pushChannel(e.channel, out)
	}
	for (const c of asArray(channelMap?.decklinkInputChannels)) pushChannel(c, out)
	for (const c of asArray(channelMap?.v4l2InputChannels)) pushChannel(c, out)
	return [...out].sort((a, b) => a - b)
}

/**
 * @param {object | null | undefined} channelMap
 * @param {number} channel
 * @returns {boolean}
 */
function isInputCaptureChannel(channelMap, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch <= 0) return false
	return listInputCaptureChannels(channelMap).includes(ch)
}

/**
 * WO-887: a channel that carries sound only — a PRINT of it is always black, so it is never captured.
 * A channel that is ALSO a video input (misconfigured overlap) still counts as having a picture.
 * @param {object | null | undefined} channelMap
 * @param {number} channel
 * @returns {boolean}
 */
function isAudioOnlyLiveChannel(channelMap, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch <= 0 || isInputCaptureChannel(channelMap, ch)) return false
	const audio = new Set()
	for (const e of asArray(channelMap?.inputChannels)) if (e && e.kind === 'live_audio') pushChannel(e.channel, audio)
	for (const c of asArray(channelMap?.liveAudioInputChannels)) pushChannel(c, audio)
	for (const c of asArray(channelMap?.audioOnlyChannels)) pushChannel(c, audio)
	return audio.has(ch)
}

/**
 * WO-887: every channel a live-source thumbnail can show — video inputs plus PGM/PRV buses. Pure.
 * @param {object | null | undefined} channelMap
 * @returns {number[]}
 */
function listLiveThumbnailChannels(channelMap) {
	const out = new Set(listInputCaptureChannels(channelMap))
	for (const c of asArray(channelMap?.programChannels)) pushChannel(c, out)
	for (const c of asArray(channelMap?.previewChannels)) pushChannel(c, out)
	return [...out].filter((c) => !isAudioOnlyLiveChannel(channelMap, c)).sort((a, b) => a - b)
}

module.exports = {
	listInputCaptureChannels,
	isInputCaptureChannel,
	isAudioOnlyLiveChannel,
	listLiveThumbnailChannels,
}
