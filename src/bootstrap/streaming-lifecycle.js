'use strict'

function createStreamingLifecycle({
	appCtx,
	config,
	logger,
	getChannelMap,
	addStreamingConsumers,
	removeStreamingConsumers,
	resolveFreeStreamingBasePort,
	prepareNdiStreaming,
	resolveCaptureTier,
}) {
	void logger

	/**
	 * Map logical stream names (pgm_1, multiview) to real Caspar channels from screen/multiview layout.
	 * Hardcoding 1/3 was wrong for multi-screen configs (e.g. multiview on ch 5).
	 */
	function buildStreamingTargets(basePort) {
		const cm = getChannelMap(config)
		const targets = []
		const pgmCh = cm.programChannels?.[0] ?? 1
		targets.push({ name: 'pgm_1', channel: pgmCh, port: basePort + 1 })
		if (cm.multiviewCh != null) {
			targets.push({ name: 'multiview', channel: cm.multiviewCh, port: basePort + 5 })
		}
		appCtx.log(
			'info',
			`[Streaming] targets: PGM ch${pgmCh}→${basePort + 1}` +
				(cm.multiviewCh != null ? `, MV ch${cm.multiviewCh}→${basePort + 5}` : ' (no multiview channel)')
		)
		return targets
	}

	/** Updated each `startStreamingSubsystem` (UDP tier may relocate base if ports are busy). */
	let streamingTargets = buildStreamingTargets(config.streaming.basePort)

	async function startStreamingSubsystem() {
		if (!config.streaming.enabled) {
			appCtx.log('debug', '[Streaming] startStreamingSubsystem skipped — streaming.enabled is false')
			return
		}
		appCtx.streamingPipelineReady = false
		try {
			config.streaming._casparHost = config.caspar.host
			const tier = resolveCaptureTier(config.streaming.captureMode || 'udp', config.caspar.host)
			appCtx.log(
				'info',
				`[Streaming] startStreamingSubsystem tier=${tier} caspar=${config.caspar.host} amcpConnected=${!!appCtx.amcp?.isConnected}`
			)

			if (tier === 'udp') {
				const r = await resolveFreeStreamingBasePort(config.streaming.basePort, {
					autoRelocate: config.streaming.autoRelocateBasePort !== false,
					maxScan: 500,
					log: (level, msg) => appCtx.log(level, msg),
				})
				config.streaming._effectiveBasePort = r.basePort
				streamingTargets = buildStreamingTargets(r.basePort)
			} else {
				delete config.streaming._effectiveBasePort
				streamingTargets = buildStreamingTargets(config.streaming.basePort)
			}

			if (tier === 'ndi') prepareNdiStreaming(config.streaming, streamingTargets)

			if (appCtx.amcp?.isConnected) {
				await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
				appCtx.streamingPipelineReady = true
			} else {
				appCtx.streamingPipelineReady = false
				appCtx.log('warn', '[Streaming] AMCP not connected — delaying Caspar STREAM setup until connected')
			}
			appCtx.log('info', '[Streaming] startStreamingSubsystem finished')
		} catch (e) {
			appCtx.streamingPipelineReady = false
			appCtx.log('error', `Streaming start failed: ${e.message}`)
		}
	}

	async function stopStreamingSubsystem() {
		try {
			appCtx.streamingPipelineReady = false
			appCtx.log('info', '[Streaming] stopStreamingSubsystem (remove Caspar consumers)')
			if (appCtx.amcp) await removeStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
		} catch (e) {
			appCtx.log('warn', `[Streaming] stopStreamingSubsystem: ${e?.message || e}`)
		}
	}

	/**
	 * Stop streaming stack, release UDP listeners, then start again.
	 * Must run before `resolveFreeStreamingBasePort` so stale STREAM listeners are removed first.
	 */
	async function runStreamingRestart() {
		await stopStreamingSubsystem()
		const delayMs = Math.max(
			0,
			parseInt(process.env.HIGHASCG_STREAMING_RESTART_DELAY_MS || '500', 10) || 500
		)
		if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
		await startStreamingSubsystem()
	}

	/** Serialize start/stop so overlapping config + Caspar events cannot overlap STREAM updates. */
	let streamingChain = Promise.resolve()
	function enqueueStreaming(fn) {
		streamingChain = streamingChain.then(fn).catch((e) => {
			appCtx.log('error', `Streaming: ${e?.message || e}`)
		})
		return streamingChain
	}

	function toggleStreaming(enabled) {
		config.streaming.enabled = enabled
		return enqueueStreaming(async () => {
			if (enabled) await runStreamingRestart()
			else await stopStreamingSubsystem()
		})
	}

	const restartStreaming = () => enqueueStreaming(runStreamingRestart)

	/**
	 * Only preview/streaming (Caspar ADD/REMOVE STREAM) depends on these fields. Saving unrelated keys
	 * (e.g. `dmx` / pixel map) must not restart streaming — each restart issues many REMOVE STREAM lines on Caspar.
	 */
	function streamingRestartSignature(cfg) {
		const s = cfg.streaming || {}
		return JSON.stringify({
			casparHost: cfg.caspar?.host,
			casparPort: cfg.caspar?.port,
			enabled: !!s.enabled,
			quality: s.quality,
			basePort: s.basePort,
			hardware_accel: s.hardware_accel,
			captureMode: s.captureMode || 'udp',
			ndiNamingMode: s.ndiNamingMode,
			ndiSourcePattern: s.ndiSourcePattern,
			ndiChannelNames: s.ndiChannelNames,
			localCaptureDevice: s.localCaptureDevice,
			x11Display: s.x11Display,
			drmDevice: s.drmDevice,
			autoRelocateBasePort: s.autoRelocateBasePort,
			resolution: s.resolution,
			fps: s.fps,
			maxBitrate: s.maxBitrate,
		})
	}
	let lastStreamingRestartSig = streamingRestartSignature(config)

	// T1.3: Live reload — debounce streaming so double-save / OSC + save does not restart twice in one tick.
	let streamingReloadTimer = null

	function handleConfigReload() {
		const nextSig = streamingRestartSignature(config)
		const streamingChanged = nextSig !== lastStreamingRestartSig
		lastStreamingRestartSig = nextSig

		if (streamingChanged) {
			clearTimeout(streamingReloadTimer)
			streamingReloadTimer = setTimeout(() => {
				// When streaming stays enabled, full restart (not start-only): otherwise UDP probe sees our own ports as “stale”.
				if (config.streaming.enabled) {
					if (appCtx.restartStreaming) void appCtx.restartStreaming()
				} else if (appCtx.toggleStreaming) {
					void appCtx.toggleStreaming(false)
				}
			}, 400)
		}
	}

	function handleCasparConnected() {
		if (config.streaming.enabled) {
			config.streaming._casparHost = config.caspar.host
			startStreamingSubsystem()
		}
	}

	return {
		get streamingTargets() {
			return streamingTargets
		},
		startStreamingSubsystem,
		stopStreamingSubsystem,
		runStreamingRestart,
		enqueueStreaming,
		toggleStreaming,
		restartStreaming,
		handleCasparConnected,
		handleConfigReload,
	}
}

module.exports = { createStreamingLifecycle }
