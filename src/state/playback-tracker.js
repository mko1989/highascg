/**
 * Channel×layer playback matrix: AMCP PLAY/STOP intercepts, or Caspar OSC when enabled.
 * @see companion-module-casparcg-server/src/playback-tracker.js
 */

'use strict'

const media = require('./playback-tracker-media')
const osc = require('./playback-tracker-osc')

/**
 * @param {{ _playbackMatrix?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 * @param {number|string} layer
 * @param {string} clip
 * @param {{ loop?: boolean, silent?: boolean }} opts - silent: skip the state emit (batch recording emits once at the end)
 */
function recordPlay(ctx, channel, layer, clip, opts = {}) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return

	if (!ctx._playbackMatrix) ctx._playbackMatrix = {}
	markChannelTracked(ctx, ch)
	const key = `${ch}-${ln}`
	const durationMs = media.resolveClipDurationMs(ctx, clip)
	ctx._playbackMatrix[key] = {
		channel: ch,
		layer: ln,
		clip: String(clip || ''),
		startedAt: Date.now(),
		durationMs,
		playing: true,
		loop: !!opts.loop,
		isRoute: media.isRouteClip(clip),
	}
	try {
		const { logicalLayerFromPhysical, rememberLastPlayFrame } = require('../engine/scene-play-seek')
		const logical = logicalLayerFromPhysical(ln)
		if (logical != null) rememberLastPlayFrame(ctx, ch, logical, 0)
	} catch {
		/* optional WO-33 memory */
	}
	try {
		const activity = require('../preview/compose-preview-activity')
		activity.onPlaybackPlay(ctx, ch, clip)
	} catch {
		/* WO-57 optional */
	}
	if (!opts.silent) emitMatrix(ctx)
}

/**
 * @param {{ _playbackMatrix?: object, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 * @param {number|string} layer
 * @param {{ silent?: boolean }} [opts]
 */
function recordStop(ctx, channel, layer, opts = {}) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return
	if (!ctx._playbackMatrix) return
	const key = `${ch}-${ln}`
	delete ctx._playbackMatrix[key]
	try {
		require('../preview/compose-preview-activity').onPlaybackStop(ctx, ch)
	} catch {
		/* WO-57 optional */
	}
	if (!opts.silent) emitMatrix(ctx)
}

function emitMatrix(ctx) {
	const snapshot = getMatrixSnapshot(ctx)
	if (ctx.state && typeof ctx.state.emit === 'function') {
		ctx.state.emit('change', 'playback.matrix', snapshot)
	}
}

/**
 * Layers that received MIXER mutations (FILL/OPACITY/…) since the last MIXER CLEAR.
 * Teardown targeting must reset these even when no producer is playing there.
 * @param {{ _playbackMixerDirty?: Set<string> }} ctx
 */
function mixerDirtySet(ctx) {
	if (!ctx._playbackMixerDirty) ctx._playbackMixerDirty = new Set()
	return ctx._playbackMixerDirty
}

/** Channels the tracker has observed (seed/record) since boot — targeting is only safe for these. */
function trackedChannelSet(ctx) {
	if (!ctx._playbackTrackedChannels) ctx._playbackTrackedChannels = new Set()
	return ctx._playbackTrackedChannels
}

function markChannelTracked(ctx, channel) {
	const ch = parseInt(channel, 10)
	if (Number.isFinite(ch) && ch >= 1) trackedChannelSet(ctx).add(ch)
}

/** @param {object} ctx @param {number|string} channel */
function isChannelTracked(ctx, channel) {
	const ch = parseInt(channel, 10)
	return Number.isFinite(ch) && trackedChannelSet(ctx).has(ch)
}

function recordMixerDirty(ctx, channel, layer) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return
	mixerDirtySet(ctx).add(`${ch}-${ln}`)
	markChannelTracked(ctx, ch)
}

