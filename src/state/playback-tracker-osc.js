/**
 * OSC-derived playback snapshot helpers for playback-tracker.
 */

'use strict'

const media = require('./playback-tracker-media')

/**
 * @param {{ oscState?: { getSnapshot?: () => object } | null }} ctx
 * @returns {boolean}
 */
function isOscPlaybackActive(ctx) {
	return !!(ctx && ctx.oscState && typeof ctx.oscState.getSnapshot === 'function')
}

/**
 * @param {object} layer — OSC stage layer aggregate
 * @returns {string}
 */
function pickClipFromOscLayer(layer) {
	const f = layer.file || {}
	if (f.name) return String(f.name)
	if (f.path) return String(f.path)
	const t = layer.template || {}
	if (t.path) return String(t.path)
	const typ = layer.type && String(layer.type) !== 'empty' ? String(layer.type) : ''
	return typ ? `[${typ}]` : ''
}

/**
 * Whether OSC-reported clip id matches the clip used on take (path or basename).
 * @param {string} oscClip
 * @param {string} clipId
 */
function oscClipMatchesTakeClip(oscClip, clipId) {
	if (!oscClip || !clipId || media.isRouteClip(clipId)) return false
	if (media.mediaIdsMatch(oscClip, clipId)) return true
	const a = media.mediaIdKey(oscClip)
	const b = media.mediaIdKey(clipId)
	const ba = a.replace(/^.*[/\\]/, '')
	const bb = b.replace(/^.*[/\\]/, '')
	return Boolean(ba && bb && ba.normalize('NFC') === bb.normalize('NFC'))
}

/**
 * Milliseconds from **now** until the opacity fade should start (N frames before visible end),
 * from OSC `file/time`, `remaining`, or frame progress. Returns `null` if OSC inactive or timing unknown.
 * @param {{ oscState?: { getSnapshot?: () => object } }} ctx
 * @param {number} channel
 * @param {number} physLayer
 * @param {string} clipId
 * @param {number} fadeFrames
 * @param {number} framerate
 * @returns {number | null}
 */
function getOscClipEndFadeDelayMs(ctx, channel, physLayer, clipId, fadeFrames, framerate) {
	if (!isOscPlaybackActive(ctx) || !clipId) return null
	const snap = ctx.oscState.getSnapshot()
	const channels = (snap && snap.channels) || {}
	const chan = channels[channel] ?? channels[String(channel)]
	if (!chan || !chan.layers) return null
	const layer = chan.layers[physLayer] ?? chan.layers[String(physLayer)]
	if (!layer || typeof layer !== 'object') return null
	if (String(layer.type || '') === 'empty') return null
	const oscClip = pickClipFromOscLayer(layer)
	if (!oscClip || !oscClipMatchesTakeClip(oscClip, clipId)) return null

	const f = layer.file || {}
	if (f.loop === true || f.loop === 1) return null

	const fps = framerate > 0 ? framerate : 50
	const fadeDurMs = (Math.max(1, Number(fadeFrames)) / fps) * 1000

	let remainingMs = null
	if (Number.isFinite(f.remaining) && f.remaining >= 0) {
		remainingMs = f.remaining * 1000
	} else if (
		Number.isFinite(f.duration) &&
		f.duration > 0 &&
		Number.isFinite(f.elapsed) &&
		f.elapsed >= 0
	) {
		remainingMs = Math.max(0, f.duration - f.elapsed) * 1000
	} else if (Number.isFinite(f.duration) && f.duration > 0) {
		remainingMs = f.duration * 1000
	} else if (Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
		const prog = f.frameElapsed / f.frameTotal
		if (Number.isFinite(f.elapsed) && prog > 0.001) {
			const totalSec = f.elapsed / prog
			remainingMs = Math.max(0, totalSec - f.elapsed) * 1000
		}
	}

	if (remainingMs == null || remainingMs <= 0) return null
	const delay = remainingMs - fadeDurMs
	if (remainingMs < fadeDurMs - 1e-6) return null
	return Math.max(0, delay)
}

