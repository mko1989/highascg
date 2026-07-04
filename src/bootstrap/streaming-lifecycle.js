'use strict'

const { removeStalePreviewStreamConsumers } = require('../streaming/caspar-ffmpeg-setup')

/**
 * On Caspar connect/restart, strip stale preview STREAM/NDI consumers from older configs.
 */
function createStreamingLifecycle({ appCtx, config, getChannelMap }) {
	function buildStalePreviewTargets(basePort) {
		const cm = getChannelMap(config)
		const targets = []
		const pgmCh = cm.programChannels?.[0] ?? 1
		targets.push({ name: 'pgm_1', channel: pgmCh, port: basePort + 1 })
		if (cm.multiviewCh != null) {
			targets.push({ name: 'multiview', channel: cm.multiviewCh, port: basePort + 5 })
		}
		return targets
	}

	let stalePreviewTargets = buildStalePreviewTargets(config.streaming.basePort)

	async function cleanupStalePreviewConsumers() {
		stalePreviewTargets = buildStalePreviewTargets(config.streaming.basePort)
		if (!appCtx.amcp?.isConnected) return
		try {
			await removeStalePreviewStreamConsumers(appCtx.amcp, stalePreviewTargets, config.streaming)
		} catch (e) {
			appCtx.log('warn', `[Streaming] stale preview consumer cleanup: ${e?.message || e}`)
		}
	}

	async function stopStreamingSubsystem() {
		appCtx.streamingPipelineReady = false
		if (appCtx.amcp) await cleanupStalePreviewConsumers()
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
		return enqueueStreaming(cleanupStalePreviewConsumers)
	}

	const restartStreaming = () => enqueueStreaming(cleanupStalePreviewConsumers)

	function streamingRestartSignature(cfg) {
		const s = cfg.streaming || {}
		return JSON.stringify({
			casparHost: cfg.caspar?.host,
			casparPort: cfg.caspar?.port,
			enabled: !!s.enabled,
			basePort: s.basePort,
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
				void cleanupStalePreviewConsumers()
			}, 400)
		}
	}

	function handleCasparConnected() {
		appCtx.streamingPipelineReady = false
		void cleanupStalePreviewConsumers()
	}

	return {
		get streamingTargets() {
			return stalePreviewTargets
		},
		stopStreamingSubsystem,
		enqueueStreaming,
		toggleStreaming,
		restartStreaming,
		handleCasparConnected,
		handleConfigReload,
	}
}

module.exports = { createStreamingLifecycle }
