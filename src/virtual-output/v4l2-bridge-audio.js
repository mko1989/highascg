'use strict'

const {
	resolveAlsaLoopbackConfig,
	ensureAlsaLoopback,
	releaseAlsaLoopback,
	resetAlsaLoopbackState,
	getAlsaLoopbackCardId,
} = require('./v4l2-bridge-audio-sink')

/** AMCP slot for v4l2 bridge audio → ALSA loopback playback side. */
const V4L2_BRIDGE_AUDIO_CONSUMER_INDEX = 711

/** @type {{ attached: boolean, channel: number|null, lastError?: string, attachedAt?: number, captureDevice?: string, captureHint?: string, casparPath?: string }} */
let _audioState = { attached: false, channel: null }

/**
 * @param {object} config
 * @returns {boolean}
 */
function isVirtualCameraAudioEnabled(config) {
	const vc = config?.virtualCamera || {}
	if (vc.audioEnabled === false) return false
	return vc.audioEnabled !== false
}

/**
 * Stereo downmix for ALSA loopback playback side.
 * @returns {string}
 */
function buildV4l2BridgeAudioCasparArgs() {
	return '-filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a pcm_s16le -ar 48000 -ac 2'
}

/**
 * @param {string} casparPath
 * @returns {{ path: string, params: string }}
 */
function buildV4l2BridgeAudioAddParams(casparPath) {
	const args = buildV4l2BridgeAudioCasparArgs()
	return { path: casparPath, params: `${casparPath} ${args}` }
}

/**
 * @param {object} ctx
 * @param {number} channel
 */
async function attachV4l2BridgeAudioConsumer(ctx, channel) {
	const ch = parseInt(String(channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return
	if (!isVirtualCameraAudioEnabled(ctx?.config)) return
	if (!ctx?.amcp?.isConnected) {
		_audioState = { attached: false, channel: ch, lastError: 'AMCP not connected' }
		return
	}

	const sink = await ensureAlsaLoopback(ctx, ctx.config || {})
	if (!sink.ok) {
		_audioState = { attached: false, channel: ch, lastError: sink.lastError || 'ALSA loopback not available' }
		return
	}

	await detachV4l2BridgeAudioConsumer(ctx)

	const { path, params } = buildV4l2BridgeAudioAddParams(sink.casparPath)
	try {
		const res = await ctx.amcp.basic.add(ch, 'FILE', params, V4L2_BRIDGE_AUDIO_CONSUMER_INDEX)
		if (res && res.ok === false) {
			throw new Error(res.error || 'ADD FILE audio failed')
		}
		_audioState = {
			attached: true,
			channel: ch,
			attachedAt: Date.now(),
			captureDevice: sink.captureDevice,
			captureHint: sink.captureHint,
			casparPath: path,
			lastError: undefined,
		}
		ctx.log?.(
			'info',
			`[v4l2-bridge] ch${ch} audio → ${path} (virtual mic: ${sink.captureDevice})`,
		)
	} catch (e) {
		const msg = e?.message || String(e)
		_audioState = { attached: false, channel: ch, lastError: msg, casparPath: path }
		ctx.log?.('warn', `[v4l2-bridge] ch${ch} audio ADD FILE failed: ${msg}`)
	}
}

/**
 * @param {object} ctx
 */
async function detachV4l2BridgeAudioConsumer(ctx) {
	const ch = _audioState.channel
	if (ch && ctx?.amcp?.isConnected) {
		try {
			await ctx.amcp.basic.remove(ch, null, V4L2_BRIDGE_AUDIO_CONSUMER_INDEX)
		} catch {
			/* ok */
		}
	}
	_audioState = { attached: false, channel: ch ?? null }
}

/**
 * @param {object} [ctx]
 */
async function stopV4l2BridgeAudio(ctx) {
	await detachV4l2BridgeAudioConsumer(ctx || { amcp: null })
	await releaseAlsaLoopback()
}

/**
 * @param {object} config
 */
function getV4l2BridgeAudioStats(config) {
	const vc = config?.virtualCamera || {}
	const ch = Math.max(1, parseInt(String(vc.channel ?? _audioState.channel ?? 1), 10) || 1)
	const { cardId, captureDevice } = resolveAlsaLoopbackConfig(config || {})
	const activeCard = getAlsaLoopbackCardId()
	const casparPath = _audioState.casparPath || `-f alsa plughw:${cardId},0,0`
	const captureHint = _audioState.captureHint || `${cardId} (ALSA capture device 1)`

	return {
		enabled: isVirtualCameraAudioEnabled(config),
		consumerIndex: V4L2_BRIDGE_AUDIO_CONSUMER_INDEX,
		transport: 'alsa_loopback',
		channel: ch,
		attached: !!_audioState.attached && _audioState.channel === ch,
		lastError: _audioState.lastError || null,
		attachedAt: _audioState.attachedAt || null,
		loopbackCard: activeCard || cardId,
		casparPath,
		captureDevice: _audioState.captureDevice || captureDevice,
		captureHint,
		hint: `Select "${captureHint}" as microphone (ALSA / PortAudio device list in Zoom/OBS)`,
	}
}

function resetV4l2BridgeAudioState() {
	_audioState = { attached: false, channel: null }
	resetAlsaLoopbackState()
}

module.exports = {
	V4L2_BRIDGE_AUDIO_CONSUMER_INDEX,
	isVirtualCameraAudioEnabled,
	attachV4l2BridgeAudioConsumer,
	detachV4l2BridgeAudioConsumer,
	stopV4l2BridgeAudio,
	getV4l2BridgeAudioStats,
	resetV4l2BridgeAudioState,
}