function clearMixerDirty(ctx, channel, layer) {
	const ch = parseInt(channel, 10)
	const ln = parseInt(layer, 10)
	if (!Number.isFinite(ch) || !Number.isFinite(ln)) return
	mixerDirtySet(ctx).delete(`${ch}-${ln}`)
}

/**
 * Layer numbers on a channel with a tracked producer (playing/loaded).
 * @param {object} ctx
 * @param {number|string} channel
 * @returns {Set<number>}
 */
function getOccupiedLayers(ctx, channel) {
	const ch = parseInt(channel, 10)
	const out = new Set()
	if (!Number.isFinite(ch)) return out
	const matrix = getMatrixForState(ctx)
	for (const cell of Object.values(matrix || {})) {
		if (!cell || typeof cell !== 'object') continue
		if (Number(cell.channel) !== ch) continue
		const ln = Number(cell.layer)
		if (Number.isFinite(ln)) out.add(ln)
	}
	return out
}

/**
 * Layer numbers on a channel with un-reset MIXER state.
 * @param {object} ctx
 * @param {number|string} channel
 * @returns {Set<number>}
 */
function getMixerDirtyLayers(ctx, channel) {
	const ch = parseInt(channel, 10)
	const out = new Set()
	if (!Number.isFinite(ch)) return out
	const prefix = `${ch}-`
	for (const key of mixerDirtySet(ctx)) {
		if (!key.startsWith(prefix)) continue
		const ln = parseInt(key.slice(prefix.length), 10)
		if (Number.isFinite(ln)) out.add(ln)
	}
	return out
}

/**
 * Drop all AMCP-tracked layers for a Caspar channel (after CLEAR channel or equivalent).
 * @param {{ _playbackMatrix?: object, state?: import('events').EventEmitter }} ctx
 * @param {number|string} channel
 */
function clearChannelFromMatrix(ctx, channel) {
	const ch = parseInt(channel, 10)
	if (!Number.isFinite(ch) || !ctx._playbackMatrix) return
	const prefix = `${ch}-`
	for (const key of Object.keys(ctx._playbackMatrix)) {
		if (key.startsWith(prefix)) delete ctx._playbackMatrix[key]
	}
	try {
		require('../preview/compose-preview-activity').onChannelClear(ch)
	} catch {
		/* WO-57 optional */
	}
	emitMatrix(ctx)
}

function getMatrixSnapshot(ctx) {
	return { ...(ctx._playbackMatrix || {}) }
}

/**
 * @param {{ _playbackMatrix?: object, oscState?: object }} ctx
 * @returns {object}
 */
function getMatrixForState(ctx) {
	if (osc.isOscPlaybackActive(ctx)) {
		return osc.buildMatrixFromOsc(ctx)
	}
	return getMatrixSnapshot(ctx)
}

/**
 * Reconcile tracked cells against Caspar INFO XML, and seed layers the tracker missed
 * (e.g. content playing since before a service restart). Marks each reconciled channel
 * as tracked so teardown targeting can trust the matrix for it.
 * @param {{ _playbackMatrix?: object, _reconcileDiff?: object, gatheredInfo?: { channelXml?: Record<string, string> }, state?: import('events').EventEmitter }} ctx
 * @returns {{ seeded: number, corrected: number, dropped: number, at: number } | null}
 */
