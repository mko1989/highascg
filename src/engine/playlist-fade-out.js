'use strict'

/**
 * WO-766 — playlist item "↘ fade down when done" (owner 25.10: "set the item to play and fade out the clip at the end
 * (default half the frames that the frate rate is, in my case 50/2=25frames)").
 *
 * The fade is Caspar's own: `LOADBG ch-l EMPTY MIX n AUTO` while the item plays. AUTO starts the MIX n channel frames
 * before the clip's last frame, so the picture is gone exactly when the clip ends (probed 25.10 on 3-950: a 7.04 s
 * clip began the transition at 6.64 s = 25 frames @ 50 fps, the layer held `color` at 7.10 s). No opacity is touched,
 * so nothing has to be restored: the next item simply MIXes in from the empty layer (a fade up).
 * Caspar keeps the clip's file fields in OSC after the swap to `color`, so the end is not observable there — an auto
 * playlist moves on by the remaining time OSC reported while the item played (`scheduleFadeEndAdvance`).
 */

const { resolveChannelFramerateForMixerTween } = require('./scene-transition')

/** A ↘ item plays once and fades out; a looped item never ends, so loop wins. */
function isFadeOutPlaylistItem(item) {
	return !!item && item.fadeOut === true && item.loop !== true
}

/** Half the channel rate (50 fps → 25), at least 1. */
function defaultFadeFrames(fps) {
	const f = Number(fps)
	return Math.max(1, Math.round((Number.isFinite(f) && f > 0 ? f : 50) / 2))
}

/** The layer's `playlistFadeFrames` (1…250), else half the channel's frame rate. */
function fadeOutFrames(self, channel, layer) {
	const set = Math.round(Number(layer?.playlistFadeFrames))
	if (Number.isFinite(set) && set > 0) return Math.min(250, set)
	return defaultFadeFrames(resolveChannelFramerateForMixerTween(self, channel))
}

/** Queue the end-of-clip fade behind the item on air (replaces the next item's AUTO preload). */
function queuePlaylistFadeOut(self, channel, pLayer, layer) {
	const frames = fadeOutFrames(self, channel, layer)
	self.log?.('info', `[Playlist] ↘ fade out at the end of ${channel}-${pLayer} over ${frames} frames`)
	return Promise.resolve(self.amcp.loadbg(channel, pLayer, 'EMPTY', { auto: true, transition: 'MIX', duration: frames })).catch((err) => {
		self.log?.('warn', `[Playlist] ↘ fade queue failed on ${channel}-${pLayer}: ${err?.message || err}`)
	})
}

/**
 * Auto advance after a ↘ item: arm once per item (timers live in `self.playlistImageTimers`, so a take or the next
 * hop clears them like any timeless timer). `advance` fires after the clip's remaining time.
 * @returns {boolean} armed
 */
function scheduleFadeEndAdvance(self, pKey, itemIdx, elapsed, duration, advance) {
	self.playlistFadeEndArmed = self.playlistFadeEndArmed || {}
	if (self.playlistFadeEndArmed[pKey] === itemIdx) return false
	if (!(Number(duration) > 0) || !Number.isFinite(Number(elapsed))) return false
	self.playlistFadeEndArmed[pKey] = itemIdx
	self.playlistImageTimers = self.playlistImageTimers || {}
	if (self.playlistImageTimers[pKey]) clearTimeout(self.playlistImageTimers[pKey])
	const ms = Math.max(0, (Number(duration) - Number(elapsed)) * 1000) + 80
	self.playlistImageTimers[pKey] = setTimeout(() => {
		delete self.playlistImageTimers[pKey]
		advance()
	}, ms)
	return true
}

module.exports = { isFadeOutPlaylistItem, defaultFadeFrames, fadeOutFrames, queuePlaylistFadeOut, scheduleFadeEndAdvance }
