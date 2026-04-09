'use strict'

/**
 * Resolved streaming / live-preview options (FFmpeg consumers, go2rtc, WebRTC). Merged into `ctx.config.streaming`.
 * Settings API exposes a subset (`enabled`, `quality`, `basePort`, `hardware_accel`, `ffmpeg_path`).
 */
const STREAMING_DEFAULTS = {
	enabled: false,
	go2rtcPort: 1984,
	webrtcPort: 8555,
	protocol: 'UDP',
	captureMode: 'udp', // auto | local | ndi | udp (legacy config value "srt" = same as udp)
	/** When captureMode is local: auto (prefer kmsgrab if listed), kmsgrab, or x11grab */
	localCaptureDevice: 'auto',
	/** X11 display for x11grab (e.g. :0). systemd jobs often need this. */
	x11Display: ':0',
	/** Names for Caspar's native NDI output and go2rtc's ffmpeg receiver (must match what Caspar publishes). */
	ndiNamingMode: 'auto',
	ndiSourcePattern: 'CasparCG Channel {ch}', // {ch} replaced with channel number
	/** @type {Record<string, string>} channel number string -> exact NDI source name (ndiNamingMode === 'custom') */
	ndiChannelNames: {},
	quality: 'medium', // low | medium | high | native | ultrafast (see QUALITY_PRESETS)
	basePort: 40000,
	hardwareAccel: true,
	maxBitrate: 2000,
	/** Effective output: `half` = width/2 × height/2 (dynamic). `native` = full canvas. Fixed: 720p | 540p | 360p. */
	resolution: 'half',
	fps: 25, // native, 25, 15, 10
	/** DRM device for `kmsgrab` local capture (Linux). */
	drmDevice: '/dev/dri/card0',
	/**
	 * Optional: `trace` | `debug` | `info` | `warn` | `error` — merged into generated `go2rtc.yaml` (`log:`).
	 * Env `HIGHASCG_GO2RTC_LOG_LEVEL` overrides when this is unset. Do not edit `go2rtc.yaml` by hand; it is overwritten when go2rtc starts.
	 */
	go2rtcLogLevel: null,
	/**
	 * When true (default), UDP tier probes base+1 / +2 / +5 before starting bridges; if busy (e.g. stale Caspar STREAM),
	 * scans upward for a free block and uses that runtime base (`_effectiveBasePort`). Set false to fail fast instead.
	 */
	autoRelocateBasePort: true,
}

const QUALITY_PRESETS = {
	/** ½ resolution, low fps/bitrate — fastest. */
	low: {
		resolution: 'half',
		fps: 15,
		maxBitrate: 800,
	},
	/** Default: ½ resolution (e.g. 3840×768 → 1920×384). */
	medium: {
		resolution: 'half',
		fps: 25,
		maxBitrate: 2000,
	},
	/** ½ resolution, higher bitrate. */
	high: {
		resolution: 'half',
		fps: 25,
		maxBitrate: 4000,
	},
	/** Full Caspar resolution (no half-scale). Heavier. */
	native: {
		resolution: 'native',
		fps: 25,
		maxBitrate: 15000,
	},
	/** Same idea as low — minimal bitrate. */
	ultrafast: {
		resolution: 'half',
		fps: 15,
		maxBitrate: 500,
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