async function reconcilePlaybackMatrixFromGatheredXml(ctx) {
	if (osc.isOscPlaybackActive(ctx)) return null
	const { parseLayerFgClipsFromChannelXml, pathsMatch } = require('./live-scene-reconcile')
	if (!ctx) return null
	if (!ctx._playbackMatrix) ctx._playbackMatrix = {}
	const matrix = ctx._playbackMatrix
	const channelXml = ctx.gatheredInfo?.channelXml || {}
	let changed = false
	let seeded = 0
	let corrected = 0
	let dropped = 0

	for (const chKey of Object.keys(channelXml)) {
		const ch = parseInt(chKey, 10)
		const xml = channelXml[chKey]
		if (!Number.isFinite(ch) || !xml || !String(xml).trim()) continue

		let fgByLayer
		try {
			fgByLayer = await parseLayerFgClipsFromChannelXml(xml)
		} catch {
			continue
		}
		markChannelTracked(ctx, ch)

		// Seed / correct layers reported by Caspar.
		for (const lnKey of Object.keys(fgByLayer)) {
			const ln = parseInt(lnKey, 10)
			if (!Number.isFinite(ln)) continue
			let actual = String(fgByLayer[lnKey] || '').trim()
			if (actual.toLowerCase() === 'empty') actual = ''
			const cell = matrix[`${ch}-${ln}`]
			if (!actual) {
				if (cell?.playing && !cell.isRoute) {
					recordStop(ctx, ch, ln, { silent: true })
					dropped++
					changed = true
				}
				continue
			}
			if (!cell) {
				recordPlay(ctx, ch, ln, actual, { silent: true })
				seeded++
				changed = true
			} else if (!cell.isRoute && !pathsMatch(cell.clip, actual)) {
				recordPlay(ctx, ch, ln, actual, { loop: !!cell.loop, silent: true })
				corrected++
				changed = true
			}
		}

		// Drop tracked cells Caspar no longer reports at all.
		const prefix = `${ch}-`
		for (const key of Object.keys(matrix)) {
			if (!key.startsWith(prefix)) continue
			const cell = matrix[key]
			if (!cell?.playing || cell.isRoute) continue
			const lnKey = String(cell.layer)
			if (fgByLayer[lnKey] === undefined) {
				recordStop(ctx, cell.channel, cell.layer, { silent: true })
				dropped++
				changed = true
			}
		}
	}

	const diff = { seeded, corrected, dropped, at: Date.now() }
	if (!ctx._reconcileDiff) ctx._reconcileDiff = {}
	Object.assign(ctx._reconcileDiff, diff)

	if (changed) emitMatrix(ctx)
	return (seeded || corrected || dropped) ? diff : null
}

const AMCP_PLAY_LINE_RE = /^(PLAY|LOAD|LOADBG)\s+(\d+)-(\d+)(?:\s+(.+))?$/i
const AMCP_STOP_LINE_RE = /^STOP\s+(\d+)-(\d+)$/i
const AMCP_CLEAR_LINE_RE = /^CLEAR\s+(\d+)(?:-(\d+))?$/i
const AMCP_MIXER_LINE_RE = /^MIXER\s+(\d+)(?:-(\d+))?\s+(\S+)/i
const AMCP_CG_LINE_RE = /^CG\s+(\d+)-(\d+)\s+(\S+)(?:\s+(.*))?$/i

/**
 * Record playout mutations from raw AMCP batch lines (client preview pushes, deck sweeps).
 * Keeps the matrix authoritative for traffic that bypasses the typed /api/play|stop routes.
 * @param {object} ctx
 * @param {string[]} lines
 */
