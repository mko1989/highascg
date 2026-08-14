'use strict'

/**
 * Bulk transport across every physical layer a timeline occupies — PAUSE / RESUME / STOP.
 *
 * Split out of `timeline-playback-amcp-send.js` under the 500-line limit when WO-536 added the
 * looping-clip seek there. These three are a coherent unit: each walks `_prevKey` (or the timeline's
 * layers) and issues one command per layer, with no per-clip transport reasoning of their own.
 *
 * The `loopAlways` skip in pause/resume is deliberate and symmetric: a clip with **Loop** ticked is
 * never paused in Caspar, so it keeps rolling while the timeline is stopped — which is also why
 * WO-536's corrected resume emits nothing at all for such a layer. Breaking the symmetry in either
 * direction strands the layer: pausing without resuming freezes it, resuming without pausing is a
 * no-op that hides the first fault.
 *
 * Mixed into the TimelineEngine prototype alongside the sender; `this` is the engine.
 */

module.exports = {
	_pauseAll() {
		const self = this.self
		if (!self?.amcp) return
		const airId = this._airTimelineId
		const tl = airId ? this.timelines.get(airId) : null
		if (!tl) return
		const ms = this._nowMs(airId)
		for (const key of this._prevKey.keys()) {
			const [ch, caspLayer] = key.split('-').map(Number)
			if (isNaN(ch) || isNaN(caspLayer)) continue
			const li = this._timelineLayerIndex(caspLayer)
			if (li >= 0 && li < tl.layers.length) {
				const clip = this._clipAt(tl.layers[li], ms)
				if (clip?.loopAlways) continue
			}
			self.amcp.pause(ch, caspLayer).catch(_err => {
				this._logDebug(`PAUSE ${ch}-${caspLayer} failed: ${_err.message}`)
			})
		}
	},

	_resumeAll() {
		const self = this.self
		if (!self?.amcp) return
		const airId = this._airTimelineId
		const tl = airId ? this.timelines.get(airId) : null
		if (!tl) return
		const ms = this._nowMs(airId)
		for (const key of this._prevKey.keys()) {
			const [ch, caspLayer] = key.split('-').map(Number)
			if (isNaN(ch) || isNaN(caspLayer)) continue
			const li = this._timelineLayerIndex(caspLayer)
			if (li >= 0 && li < tl.layers.length) {
				const clip = this._clipAt(tl.layers[li], ms)
				if (clip?.loopAlways) continue
			}
			self.amcp.resume(ch, caspLayer).catch(_err => {
				this._logDebug(`RESUME ${ch}-${caspLayer} failed: ${_err.message}`)
			})
		}
	},

	_stopAll(tl, channelsOverride) {
		const self = this.self
		if (!self?.amcp) return
		const channels = channelsOverride ?? this._channels()
		for (let li = 0; li < tl.layers.length; li++) {
			for (const ch of channels) {
				const caspLayer = this._caspLayer(ch, li)
				self.amcp.stop(ch, caspLayer).catch(_err => {
					this._logDebug(`STOP ${ch}-${caspLayer} failed: ${_err.message}`)
				})
			}
		}
		this._lastKfValues.clear()
		this._lastKfSegment.clear()
	}
,
}
