/**
 * Clip-end fade watcher (WO-26): schedules MIXER OPACITY 0 <frames> before a
 * non-looping clip finishes, then STOP + MIXER CLEAR after the fade completes.
 */

'use strict'

const playbackTracker = require('../state/playback-tracker')
const { buildPipOverlayRemoveLines, sendPipOverlayLinesSerial } = require('./pip-overlay')

class ClipEndFadeWatcher {
	/**
	 * @param {object} ctx - app context with `amcp`, `log(level, msg)`
	 */
	constructor(ctx) {
		this._ctx = ctx
		/** @type {Map<string, { fadeTimer: ReturnType<typeof setTimeout>, cleanupTimer: ReturnType<typeof setTimeout> | null }>} */
		this._pending = new Map()
		/** @type {Map<string, ReturnType<typeof setInterval>>} */
		this._oscPolls = new Map()
	}

	/**
	 * Schedule a fade-out for a layer that just started playing.
	 * @param {number} channel - Caspar channel
	 * @param {number} physLayer - physical Caspar layer number
	 * @param {number} durationMs - total clip duration in ms
	 * @param {number} fadeFrames - number of frames for the opacity fade
	 * @param {number} framerate - channel framerate (fps)
	 */
	schedule(channel, physLayer, durationMs, fadeFrames, framerate) {
		const key = `${channel}-${physLayer}`
		this.cancel(channel, physLayer)

		if (!Number.isFinite(durationMs) || durationMs <= 0) {
			this._log('debug', `[ClipEndFade] skip ${key}: unknown duration`)
			return
		}

		const fps = framerate > 0 ? framerate : 50
		const fadeDurationMs = (fadeFrames / fps) * 1000
		const leadMs = Math.max(0, durationMs - fadeDurationMs)

		if (leadMs < 50) {
			this._log('debug', `[ClipEndFade] skip ${key}: clip shorter than fade (${Math.round(durationMs)}ms < ${Math.round(fadeDurationMs)}ms)`)
			return
		}

		this._log('info', `[ClipEndFade] scheduled ${key}: fade in ${Math.round(leadMs)}ms, ${fadeFrames}fr @ ${fps}fps`)

		const fadeTimer = setTimeout(() => {
			this._executeFade(channel, physLayer, fadeFrames, fadeDurationMs)
		}, leadMs)

		this._pending.set(key, { fadeTimer, cleanupTimer: null })
	}

	/**
	 * Like {@link #schedule} but `msUntilFade` is measured from **now** (e.g. OSC `remaining` − fade duration).
	 * @param {number} channel
	 * @param {number} physLayer
	 * @param {number} msUntilFade — delay before sending MIXER OPACITY 0
	 * @param {number} fadeFrames
	 * @param {number} framerate
	 */
	scheduleMidPlayback(channel, physLayer, msUntilFade, fadeFrames, framerate) {
		const key = `${channel}-${physLayer}`
		this.cancel(channel, physLayer)

		const fps = framerate > 0 ? framerate : 50
		const fadeDurationMs = (Math.max(1, fadeFrames) / fps) * 1000

		if (!Number.isFinite(msUntilFade) || msUntilFade < 0) {
			this._log('debug', `[ClipEndFade] skip ${key}: invalid delay`)
			return
		}
		if (msUntilFade + fadeDurationMs < 50) {
			this._log('debug', `[ClipEndFade] skip ${key}: not enough playback time for fade`)
			return
		}

		this._log('info', `[ClipEndFade] mid-play schedule ${key}: fade in ${Math.round(msUntilFade)}ms (${fadeFrames}fr)`)

		const fadeTimer = setTimeout(() => {
			this._executeFade(channel, physLayer, fadeFrames, fadeDurationMs)
		}, msUntilFade)

		this._pending.set(key, { fadeTimer, cleanupTimer: null })
	}

