'use strict'

const { buildClipCommandPlan } = require('./amcp-command-plan')

function msToFrames(durationMs, fps) {
	const rate = Number(fps) > 0 ? Number(fps) : 25
	return Math.max(0, Math.floor(Number(durationMs || 0) / (1000 / rate)))
}

function normalizeTransitionForAmcp(transition, fps) {
	if (!transition || !transition.type) return null
	const type = String(transition.type || 'CUT').toUpperCase()
	if (type === 'CUT') return null
	let duration = 0
	if (transition.durationFrames != null) duration = Math.max(0, Number(transition.durationFrames) || 0)
	else if (transition.duration != null) duration = Math.max(0, Number(transition.duration) || 0)
	else if (transition.durationMs != null) duration = msToFrames(transition.durationMs, fps)
	const tween = transition.tween || transition.easing || 'linear'
	const direction = transition.direction
	return { transition: type, duration, tween, direction }
}

function sameClip(a, b) {
	return String(a || '') === String(b || '')
}

/**
 * Build clip command plan delta for one channel/layer.
 * Snapshot shape (minimal):
 * {
 *   channel, layer,
 *   nextUp: { clip, loop?, seek?, length?, filter?, audioFilter?, transition? },
 *   playing: boolean
 * }
 */
function diffCasparLayerPlan(prev, next, opts = {}) {
	const out = []
	if (!next) return out
	const channel = parseInt(next.channel, 10)
	const layer = next.layer
	const fps = opts.fps || 25
	const prevNext = prev && prev.nextUp ? prev.nextUp : null
	const nextNext = next.nextUp || null

	if (nextNext && !sameClip(prevNext && prevNext.clip, nextNext.clip)) {
		const t = normalizeTransitionForAmcp(nextNext.transition, fps)
		out.push(
			buildClipCommandPlan('LOADBG', channel, layer, nextNext.clip, {
				loop: !!nextNext.loop,
				seek: nextNext.seek,
				length: nextNext.length,
				filter: nextNext.filter,
				audioFilter: nextNext.audioFilter,
				auto: !!nextNext.auto,
				...(t || {}),
			})
		)
	}

	if (next.playing) {
		// PLAY swap without clip: promotes background clip to foreground.
		out.push(buildClipCommandPlan('PLAY', channel, layer, '', {}))
	}

	return out
}

module.exports = {
	msToFrames,
	normalizeTransitionForAmcp,
	diffCasparLayerPlan,
}
