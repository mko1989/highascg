'use strict'

const { handlePlaylistOscUpdate } = require('../engine/scene-take-lbg-playlist')

let lastPlaylistTickAt = 0

/**
 * WO-830 (sweep §2a #3): the wildcard bind exposed the OSC parser to the whole LAN. When Caspar runs on this box
 * (loopback host) its OSC can only come from loopback, so the wildcard narrows to 127.0.0.1. An explicit address and
 * a remote Caspar keep what the config says.
 */
function effectiveOscBind(config) {
	const osc = config.osc
	const host = String(config.caspar?.host || '127.0.0.1').trim().toLowerCase()
	const local = host === 'localhost' || host === '::1' || /^127\./.test(host)
	return osc.listenAddress === '0.0.0.0' && local ? { ...osc, listenAddress: '127.0.0.1' } : osc
}

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
		oscListener = new OscListener(effectiveOscBind(config), appCtx.log, oscState)
		oscListener.start()

		/**
		 * WO-401 F2: one snapshot per tick. In full-snapshot mode the emitted `change` payload IS a
		 * fresh snapshot — reuse it instead of re-deriving (and re-cloning) the same data; only
		 * delta-mode payloads (partial) force a fresh `getSnapshot()`. The consumer chain
		 * (updateFromOscSnapshot mirror, variables, WS stringify, playlist handler) is read-only,
		 * so sharing the one object is safe.
		 */
		const pushOscToState = (snap) => {
			const snapshot = snap && !snap.delta ? snap : appCtx.oscState.getSnapshot()
			if (typeof appCtx.state.updateFromOscSnapshot === 'function') {
				appCtx.state.updateFromOscSnapshot(snapshot)
			}
			applyOscSnapshotToVariables(appCtx, snapshot)
		}
		pushOscToState()
		// Full snapshot so browsers never rely only on delta WS + first `state` (which may have had osc: null before OSC started).
		if (typeof appCtx._wsBroadcast === 'function') {
			appCtx._wsBroadcast('osc', appCtx.oscState.getSnapshot())
		}
		appCtx.oscState.on('change', (snapshot) => {
			pushOscToState(snapshot)
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

module.exports = { createOscLifecycle, effectiveOscBind }
