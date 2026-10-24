'use strict'

/**
 * WO-734 — the show timers the served pages display: each OSCPoint presentation in a slideshow (its clock, slide n of
 * total, the video playing inside it) and HighAsCG's main video per program screen. Polling starts with the first page
 * request and keeps going (TICK_MS), so a presentation clock is right for a page opened mid-talk.
 */

const { createCompanionVars } = require('./companion-vars')
const { createPresentationClock } = require('./presentation-clock')
const { mainVideos } = require('./main-video')

const TICK_MS = 1000
const PRESENTATION_VARS = ['state', 'presentationName', 'currentSlide', 'slideCountVisible', 'mediaState']
const MEDIA_VARS = ['mediaPosition', 'mediaRemaining', 'mediaDuration']

const int = (v) => {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) ? n : null
}

/**
 * @param {{ companionBase: () => string, osc: () => object, channelMap: () => object, banks: () => object,
 *   fetchImpl?: typeof fetch, now?: () => number }} o
 */
function createShowTimers(o) {
	const now = o.now || Date.now
	const vars = createCompanionVars({ base: o.companionBase, fetchImpl: o.fetchImpl, now })
	const clocks = new Map()
	let presentations = []
	let companion = { ok: false, error: '' }
	let timer = null
	let busy = false

	async function tick() {
		if (busy) return
		busy = true
		try {
			const c = await vars.connections()
			companion = { ok: !c.error, error: c.error }
			const next = []
			for (const label of c.labels) {
				const v = await vars.read(label, PRESENTATION_VARS)
				if (v.state === null) vars.invalidate()
				if (!clocks.has(label)) clocks.set(label, createPresentationClock())
				const clock = clocks.get(label).update({ name: v.presentationName, state: v.state }, now())
				if (!clock.live) continue
				const media = v.mediaState === 'playing' || v.mediaState === 'paused' ? await vars.read(label, MEDIA_VARS) : null
				next.push({
					source: label,
					name: String(v.presentationName || ''),
					state: v.state,
					slide: int(v.currentSlide),
					slides: int(v.slideCountVisible),
					elapsed_s: clock.elapsed_s,
					video:
						media && int(media.mediaDuration) > 0
							? {
									paused: v.mediaState === 'paused',
									elapsed_s: int(media.mediaPosition),
									remaining_s: int(media.mediaRemaining),
									duration_s: int(media.mediaDuration),
								}
							: null,
				})
			}
			presentations = next
		} catch (e) {
			companion = { ok: false, error: e.message || String(e) }
		} finally {
			busy = false
		}
	}

	/** The current timers; the first call starts polling. */
	async function snapshot() {
		if (!timer) {
			timer = setInterval(() => void tick(), TICK_MS)
			if (timer.unref) timer.unref()
			await tick()
		}
		return {
			at: now(),
			presentations,
			videos: mainVideos(o.osc(), o.channelMap(), o.banks(), now()),
			companion,
		}
	}

	function stop() {
		if (timer) clearInterval(timer)
		timer = null
	}

	return { snapshot, tick, stop }
}

module.exports = { createShowTimers, TICK_MS }
