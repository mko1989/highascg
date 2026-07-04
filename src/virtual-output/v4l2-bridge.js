'use strict'

const consumer = require('./v4l2-bridge-consumer')
const audio = require('./v4l2-bridge-audio')
const relay = require('./v4l2-bridge-relay')
const { buildV4l2BridgeCasparAddParams } = require('./v4l2-bridge-args')
const { resolveV4l2BridgeJpgPath, waitForV4l2BridgeJpgReady } = require('./v4l2-bridge-cache')
const { ensureVcamKernelModules } = require('./v4l2-kernel-modules')
const { normalizeVirtualCameraConfig } = require('./v4l2-bridge-config')

/** Serializes start/stop. */
let _lifecycleChain = Promise.resolve()
/** @type {boolean} */
let _running = false
/** @type {boolean} */
let _starting = false
/** @type {boolean} */
let _intentionalStop = false

/**
 * @param {object} [config]
 * @returns {boolean}
 */
function isVirtualCameraEnabled(config) {
	return !!normalizeVirtualCameraConfig(config?.virtualCamera).enabled
}

/**
 * @param {object} [config]
 * @returns {number}
 */
function resolveVirtualCameraChannel(config) {
	return normalizeVirtualCameraConfig(config?.virtualCamera).channel
}

/**
 * @param {() => Promise<void>} fn
 */
function enqueue(fn) {
	const run = () => fn()
	_lifecycleChain = _lifecycleChain.then(run, run)
	return _lifecycleChain
}

/**
 * @param {object} ctx
 */
async function stopV4l2BridgeInternal(ctx) {
	_intentionalStop = true
	_running = false
	await consumer.detachV4l2BridgeConsumer(ctx)
	await audio.stopV4l2BridgeAudio(ctx)
	relay.stopAllV4l2BridgeRelays()
	await new Promise((r) => setTimeout(r, 300))
	_intentionalStop = false
	if (ctx) ctx.log?.('debug', '[v4l2-bridge] stopped')
}

function wireRelayExitHandler(ctx, channel) {
	return () => {
		if (_intentionalStop) return
		if (!_running) return
		ctx?.log?.('warn', `[v4l2-bridge] relay ch${channel} exited — removing Caspar consumer`)
		_running = false
		void enqueue(async () => {
			await consumer.detachV4l2BridgeConsumer(ctx)
			await audio.detachV4l2BridgeAudioConsumer(ctx)
		})
	}
}

/**
 * Compose-preview order: stub → Caspar FILE writer → relay reads overwriting JPG → v4l2.
 * @param {object} ctx
 */
async function startV4l2BridgeInternal(ctx) {
	if (!isVirtualCameraEnabled(ctx?.config)) {
		return { ok: false, reason: 'disabled' }
	}
	if (!ctx?.amcp?.isConnected) {
		ctx?.log?.('debug', '[v4l2-bridge] skip start — AMCP not connected')
		return { ok: false, reason: 'amcp_disconnected' }
	}
	if (_starting || _running) {
		ctx?.log?.('debug', '[v4l2-bridge] already starting or running — skip')
		return { ok: true, reason: 'already_running', running: _running }
	}
	_starting = true

	try {
		const ch = resolveVirtualCameraChannel(ctx.config)
		await stopV4l2BridgeInternal(ctx)

		const modules = await ensureVcamKernelModules(ctx, ctx.config)
		if (!modules.ok) {
			ctx?.log?.('warn', `[v4l2-bridge] kernel modules: ${modules.lastError}`)
			return { ok: false, reason: 'kernel_modules', lastError: modules.lastError, stats: getV4l2BridgeStats(ctx.config) }
		}

		await consumer.attachV4l2BridgeConsumer(ctx, ch)
		if (!consumer.getV4l2BridgeConsumerStats(ctx.config).attached) {
			return { ok: false, reason: 'caspar_video_consumer_failed', stats: getV4l2BridgeStats(ctx.config) }
		}

		await audio.attachV4l2BridgeAudioConsumer(ctx, ch)

		const jpgPath = resolveV4l2BridgeJpgPath(ctx.config, ch)
		if (jpgPath) {
			const ready = await waitForV4l2BridgeJpgReady(jpgPath, 8000)
			if (!ready) {
				ctx?.log?.('warn', `[v4l2-bridge] ch${ch} JPEG buffer not ready — relay may fail until Caspar writes`)
			}
		}

		relay.startV4l2BridgeRelay(ctx, ch, { onExit: wireRelayExitHandler(ctx, ch) })
		await new Promise((r) => setTimeout(r, 400))

		if (!relay.isV4l2BridgeRelayRunning(ch)) {
			ctx?.log?.('warn', `[v4l2-bridge] relay ch${ch} failed — removing Caspar consumers`)
			_intentionalStop = true
			await consumer.detachV4l2BridgeConsumer(ctx)
			await audio.detachV4l2BridgeAudioConsumer(ctx)
			_intentionalStop = false
			return { ok: false, reason: 'relay_failed', stats: getV4l2BridgeStats(ctx.config) }
		}

		_running = true
		const { amcpPath } = buildV4l2BridgeCasparAddParams(ctx.config, ch)
		ctx?.log?.(
			'info',
			`[v4l2-bridge] active ch${ch} ${amcpPath} → relay → ${relay.getV4l2BridgeRelayStats(ctx.config).device}`,
		)
		return { ok: true, reason: 'started', stats: getV4l2BridgeStats(ctx.config) }
	} finally {
		_starting = false
	}
}

function startV4l2Bridge(ctx) {
	return enqueue(() => startV4l2BridgeInternal(ctx))
}

function stopV4l2Bridge(ctx) {
	return enqueue(() => stopV4l2BridgeInternal(ctx))
}

function getV4l2BridgeStats(config) {
	const vc = normalizeVirtualCameraConfig(config?.virtualCamera)
	return {
		enabled: !!vc.enabled,
		label: vc.label,
		config: vc,
		channel: vc.channel,
		running: _running,
		starting: _starting,
		video: {
			relay: relay.getV4l2BridgeRelayStats(config),
			consumer: consumer.getV4l2BridgeConsumerStats(config),
		},
		audio: audio.getV4l2BridgeAudioStats(config),
	}
}

module.exports = {
	isVirtualCameraEnabled,
	resolveVirtualCameraChannel,
	startV4l2Bridge,
	stopV4l2Bridge,
	getV4l2BridgeStats,
}
