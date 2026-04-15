'use strict'

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