	/**
	 * When CINF/disk duration is missing, poll OSC until `file/time` (or frames) yields a delay, then schedule.
	 * @param {object} ctx — app ctx (`oscState`, `log`)
	 * @param {number} channel
	 * @param {number} physLayer
	 * @param {string} clipId
	 * @param {number} fadeFrames
	 * @param {number} framerate
	 * @param {() => number | null} getOscDelayMs — {@link playbackTracker.getOscClipEndFadeDelayMs}
	 */
	scheduleWithOscFallback(ctx, channel, physLayer, clipId, fadeFrames, framerate, getOscDelayMs) {
		const key = `${channel}-${physLayer}`
		this.cancel(channel, physLayer)

		let delay = typeof getOscDelayMs === 'function' ? getOscDelayMs() : null
		if (delay != null && Number.isFinite(delay)) {
			this.scheduleMidPlayback(channel, physLayer, delay, fadeFrames, framerate)
			return
		}

		let attempts = 0
		const maxAttempts = 14
		const intervalMs = 180
		const timer = setInterval(() => {
			attempts++
			delay = getOscDelayMs()
			if (delay != null && Number.isFinite(delay)) {
				clearInterval(timer)
				this._oscPolls.delete(key)
				this.scheduleMidPlayback(channel, physLayer, delay, fadeFrames, framerate)
				return
			}
			if (attempts >= maxAttempts) {
				clearInterval(timer)
				this._oscPolls.delete(key)
				if (ctx?.log) {
					ctx.log(
						'warn',
						`[ClipEndFade] no duration or OSC timing for "${String(clipId).slice(0, 80)}" on ${key} — fade-on-end skipped (enable OSC or fix media metadata)`,
					)
				}
			}
		}, intervalMs)
		this._oscPolls.set(key, timer)
	}

	/**
	 * Cancel any pending fade for a specific channel-layer.
	 * @param {number} channel
	 * @param {number} physLayer
	 */
	cancel(channel, physLayer) {
		const key = `${channel}-${physLayer}`
		const poll = this._oscPolls.get(key)
		if (poll) {
			clearInterval(poll)
			this._oscPolls.delete(key)
		}
		const entry = this._pending.get(key)
		if (!entry) return
		clearTimeout(entry.fadeTimer)
		if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer)
		this._pending.delete(key)
	}

	/**
	 * Cancel all pending fades for a given channel (e.g. on a new take).
	 * @param {number} channel
	 */
	cancelChannel(channel) {
		const prefix = `${channel}-`
		for (const [key, entry] of this._pending) {
			if (key.startsWith(prefix)) {
				clearTimeout(entry.fadeTimer)
				if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer)
				this._pending.delete(key)
			}
		}
		for (const [key, poll] of this._oscPolls) {
			if (key.startsWith(prefix)) {
				clearInterval(poll)
				this._oscPolls.delete(key)
			}
		}
	}

	/** Cancel everything (e.g. on disconnect). */
	cancelAll() {
		for (const [, entry] of this._pending) {
			clearTimeout(entry.fadeTimer)
			if (entry.cleanupTimer) clearTimeout(entry.cleanupTimer)
		}
		this._pending.clear()
		for (const [, poll] of this._oscPolls) {
			clearInterval(poll)
		}
		this._oscPolls.clear()
	}

	/** @private */
	async _executeFade(channel, physLayer, fadeFrames, fadeDurationMs) {
		const key = `${channel}-${physLayer}`
		const amcp = this._ctx.amcp
		if (!amcp) {
			this._pending.delete(key)
			return
		}

		try {
			this._log('info', `[ClipEndFade] fading ${key} → opacity 0 over ${fadeFrames} frames`)
			await amcp.mixerOpacity(channel, physLayer, 0, fadeFrames)
			await amcp.mixerCommit(channel)
		} catch (e) {
			this._log('warn', `[ClipEndFade] fade command failed ${key}: ${e?.message || e}`)
			this._pending.delete(key)
			return
		}

		const entry = this._pending.get(key)
		if (!entry) return

		entry.cleanupTimer = setTimeout(async () => {
			this._pending.delete(key)
			try {
				await amcp.stop(channel, physLayer)
				try {
					playbackTracker.recordStop(this._ctx, channel, physLayer)
				} catch (_) {}
				await amcp.mixerClear(channel, physLayer)
				/* PIP HTML overlay slots (see pip-overlay overlayLayerSlot) — otherwise border/strip CG stays after video fades */
				try {
					const removeLines = buildPipOverlayRemoveLines(channel, physLayer)
					await sendPipOverlayLinesSerial(amcp, removeLines)
				} catch (_) {}
				await amcp.mixerCommit(channel)
				this._log('info', `[ClipEndFade] cleanup done ${key}`)
			} catch (e) {
				this._log('warn', `[ClipEndFade] cleanup failed ${key}: ${e?.message || e}`)
			}
		}, fadeDurationMs + 50)
	}

	/** @private */
	_log(level, msg) {
		if (this._ctx?.log) this._ctx.log(level, msg)
	}
}

module.exports = { ClipEndFadeWatcher }
