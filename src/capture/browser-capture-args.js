'use strict'

/**
 * browser-capture-args.js — WO-258 T258.2: pure ffmpeg-args/AMCP-clip builders for the browser
 * source capture relay. Mirrors `src/capture/v4l2-input-bridge.js`'s
 * `buildV4l2InputBridgeFfmpegArgs`/`v4l2InputBridgePlayClip` shape — that module (ffmpeg captures an
 * external v4l2 device -> h264/mpegts -> `udp://127.0.0.1:PORT`, Caspar PLAYs the udp:// clip
 * directly) is the correct existing precedent to reuse here, NOT `src/virtual-output/v4l2-bridge*.js`
 * (that subsystem runs the opposite direction: it relays CASPAR'S OWN rendered channel OUT to a
 * v4l2loopback device so external apps see Caspar as a webcam — see
 * src/bootstrap/v4l2-bridge-lifecycle.js). This file only swaps the ffmpeg input side
 * (`-f v4l2 -i <device>` -> `-f x11grab -i :0.0+X,Y`); the output side (h264/mpegts -> loopback UDP
 * -> Caspar PLAY udp://...) is unchanged from the v4l2-input-bridge precedent.
 *
 * Port allocation: v4l2-input-bridge uses a fixed 8-slot base (52400+slot). browser_display sources
 * are dynamic (one per extraLiveSources entry, unbounded count, no fixed slot), so the port is
 * derived from the source's already-unique `hostChannel` instead (BROWSER_CAPTURE_UDP_PORT_BASE +
 * hostChannel) — hostChannel uniqueness is already guaranteed by `suggestNextHostChannel`/
 * `usedCasparChannels` in src/config/host-live-sources.js, so this can't collide across sources.
 */

/** Loopback UDP port base for browser_display capture relays (kept clear of v4l2-input-bridge's
 * 52401-52408 and the v4l2-bridge stream default 5555). */
const BROWSER_CAPTURE_UDP_PORT_BASE = 53000

/** Warmup after (re)spawn before Caspar PLAY / before treating the bridge as ready. */
const BROWSER_CAPTURE_WARMUP_MS = 700

/**
 * @param {number} hostChannel
 * @returns {number}
 */
function browserCaptureUdpPort(hostChannel) {
	const ch = Math.max(1, parseInt(String(hostChannel), 10) || 1)
	return BROWSER_CAPTURE_UDP_PORT_BASE + ch
}

/**
 * @param {number} hostChannel
 * @returns {string}
 */
function browserCapturePlayClip(hostChannel) {
	const port = browserCaptureUdpPort(hostChannel)
	return `udp://127.0.0.1:${port}?overrun_nonfatal=1&fifo_size=65536`
}

/**
 * @param {unknown} fps
 * @returns {number}
 */
function clampBrowserCaptureFps(fps) {
	const n = parseInt(String(fps ?? ''), 10)
	if (!Number.isFinite(n)) return 25
	return Math.max(1, Math.min(60, n))
}

/**
 * ffmpeg args for `x11grab` of the browser's off-screen region -> h264/mpegts -> loopback UDP.
 * Mirrors `buildV4l2InputBridgeFfmpegArgs` (same libx264 ultrafast/zerolatency/mpegts recipe) with
 * the input side swapped to x11grab of a fixed root-desktop rect. Video only — WO-258 explicitly
 * scopes audio out for v1 (ALSA-loopback is the documented future path, see [live-audio-bridge]).
 * @param {{ x: number, y: number, w: number, h: number }} region - root/absolute :0 pixel rect
 * @param {number} hostChannel
 * @param {{ fps?: number, display?: string }} [opts]
 * @returns {string[]}
 */
function buildBrowserCaptureFfmpegArgs(region, hostChannel, opts = {}) {
	const fps = clampBrowserCaptureFps(opts.fps)
	const display = String(opts.display || ':0').trim() || ':0'
	const port = browserCaptureUdpPort(hostChannel)
	const w = Math.max(2, parseInt(String(region?.w), 10) || 0)
	const h = Math.max(2, parseInt(String(region?.h), 10) || 0)
	const x = Math.max(0, parseInt(String(region?.x), 10) || 0)
	const y = Math.max(0, parseInt(String(region?.y), 10) || 0)
	const gop = Math.max(1, Math.min(fps, 50))

	return [
		'-hide_banner',
		'-loglevel',
		'warning',
		'-nostdin',
		'-thread_queue_size',
		'512',
		'-f',
		'x11grab',
		'-video_size',
		`${w}x${h}`,
		'-framerate',
		String(fps),
		'-i',
		`${display}.0+${x},${y}`,
		'-an',
		'-c:v',
		'libx264',
		'-preset',
		'ultrafast',
		'-tune',
		'zerolatency',
		'-pix_fmt',
		'yuv420p',
		'-r',
		String(fps),
		'-g',
		String(gop),
		'-keyint_min',
		String(gop),
		'-x264-params',
		`min-keyint=${gop}:scenecut=0:repeat-headers=1`,
		'-muxdelay',
		'0',
		'-muxpreload',
		'0',
		'-f',
		'mpegts',
		`udp://127.0.0.1:${port}?pkt_size=1316`,
	]
}

module.exports = {
	BROWSER_CAPTURE_UDP_PORT_BASE,
	BROWSER_CAPTURE_WARMUP_MS,
	browserCaptureUdpPort,
	browserCapturePlayClip,
	clampBrowserCaptureFps,
	buildBrowserCaptureFfmpegArgs,
}
