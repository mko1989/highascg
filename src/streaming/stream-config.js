'use strict'

/**
 * Resolved streaming / live-preview options (FFmpeg consumers, go2rtc, WebRTC). Merged into `ctx.config.streaming`.
 * Settings API exposes a subset (`enabled`, `quality`, `basePort`, `hardware_accel`, `ffmpeg_path`).
 */
const STREAMING_DEFAULTS = {
	enabled: false,
	go2rtcPort: 1984,
	webrtcPort: 8555,
	protocol: 'SRT',
	captureMode: 'auto', // auto | local | ndi | srt
	/** When captureMode is local: auto (prefer kmsgrab if listed), kmsgrab, or x11grab */
	localCaptureDevice: 'auto',
	/** X11 display for x11grab (e.g. :0). systemd jobs often need this. */
	x11Display: ':0',
	/** Names for Caspar's native NDI output and go2rtc's ffmpeg receiver (must match what Caspar publishes). */
	ndiNamingMode: 'auto',
	ndiSourcePattern: 'CasparCG Channel {ch}', // {ch} replaced with channel number
	/** @type {Record<string, string>} channel number string -> exact NDI source name (ndiNamingMode === 'custom') */
	ndiChannelNames: {},
	quality: 'medium', // low, medium, high, custom
	basePort: 10000,
	hardwareAccel: true,
	maxBitrate: 2000,
	resolution: '540p', // native, 720p, 540p, 360p
	fps: 25, // native, 25, 15, 10
	/** DRM device for `kmsgrab` local capture (Linux). */
	drmDevice: '/dev/dri/card0',
}

const QUALITY_PRESETS = {
	low: {
		resolution: '360p',
		fps: 15,
		maxBitrate: 500,
	},
	medium: {
		resolution: '540p',
		fps: 25,
		maxBitrate: 2000,
	},
	high: {
		resolution: '720p',
		fps: 25,
		maxBitrate: 4000,
	},
}

/**
 * Given user streaming config, returns the actual parameters to use.
 * Applies defaults and preset overrides.
 */
function resolveStreamingConfig(userConfig = {}) {
	const c = { ...STREAMING_DEFAULTS, ...userConfig }
	if (c.quality && QUALITY_PRESETS[c.quality]) {
		const preset = QUALITY_PRESETS[c.quality]
		c.resolution = preset.resolution
		c.fps = preset.fps
		c.maxBitrate = preset.maxBitrate
	}
	return c
}

module.exports = {
	STREAMING_DEFAULTS,
	QUALITY_PRESETS,
	resolveStreamingConfig,
}
