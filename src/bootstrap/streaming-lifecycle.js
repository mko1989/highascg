'use strict'

function createStreamingLifecycle({
	appCtx,
	config,
	logger,
	getChannelMap,
	go2rtcManager,
	addStreamingConsumers,
	removeStreamingConsumers,
	resolveFreeStreamingBasePort,
	prepareNdiStreaming,
	resolveCaptureTier,
}) {
	void logger

	/**
	 * Map logical WebRTC names (pgm_1, prv_1, multiview) to real Caspar channels from screen/multiview layout.
	 * Hardcoding 1/2/3 was wrong for multi-screen configs (e.g. multiview on ch 5, ch 3 = second PGM).
	 */
	function buildStreamingTargets(basePort) {
		const cm = getChannelMap(config)
		const targets = []
		const pgmCh = cm.programChannels?.[0] ?? 1
		const prvCh = cm.previewChannels?.[0] ?? 2
		targets.push({ name: 'pgm_1', channel: pgmCh, port: basePort + 1 })
		targets.push({ name: 'prv_1', channel: prvCh, port: basePort + 2 })
		if (cm.multiviewCh != null) {
			targets.push({ name: 'multiview', channel: cm.multiviewCh, port: basePort + 5 })
		}
		appCtx.log(
			'info',
			`[Streaming] targets: PGM ch${pgmCh}→${basePort + 1}, PRV ch${prvCh}→${basePort + 2}` +
				(cm.multiviewCh != null ? `, MV ch${cm.multiviewCh}→${basePort + 5}` : ' (no multiview channel)')
		)
		return targets
	}

	/** Updated each `startStreamingSubsystem` (UDP tier may relocate base if ports are busy). */
	let streamingTargets = buildStreamingTargets(config.streaming.basePort)

	/** NDI only: Caspar must register NDI before go2rtc receive; if AMCP was down at start, restart go2rtc after first connect. */
	let needGo2rtcRestartAfterCaspar = false

	async function startStreamingSubsystem() {
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

			if (tier === 'ndi') {
				if (appCtx.amcp?.isConnected) {
					await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
					needGo2rtcRestartAfterCaspar = false
				} else {
					needGo2rtcRestartAfterCaspar = true
					appCtx.log('warn', '[Streaming] NDI: Caspar AMCP not connected yet — will register NDI after connect')
				}
				await go2rtcManager.start(streamingTargets, config.streaming, config.caspar.host)
				appCtx.streamingPipelineReady = !!appCtx.amcp?.isConnected
			} else if (tier === 'udp') {
				// UDP MPEG-TS: go2rtc first, then Caspar ADD STREAM. Do not expose pipelineReady until ADD completes
				// or the browser negotiates WebRTC before MPEG-TS exists → ffmpeg 500 / version banner on stderr.
				appCtx.log('info', '[Streaming] UDP tier: starting go2rtc first, then Caspar ADD STREAM')
				await go2rtcManager.start(streamingTargets, config.streaming, config.caspar.host)
				needGo2rtcRestartAfterCaspar = false
				if (appCtx.amcp?.isConnected) {
					await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
					// HTTP push ingest: wait until go2rtc lists producers so WebRTC is not offered on empty streams.
					await go2rtcManager.waitForPushIngestReady(streamingTargets, config.streaming, { log: appCtx.log })
					appCtx.streamingPipelineReady = true
				} else {
					appCtx.log('warn', '[Streaming] UDP tier: AMCP not connected — skip ADD STREAM until Caspar connects')
				}
			} else {
				needGo2rtcRestartAfterCaspar = false
				await go2rtcManager.start(streamingTargets, config.streaming, config.caspar.host)
				if (tier === 'local' && appCtx.amcp) {
					await addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
				}
				appCtx.streamingPipelineReady = true
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
			appCtx.log('info', '[Streaming] stopStreamingSubsystem (remove Caspar consumers, stop go2rtc)')
			if (appCtx.amcp) await removeStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
			await go2rtcManager.stop()
		} catch (e) {
			appCtx.log('warn', `[Streaming] stopStreamingSubsystem: ${e?.message || e}`)
		}
	}

	/**
	 * Stop preview stack, release UDP listeners, then start again.
	 * Must run before `resolveFreeStreamingBasePort` — otherwise our own ffmpeg/go2rtc still bind base+1/+2/+5
	 * and the probe falsely reports “busy”, relocates base, and breaks Caspar STREAM + go2rtc alignment.
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

	/** Serialize start/stop so overlapping config + Caspar events cannot double-spawn go2rtc (SIGKILL storms). */
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
	 * Only preview/streaming (Caspar ADD STREAM / go2rtc) depends on these fields. Saving unrelated keys
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
			go2rtcLogLevel: s.go2rtcLogLevel,
			autoRelocateBasePort: s.autoRelocateBasePort,
			resolution: s.resolution,
			fps: s.fps,
			maxBitrate: s.maxBitrate,
		})
	}
	let lastStreamingRestartSig = streamingRestartSignature(config)

	// T1.3: Live reload — debounce streaming so double-save / OSC + save does not restart go2rtc twice in one tick.
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
			// Avoid a second full go2rtc start if settings reload already spawned it (races with Caspar connect).
			if (go2rtcManager.process) {
				addStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
					.then(async () => {
						appCtx.streamingPipelineReady = true
						if (
							needGo2rtcRestartAfterCaspar &&
							typeof appCtx.restartStreaming === 'function'
						) {
							needGo2rtcRestartAfterCaspar = false
							await appCtx.restartStreaming()
						}
					})
					.catch((e) => {
						appCtx.log('error', `Streaming consumers: ${e?.message || e}`)
					})
			} else {
				startStreamingSubsystem()
			}
		}
	}

	function getNeedGo2rtcRestart() {
		return needGo2rtcRestartAfterCaspar
	}

	function setNeedGo2rtcRestart(v) {
		needGo2rtcRestartAfterCaspar = !!v
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
		getNeedGo2rtcRestart,
		setNeedGo2rtcRestart,
	}
}

module.exports = { createStreamingLifecycle }
