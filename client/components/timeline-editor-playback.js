/**
 * Timeline editor — playhead clock and playback runtime.
 */

export function createTimelinePlaybackRuntime(ctx) {
	const {
		timelineState,
		canvas,
		getRedrawTimelineView,
		getUpdateTimecode,
		getView,
	} = ctx

	/** @type {Map<string, { playing: boolean, position: number, timelineId: string, loop: boolean }>} */
	const playbackById = new Map()
	/** @type {Map<string, { serverTickPos: number, serverTickAt: number }>} */
	const clockById = new Map()

	let playLoopRaf = null
	/** Server more than this ahead of client -> snap (seek / tab resume). */
	const TICK_AHEAD_SNAP_MS = 80
	/** Ignore server reports this far behind extrapolated time (network latency). */
	const TICK_LATENCY_MS = 35

	function defaultPlayback(tlId) {
		return { playing: false, position: 0, timelineId: tlId, loop: false }
	}

	function ensurePlayback(tlId) {
		if (!tlId) return defaultPlayback(null)
		let pb = playbackById.get(tlId)
		if (!pb) {
			pb = defaultPlayback(tlId)
			playbackById.set(tlId, pb)
		}
		return pb
	}

	function getPlayback() {
		const tl = timelineState.getActive()
		return tl?.id ? ensurePlayback(tl.id) : defaultPlayback(null)
	}

	function getClock(tlId) {
		if (!clockById.has(tlId)) clockById.set(tlId, { serverTickPos: 0, serverTickAt: 0 })
		return clockById.get(tlId)
	}

	function clientPlayheadMs(tlId) {
		const id = tlId ?? timelineState.getActive()?.id
		if (!id) return 0
		const c = getClock(id)
		return c.serverTickPos + (Date.now() - c.serverTickAt)
	}

	function anchorPlayhead(ms, tlId) {
		const id = tlId ?? timelineState.getActive()?.id
		if (!id) return
		const c = getClock(id)
		c.serverTickPos = ms
		c.serverTickAt = Date.now()
	}

	function applyServerTick(serverMs, tlId) {
		const id = tlId ?? timelineState.getActive()?.id
		if (!id) return
		const c = getClock(id)
		const now = Date.now()
		const extrapolated = c.serverTickPos + (now - c.serverTickAt)
		if (serverMs - extrapolated > TICK_AHEAD_SNAP_MS) {
			c.serverTickPos = serverMs
		} else if (serverMs >= extrapolated - TICK_LATENCY_MS) {
			c.serverTickPos = serverMs
		} else {
			c.serverTickPos = extrapolated
		}
		c.serverTickAt = now
	}

	function maybeFollowPlayhead() {
		if (!getView().follow) return
		const playback = getPlayback()
		canvas.followPlayhead(playback.position, { playing: playback.playing })
	}

	function startPlaybackLoop() {
		if (playLoopRaf) return
		const loop = () => {
			const playback = getPlayback()
			if (!playback.playing) {
				playLoopRaf = null
				return
			}
			const tl = timelineState.getActive()
			const pos = clientPlayheadMs(tl?.id)
			playback.position = tl ? Math.min(pos, tl.duration) : pos
			maybeFollowPlayhead()
			getUpdateTimecode()()
			getRedrawTimelineView()()
			playLoopRaf = requestAnimationFrame(loop)
		}
		playLoopRaf = requestAnimationFrame(loop)
	}

	function stopPlaybackLoop() {
		if (playLoopRaf) {
			cancelAnimationFrame(playLoopRaf)
			playLoopRaf = null
		}
		canvas.resetFollowScroll?.()
	}

	return {
		ensurePlayback,
		getPlayback,
		clientPlayheadMs,
		anchorPlayhead,
		applyServerTick,
		maybeFollowPlayhead,
		startPlaybackLoop,
		stopPlaybackLoop,
	}
}
