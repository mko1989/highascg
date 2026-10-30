'use strict'

/**
 * WO-837 — `light` control flags: when the playhead crosses one, the lighting console it names gets the flag's action
 * (go / fader / release / command, src/lighting-console). Fired the way `companion_press` is: off the tick
 * (setImmediate), dropped with a warning when the timeline is no longer on air, and never allowed to block or throw
 * into playback. A console error is logged and broadcast as `lighting.error` { timelineId, flagId, label, consoleId,
 * error } so the UI can show it.
 *
 * Mixed into the TimelineEngine prototype; `this` is the engine. The console service is reached through
 * `self.lightingConsoles` (the app context), else created lazily by `getService(self)` — no boot wiring needed.
 */

module.exports = {
	_lightService() {
		return this.self?.lightingConsoles || require('../lighting-console/console-service').getService(this.self)
	},

	/** Called from `_processTimelineFlags` on a crossing. */
	_dispatchLightFlag(tlId, f) {
		const log = (level, msg) => {
			if (typeof this.self?.log === 'function') this.self.log(level, msg)
		}
		const label = f.label || f.id
		log('debug', `[Timeline] playhead crossed light flag "${label}" at ${f.timeMs}ms (tl=${tlId})`)
		setImmediate(() => {
			if (this._airTimelineId !== tlId) {
				log('warn', `[Timeline] light flag "${label}" crossed but a different timeline (${this._airTimelineId}) took over before it fired — dropped`)
				return
			}
			this._fireLightFlag(tlId, f)
		})
	},

	_fireLightFlag(tlId, f) {
		const label = f.label || f.id
		const fail = (err) => {
			const error = err?.message || String(err)
			if (typeof this.self?.log === 'function') this.self.log('warn', `[Timeline] light flag "${label}" -> console ${f.consoleId}: ${error}`)
			try {
				if (typeof this.self?._wsBroadcast === 'function') this.self._wsBroadcast('lighting.error', { timelineId: tlId, flagId: f.id, label, consoleId: f.consoleId ?? null, error })
			} catch (_) {
				/* a broken socket must not matter to playback */
			}
		}
		try {
			Promise.resolve(this._lightService().fire(f.consoleId, f)).catch(fail)
		} catch (err) {
			fail(err)
		}
	},
}
