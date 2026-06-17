'use strict'

/**
 * Legacy streaming lifecycle — browser preview UDP/go2rtc removed.
 * On connect/restart we only strip stale Caspar STREAM/NDI consumers from older configs.
 */
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
	void addStreamingConsumers
	void resolveFreeStreamingBasePort
	void prepareNdiStreaming
	void resolveCaptureTier

	function buildStreamingTargets(basePort) {
		const cm = getChannelMap(config)
		const targets = []
		const pgmCh = cm.programChannels?.[0] ?? 1
		targets.push({ name: 'pgm_1', channel: pgmCh, port: basePort + 1 })
		if (cm.multiviewCh != null) {
			targets.push({ name: 'multiview', channel: cm.multiviewCh, port: basePort + 5 })
		}
		return targets
	}

	let streamingTargets = buildStreamingTargets(config.streaming.basePort)

	async function startStreamingSubsystem() {
		appCtx.streamingPipelineReady = false
		streamingTargets = buildStreamingTargets(config.streaming.basePort)
		if (config.streaming.enabled) {
			appCtx.log(
				'info',
				'[Streaming] Live preview UDP/WebRTC was removed — Settings → Streaming no longer adds Caspar STREAM consumers. Use stream outputs / streaming channel for RTMP.',
			)
		}
		if (!appCtx.amcp?.isConnected) return
		try {
			await removeStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
		} catch (e) {
			appCtx.log('warn', `[Streaming] stale consumer cleanup: ${e?.message || e}`)
		}
	}

	async function stopStreamingSubsystem() {
		try {
			appCtx.streamingPipelineReady = false
			if (appCtx.amcp) await removeStreamingConsumers(appCtx.amcp, streamingTargets, config.streaming)
		} catch (e) {
			appCtx.log('warn', `[Streaming] stopStreamingSubsystem: ${e?.message || e}`)
		}
	}

	async function runStreamingRestart() {
		await stopStreamingSubsystem()
		const delayMs = Math.max(
			0,
			parseInt(process.env.HIGHASCG_STREAMING_RESTART_DELAY_MS || '500', 10) || 500
		)
		if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
		await startStreamingSubsystem()
	}

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
			if (enabled) {
				appCtx.log(
					'warn',
					'[Streaming] Preview streaming toggle ignored — UDP/WebRTC preview removed. RTMP: stream outputs or /api/streaming-channel/rtmp.',
				)
			}
			await runStreamingRestart()
		})
	}

	const restartStreaming = () => enqueueStreaming(runStreamingRestart)

	function streamingRestartSignature(cfg) {
		const s = cfg.streaming || {}
		return JSON.stringify({
			casparHost: cfg.caspar?.host,
			casparPort: cfg.caspar?.port,
			enabled: !!s.enabled,
		})
	}
	let lastStreamingRestartSig = streamingRestartSignature(config)
	let streamingReloadTimer = null

	function handleConfigReload() {
		const nextSig = streamingRestartSignature(config)
		const streamingChanged = nextSig !== lastStreamingRestartSig
		lastStreamingRestartSig = nextSig
		if (streamingChanged) {
			clearTimeout(streamingReloadTimer)
			streamingReloadTimer = setTimeout(() => {
				void runStreamingRestart()
			}, 400)
		}
	}

	function handleCasparConnected() {
		void startStreamingSubsystem()
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
