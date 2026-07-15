'use strict'

const { handlePlaylistOscUpdate } = require('../engine/scene-take-lbg-playlist')

let lastPlaylistTickAt = 0

function createOscLifecycle({
	appCtx,
	config,
	cli,
	logger,
	normalizeOscConfig,
	OscState,
	OscListener,
	applyOscSnapshotToVariables,
	clearOscVariables,
	startOscPlaybackInfoSupplement,
}) {
	/** @type {OscListener | null} */
	let oscListener = null

	function stopOscSubsystem() {
		if (oscListener) {
			oscListener.stop()
			oscListener = null
		}
		if (appCtx.oscState) {
			if (typeof appCtx.state.clearOscMirror === 'function') {
				appCtx.state.clearOscMirror()
			}
			clearOscVariables(appCtx)
			appCtx.oscState.destroy()
			appCtx.oscState = null
		}
	}

	function startOscSubsystem() {
		config.osc = normalizeOscConfig(config)
		if (cli.noOsc) config.osc.enabled = false
		if (!config.osc.enabled) {
			logger.info('OSC UDP listener off (--no-osc). Caspar→HighAsCG OSC is expected in normal operation.')
			return
		}
		const oscState = new OscState(appCtx.log, config.osc)
		appCtx.oscState = oscState
		oscListener = new OscListener(config.osc, appCtx.log, oscState)
		oscListener.start()

		const pushOscToState = () => {
			const snap = appCtx.oscState.getSnapshot()
			if (typeof appCtx.state.updateFromOscSnapshot === 'function') {
				appCtx.state.updateFromOscSnapshot(snap)
			}
			applyOscSnapshotToVariables(appCtx, snap)
		}
		pushOscToState()
		// Full snapshot so browsers never rely only on delta WS + first `state` (which may have had osc: null before OSC started).
		if (typeof appCtx._wsBroadcast === 'function') {
			appCtx._wsBroadcast('osc', appCtx.oscState.getSnapshot())
		}
		appCtx.oscState.on('change', (snapshot) => {
			pushOscToState()
			if (typeof appCtx._wsBroadcast === 'function') {
				appCtx._wsBroadcast('osc', snapshot)
			}
			// WO-251: playlist auto-advance/wrap is OSC-driven (file-name change detection +
			// stall watchdog in scene-take-lbg-playlist.js). The handler existed since WO-211
			// but was NEVER subscribed anywhere — playlists therefore played the initial item
			// plus one native LOADBG-AUTO handoff and then stopped ("doesn't loop"). Throttled:
			// advance detection needs ~4 Hz, not every OSC tick.
			const now = Date.now()
			if (now - lastPlaylistTickAt >= 250) {
				lastPlaylistTickAt = now
				try {
					handlePlaylistOscUpdate(appCtx, snapshot)
				} catch (e) {
					appCtx.log?.('warn', `[Playlist] OSC advance handler failed: ${e?.message || e}`)
				}
			}
		})
	}

	function restartOscSubsystem() {
		stopOscSubsystem()
		startOscSubsystem()
		startOscPlaybackInfoSupplement(appCtx)
	}

	function getOscReceiverStats() {
		return oscListener && typeof oscListener.getStats === 'function' ? oscListener.getStats() : null
	}

	return { startOscSubsystem, stopOscSubsystem, restartOscSubsystem, getOscReceiverStats }
}

module.exports = { createOscLifecycle }
