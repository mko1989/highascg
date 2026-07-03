'use strict'

/**
 * Targeted teardown: drop per-layer STOP/CLEAR/MIXER-CLEAR/CG-CLEAR lines aimed at layers
 * the playback tracker knows are empty. Client sweeps (deck clears, preview pushes) send
 * blanket 10..900 decade sweeps; with the channel×layer matrix we keep only lines for
 * layers that actually have a producer or un-reset mixer state.
 *
 * Lines on channels the tracker has never observed pass through untouched (safe fallback).
 */

const playbackTracker = require('../state/playback-tracker')
const { LAYER_TEARDOWN_RE, LAYER_STOP_RE, LAYER_CLEAR_RE } = require('./amcp-coalesce-clears')

/**
 * @param {string} line
 * @returns {{ channel: number, layer: number } | null}
 */
function parseTeardownTarget(line) {
	const t = String(line || '').trim()
	if (!LAYER_TEARDOWN_RE.test(t) && !LAYER_STOP_RE.test(t) && !LAYER_CLEAR_RE.test(t)) return null
	const m = t.match(/(\d+)-(\d+)/)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	const layer = parseInt(m[2], 10)
	if (!Number.isFinite(channel) || !Number.isFinite(layer)) return null
	return { channel, layer }
}

/**
 * Filter per-layer teardown lines down to layers that are occupied or mixer-dirty.
 * @param {string[]} lines
 * @param {object} ctx - app context (playback matrix, log)
 * @returns {{ lines: string[], dropped: number, kept: number, targetedChannels: Set<number> }}
 */
function targetTeardownLines(lines, ctx) {
	if (!Array.isArray(lines) || lines.length === 0 || !ctx) {
		return { lines, dropped: 0, kept: 0, targetedChannels: new Set() }
	}

	/** @type {Map<number, { trusted: boolean, occupied: Set<number>, dirty: Set<number> }>} */
	const byChannel = new Map()
	const oscActive = !!playbackTracker.isOscPlaybackActive(ctx)

	const channelInfo = (ch) => {
		let info = byChannel.get(ch)
		if (!info) {
			info = {
				trusted: oscActive || playbackTracker.isChannelTracked(ctx, ch),
				occupied: playbackTracker.getOccupiedLayers(ctx, ch),
				dirty: playbackTracker.getMixerDirtyLayers(ctx, ch),
			}
			byChannel.set(ch, info)
		}
		return info
	}

	let dropped = 0
	let kept = 0
	const out = []
	for (const raw of lines) {
		const target = parseTeardownTarget(raw)
		if (!target) {
			out.push(raw)
			continue
		}
		const info = channelInfo(target.channel)
		if (!info.trusted || info.occupied.has(target.layer) || info.dirty.has(target.layer)) {
			kept += 1
			out.push(raw)
			continue
		}
		dropped += 1
	}

	if (dropped > 0 && typeof ctx.log === 'function') {
		ctx.log('debug', `[AMCP] teardown targeting dropped ${dropped}/${dropped + kept} per-layer lines (matrix-empty layers)`)
	}
	/** Channels whose remaining lines are already exact — coalescing them to CLEAR <ch> would over-clear. */
	const targetedChannels = new Set()
	for (const [ch, info] of byChannel) {
		if (info.trusted) targetedChannels.add(ch)
	}
	return { lines: out, dropped, kept, targetedChannels }
}

module.exports = { targetTeardownLines, parseTeardownTarget }
