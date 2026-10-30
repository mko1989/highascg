'use strict'

/**
 * WO-837 — per-layer screens. `layer.screenIdx` (a number) pins one timeline layer to ONE screen; absent means
 * every screen the timeline is routed to (the behaviour every older project has). Caspar layer numbering is
 * untouched (210 + li is global and unique); only the set of channels a layer is sent to narrows.
 *
 * Mixed into the TimelineEngine prototype; `this` is the engine. Every per-layer channel loop in the sender, the
 * bulk transport, the runtime and the engine's update() calls `_layerChannels(li, channels)` instead of walking
 * `channels` directly.
 */

const { getChannelMap } = require('../config/routing')

module.exports = {
	/**
	 * The channels of a screen: its PGM and (when the rig has one) PRV bus.
	 * @returns {Set<number>|null} null when `screenIdx` is past the configured screens
	 */
	_screenChannelSet(screenIdx) {
		let map = null
		try {
			map = this.self?.config ? getChannelMap(this.self.config) : null
		} catch (_) {}
		const screenCount = map?.screenCount || 1
		if (screenIdx >= screenCount) return null
		const prv = map?.previewCh ? map.previewCh(screenIdx + 1) : (screenIdx + 1) * 2
		const pgm = map?.programCh ? map.programCh(screenIdx + 1) : (screenIdx + 1) * 2 - 1
		return new Set([prv, pgm].filter((c) => c != null))
	},

	/**
	 * @param {number} li layer index in the timeline
	 * @param {number[]} channels the routed channels (`_channels()` or an override)
	 * @param {object} [tl] the timeline the layer belongs to (default: the one on air)
	 * @returns {number[]} `channels` as-is for a layer without `screenIdx`; else only that screen's routed channels
	 *   (none when the screen no longer exists, so a deleted screen's layers go silent rather than jump to another)
	 */
	_layerChannels(li, channels, tl) {
		const layer = (tl || this.timelines.get(this._airTimelineId))?.layers?.[li]
		const si = layer?.screenIdx
		if (!Number.isInteger(si) || si < 0) return channels
		const set = this._screenChannelSet(si)
		return set ? channels.filter((c) => set.has(c)) : []
	},
}