function recordAmcpLines(ctx, lines) {
	if (!ctx || !Array.isArray(lines) || lines.length === 0) return
	let changed = false

	for (const raw of lines) {
		const line = String(raw || '').trim()
		if (!line) continue

		let m = line.match(AMCP_PLAY_LINE_RE)
		if (m) {
			const ch = parseInt(m[2], 10)
			const ln = parseInt(m[3], 10)
			const rest = String(m[4] || '').trim()
			markChannelTracked(ctx, ch)
			if (rest) {
				let clip = rest
				try {
					const { parseClipTokenAndSuffix } = require('../caspar/amcp-clip-resolve')
					const parsed = parseClipTokenAndSuffix(rest)
					if (parsed?.clip) clip = parsed.clip
				} catch {
					clip = rest.split(/\s+/)[0].replace(/^"|"$/g, '')
				}
				recordPlay(ctx, ch, ln, clip, { loop: /\bLOOP\b/i.test(rest), silent: true })
			} else if (!ctx._playbackMatrix?.[`${ch}-${ln}`]) {
				// Bare PLAY resumes a loaded bg — layer becomes occupied even if the clip is unknown.
				recordPlay(ctx, ch, ln, '', { silent: true })
			}
			changed = true
			continue
		}

		m = line.match(AMCP_STOP_LINE_RE)
		if (m) {
			markChannelTracked(ctx, parseInt(m[1], 10))
			recordStop(ctx, m[1], m[2], { silent: true })
			changed = true
			continue
		}

		m = line.match(AMCP_CLEAR_LINE_RE)
		if (m) {
			const ch = parseInt(m[1], 10)
			markChannelTracked(ctx, ch)
			if (m[2] != null) {
				recordStop(ctx, ch, m[2], { silent: true })
			} else {
				const prefix = `${ch}-`
				for (const key of Object.keys(ctx._playbackMatrix || {})) {
					if (key.startsWith(prefix)) delete ctx._playbackMatrix[key]
				}
				for (const key of [...mixerDirtySet(ctx)]) {
					if (key.startsWith(prefix)) mixerDirtySet(ctx).delete(key)
				}
				try {
					require('../preview/compose-preview-activity').onChannelClear(ch)
				} catch {
					/* WO-57 optional */
				}
			}
			changed = true
			continue
		}

		m = line.match(AMCP_MIXER_LINE_RE)
		if (m) {
			const ch = parseInt(m[1], 10)
			const ln = m[2] != null ? parseInt(m[2], 10) : null
			const verb = String(m[3] || '').toUpperCase()
			if (verb === 'COMMIT') continue
			if (verb === 'CLEAR') {
				if (ln != null) clearMixerDirty(ctx, ch, ln)
				else {
					const prefix = `${ch}-`
					for (const key of [...mixerDirtySet(ctx)]) {
						if (key.startsWith(prefix)) mixerDirtySet(ctx).delete(key)
					}
				}
			} else if (ln != null) {
				recordMixerDirty(ctx, ch, ln)
			}
			continue
		}

		m = line.match(AMCP_CG_LINE_RE)
		if (m) {
			const ch = parseInt(m[1], 10)
			const ln = parseInt(m[2], 10)
			const verb = String(m[3] || '').toUpperCase()
			if (verb === 'ADD') {
				markChannelTracked(ctx, ch)
				const tpl = String(m[4] || '').split(/\s+/).filter(Boolean)[1] || ''
				recordPlay(ctx, ch, ln, `[CG] ${tpl.replace(/^"|"$/g, '')}`.trim(), { silent: true })
				changed = true
			} else if (verb === 'CLEAR') {
				const cell = ctx._playbackMatrix?.[`${ch}-${ln}`]
				if (cell && String(cell.clip || '').startsWith('[CG]')) {
					recordStop(ctx, ch, ln, { silent: true })
					changed = true
				}
			}
			continue
		}
	}

	if (changed) emitMatrix(ctx)
}

module.exports = {
	recordPlay,
	recordStop,
	recordAmcpLines,
	recordMixerDirty,
	clearMixerDirty,
	clearChannelFromMatrix,
	markChannelTracked,
	isChannelTracked,
	getOccupiedLayers,
	getMixerDirtyLayers,
	getMatrixForState,
	buildMatrixFromOsc: osc.buildMatrixFromOsc,
	getOccupiedLayerNumbersFromOsc: osc.getOccupiedLayerNumbersFromOsc,
	isOscPlaybackActive: osc.isOscPlaybackActive,
	resolveClipDurationMs: media.resolveClipDurationMs,
	resolveClipDurationMsWithDiskProbe: media.resolveClipDurationMsWithDiskProbe,
	getOscClipEndFadeDelayMs: osc.getOscClipEndFadeDelayMs,
	reconcilePlaybackMatrixFromGatheredXml,
}