/**
 * Build matrix from `/channel/N/stage/layer/L/...` OSC (authoritative when listener is on).
 * @param {{ oscState: { getSnapshot: () => object }, CHOICES_MEDIAFILES?: unknown, mediaDetails?: unknown, _mediaProbeCache?: unknown }} ctx
 */
function buildMatrixFromOsc(ctx) {
	const snap = ctx.oscState.getSnapshot()
	const out = {}
	const channels = (snap && snap.channels) || {}
	for (const k of Object.keys(channels)) {
		const ch = parseInt(k, 10)
		if (!Number.isFinite(ch)) continue
		const chan = channels[k]
		if (!chan || typeof chan !== 'object') continue
		const layers = chan.layers || {}
		for (const lid of Object.keys(layers)) {
			const ln = parseInt(lid, 10)
			if (!Number.isFinite(ln)) continue
			const layer = layers[lid]
			if (!layer || typeof layer !== 'object') continue
			const typ = String(layer.type || 'empty')
			if (typ === 'empty') continue
			const clip = pickClipFromOscLayer(layer)
			if (!clip) continue
			const key = `${ch}-${ln}`
			const f = layer.file || {}
			let durationSec = Number.isFinite(f.duration) ? f.duration : null
			const elapsedSec = Number.isFinite(f.elapsed) ? f.elapsed : null
			let durationMs =
				durationSec != null && durationSec > 0 ? Math.round(durationSec * 1000) : media.resolveClipDurationMs(ctx, clip)
			let progress = Number.isFinite(f.progress) ? f.progress : null
			if (progress == null && Number.isFinite(f.frameElapsed) && Number.isFinite(f.frameTotal) && f.frameTotal > 0) {
				progress = Math.min(1, Math.max(0, f.frameElapsed / f.frameTotal))
				if (durationMs == null && durationSec == null && Number.isFinite(elapsedSec) && progress > 0.001) {
					const tot = elapsedSec / progress
					if (Number.isFinite(tot) && tot > 0) {
						durationSec = tot
						durationMs = Math.round(tot * 1000)
					}
				}
			}
			let startedAt = Date.now()
			if (elapsedSec != null && elapsedSec >= 0 && durationMs != null && durationMs > 0) {
				startedAt = Date.now() - Math.round(elapsedSec * 1000)
			}
			const remainingSec = Number.isFinite(f.remaining) ? f.remaining : null
			const cell = {
				channel: ch,
				layer: ln,
				clip,
				startedAt,
				durationMs,
				playing: layer.paused !== true,
				loop: !!f.loop,
				isRoute: media.isRouteClip(clip),
				source: 'osc',
			}
			if (elapsedSec != null) cell.elapsedSec = elapsedSec
			if (remainingSec != null) cell.remainingSec = remainingSec
			if (progress != null) cell.progress = progress
			out[key] = cell
		}
	}
	return out
}

/**
 * Layer numbers on a channel that OSC reports as non-empty (same filter as {@link buildMatrixFromOsc}).
 * Used by FTB to fade only layers that actually have producers.
 * @param {{ oscState?: { getSnapshot?: () => object } }} ctx
 * @param {number} ch — Caspar channel (1-based)
 * @returns {number[]}
 */
function getOccupiedLayerNumbersFromOsc(ctx, ch) {
	if (!isOscPlaybackActive(ctx)) return []
	const snap = ctx.oscState.getSnapshot()
	const channels = (snap && snap.channels) || {}
	const chan = channels[ch] ?? channels[String(ch)]
	if (!chan || !chan.layers) return []
	const out = []
	for (const lid of Object.keys(chan.layers)) {
		const ln = parseInt(lid, 10)
		if (!Number.isFinite(ln)) continue
		const layer = chan.layers[lid]
		if (!layer || typeof layer !== 'object') continue
		const typ = String(layer.type || 'empty')
		if (typ === 'empty') continue
		const clip = pickClipFromOscLayer(layer)
		if (!clip) continue
		out.push(ln)
	}
	return out.sort((a, b) => a - b)
}

module.exports = {
	isOscPlaybackActive,
	buildMatrixFromOsc,
	getOccupiedLayerNumbersFromOsc,
	getOscClipEndFadeDelayMs,
}
