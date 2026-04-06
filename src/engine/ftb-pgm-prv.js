/**
 * Fade-to-black: optional MIXER OPACITY on layers that have content, then CLEAR <channel>
 * (one AMCP command per channel clears all layers — see Caspar CLEAR [video_channel]).
 */

'use strict'

const { MAX_BATCH_COMMANDS } = require('../caspar/amcp-batch')
const { param } = require('../caspar/amcp-utils')
const { getChannelMap } = require('../config/routing')
const playbackTracker = require('../state/playback-tracker')
const { resolveChannelFramerateForMixerTween } = require('./scene-transition')

const TIMELINE_LAYER_BASE = 100

function mapTween(tw) {
	return String(tw || 'linear')
		.toLowerCase()
		.replace(/-/g, '_')
}

/**
 * Whether timeline playback targets this Caspar channel (same logic as timeline _channelsFor).
 * @param {object} self
 * @param {object} sendTo
 * @param {number} ch
 */
function timelineSendToIncludesChannel(self, sendTo, ch) {
	const map = getChannelMap(self?.config || {})
	const st = sendTo || {}
	const previewOn = st.preview !== false
	const programOn = st.program !== false
	const screenCount = map.screenCount || 1
	const screenIdx = st.screenIdx != null ? st.screenIdx : null
	const hit = (i) => {
		let ok = false
		if (previewOn && map.previewCh(i + 1) === ch) ok = true
		if (programOn && map.programCh(i + 1) === ch) ok = true
		return ok
	}
	if (screenIdx !== null) return hit(screenIdx)
	for (let i = 0; i < screenCount; i++) {
		if (hit(i)) return true
	}
	return false
}

/**
 * Collect layer numbers that should receive an opacity fade before CLEAR channel.
 * @param {object} self - app ctx (timelineEngine, _playbackMatrix, config)
 * @param {number} ch
 * @returns {number[]}
 */
function collectLayersToFadeOnChannel(self, ch) {
	const layers = new Set()
	const matrix = self?._playbackMatrix || {}
	const prefix = `${ch}-`
	for (const key of Object.keys(matrix)) {
		if (!key.startsWith(prefix)) continue
		const ln = parseInt(key.slice(prefix.length), 10)
		if (Number.isFinite(ln)) layers.add(ln)
	}
	const eng = self?.timelineEngine
	if (eng && typeof eng.getPlayback === 'function' && typeof eng.timelines?.get === 'function') {
		const pb = eng.getPlayback()
		if (pb?.timelineId && timelineSendToIncludesChannel(self, pb.sendTo, ch)) {
			const tl = eng.timelines.get(pb.timelineId)
			const n = tl?.layers?.length ?? 0
			for (let li = 0; li < n; li++) layers.add(TIMELINE_LAYER_BASE + li)
		}
	}
	for (const ln of playbackTracker.getOccupiedLayerNumbersFromOsc(self, ch)) {
		layers.add(ln)
	}
	return [...layers].sort((a, b) => a - b)
}

/**
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 * @param {number[]} channels - Caspar channel numbers (e.g. all PGM + PRV from routing)
 * @param {{ durationFrames?: number, tween?: string, framerate?: number }} opts
 * @param {{ _playbackMatrix?: object, config?: object, timelineEngine?: object }} [self]
 */
async function runFadeToBlackAllLayers(amcp, channels, opts, self) {
	if (!amcp) throw new Error('amcp required')
	const durationFrames = Math.max(0, Math.min(120, parseInt(String(opts?.durationFrames ?? '25'), 10) || 25))
	const tween = mapTween(opts?.tween)
	const uniq = [...new Set((channels || []).map((c) => parseInt(c, 10)).filter((n) => Number.isFinite(n) && n >= 1))]
	if (uniq.length === 0) return { channels: [], durationFrames }

	let maxFadeMs = 0
	for (const ch of uniq) {
		const fr = Math.max(1, resolveChannelFramerateForMixerTween(self, ch, opts?.framerate))
		const ms = durationFrames > 0 ? (durationFrames / fr) * 1000 : 0
		if (ms > maxFadeMs) maxFadeMs = ms
	}

	for (const ch of uniq) {
		const layerNums = collectLayersToFadeOnChannel(self, ch)
		if (durationFrames > 0 && layerNums.length > 0) {
			const lines = []
			for (const L of layerNums) {
				const cl = `${ch}-${L}`
				lines.push(`MIXER ${cl} OPACITY 0 ${durationFrames} ${param(tween)}`)
			}
			for (let i = 0; i < lines.length; i += MAX_BATCH_COMMANDS) {
				const chunk = lines.slice(i, i + MAX_BATCH_COMMANDS)
				try {
					await amcp.batchSend(chunk, { force: true })
				} catch {
					for (const line of chunk) {
						try {
							await amcp.raw(line)
						} catch (_) {}
					}
				}
			}
			await amcp.mixerCommit(ch)
		}
	}

	if (maxFadeMs > 0) {
		await new Promise((r) => setTimeout(r, maxFadeMs + 50))
	}

	for (const ch of uniq) {
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
		if (self) {
			try {
				playbackTracker.clearChannelFromMatrix(self, ch)
			} catch (_) {}
		}
	}

	return { channels: uniq, durationFrames }
}

module.exports = { runFadeToBlackAllLayers, collectLayersToFadeOnChannel, TIMELINE_LAYER_BASE }
