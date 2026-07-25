'use strict'

/**
 * WO-333 — audio-capture FFT lifecycle: line-in / USB ALSA capture → analyser frames →
 * WS broadcast `type:'audio_fft'` for shader reactivity (template/shaders/player.js).
 *
 * Opt-in via config.audioCapture.enabled (config/audio_capture.json) or HIGHASCG_AUDIO_FFT=1.
 * Frames ride the same /api/ws the shader templates already connect to for OSC levels; each
 * frame is { freq, wave } as base64 (512 bytes each, AnalyserNode byte semantics) + rms.
 */

const {
	normalizeAudioCaptureConfig,
	createAudioCaptureFft,
} = require('../audio/audio-capture-fft')

/**
 * @param {{ appCtx: object, config: object, logger: { info: Function, warn: Function } }} deps
 */
function createAudioCaptureLifecycle({ appCtx, config, logger }) {
	/** @type {ReturnType<typeof createAudioCaptureFft>|null} */
	let engine = null

	function warnOnLiveAudioClash(cfg) {
		// Plain hw devices are single-open: an on-air live-audio bridge slot on the same card
		// would lose its capture (or we would never open). Best-effort warning only.
		try {
			const { listConfiguredLiveAudioSlots, parseAlsaHwIdentity } = require('../config/live-audio-input')
			const mine = parseAlsaHwIdentity(cfg.device)
			if (!mine) return
			for (const slot of listConfiguredLiveAudioSlots(config).slots) {
				if (parseAlsaHwIdentity(slot.device) === mine) {
					logger.warn(
						`[AudioFFT] capture device ${cfg.device} is also live-audio slot ${slot.slot} (${slot.device}) — ALSA hw devices are single-open; use a dsnoop/plug alias or a separate device`,
					)
				}
			}
		} catch {
			/* advisory only */
		}
	}

	function startAudioCapture() {
		const cfg = normalizeAudioCaptureConfig(config)
		// WO-333b: a live-audio slot routed as the FFT source (inspector toggle →
		// caspar setting audio_fft_source_slot) wins over the standalone-device mode —
		// the slot's bridge ffmpeg tees raw PCM to us, so the capture host stays the
		// device's only opener. The tee output format is pinned s16le/48k/stereo.
		let fftSlot = 0
		try {
			const { resolveAudioFftSourceSlot } = require('../config/live-audio-input')
			fftSlot = resolveAudioFftSourceSlot(config)
		} catch {
			/* live-audio config unavailable — device mode only */
		}
		if (fftSlot >= 1) {
			const { audioFftPcmUdpPort } = require('../audio/live-audio-bridge')
			cfg.enabled = true
			cfg.source = 'slot'
			cfg.udpPort = audioFftPcmUdpPort(fftSlot)
			cfg.sampleRate = 48000
			cfg.channels = 2
			logger.info(`[AudioFFT] source: live-audio slot ${fftSlot} bridge tee`)
		}
		if (!cfg.enabled) {
			logger.info('[AudioFFT] no source routed (live-audio inspector) and config.audioCapture disabled — shaders fall back to OSC-level reactivity')
			return
		}
		if (cfg.source !== 'slot') warnOnLiveAudioClash(cfg)
		engine = createAudioCaptureFft({
			config: cfg,
			log: (level, msg) => (level === 'warn' ? logger.warn(msg) : logger.info(msg)),
			onFrame: (frame) => {
				if (typeof appCtx._wsBroadcast !== 'function') return
				appCtx._wsBroadcast('audio_fft', {
					freq: Buffer.from(frame.freq).toString('base64'),
					wave: Buffer.from(frame.wave).toString('base64'),
					rms: Math.round(frame.rms * 1000) / 1000,
					device: frame.device,
				})
			},
		})
		engine.start()
		appCtx.getAudioCaptureStatus = () => (engine ? engine.getStatus() : null)
	}

	function stopAudioCapture() {
		if (engine) engine.stop()
		engine = null
	}

	/** Re-read config and rebind — called after /api/audio/live-inputs/apply so routing the
	 * FFT source in the inspector takes effect immediately, no node restart. Runs BEFORE the
	 * bridges restart so the UDP listener is bound when the tee starts sending. */
	function restartAudioCapture() {
		stopAudioCapture()
		startAudioCapture()
	}

	return { startAudioCapture, stopAudioCapture, restartAudioCapture, onShutdown: stopAudioCapture }
}

module.exports = { createAudioCaptureLifecycle }
