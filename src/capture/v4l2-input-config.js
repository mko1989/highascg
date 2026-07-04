'use strict'

const { getRouteString, readCasparSetting } = require('../config/routing-map')
const { normalizeInputFormat } = require('./v4l2-enumerate')

/** WO-121: V4L2 host producer layer (one input per dedicated channel). */
const V4L2_HOST_LAYER = 1

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeV4l2DevicePath(raw) {
	const s = String(raw || '').trim()
	if (!s) return ''
	if (s.startsWith('/dev/')) return s
	return s
}

/**
 * @param {object} cfg
 * @param {number} slot 1–8
 * @returns {string}
 */
function resolveV4l2InputDevice(cfg, slot) {
	return normalizeV4l2DevicePath(readCasparSetting(cfg, `v4l2_input_${slot}_device`))
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string}
 */
function resolveV4l2InputLabel(cfg, slot) {
	const raw = readCasparSetting(cfg, `v4l2_input_${slot}_label`)
	if (raw != null && String(raw).trim()) return String(raw).trim()
	const dev = resolveV4l2InputDevice(cfg, slot)
	return dev ? `USB ${dev}` : `V4L2 ${slot}`
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string}
 */
function resolveV4l2InputFormat(cfg, slot) {
	return String(readCasparSetting(cfg, `v4l2_input_${slot}_format`) ?? 'auto').trim() || 'auto'
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {{ width: number, height: number, fps: number }}
 */
function resolveV4l2InputGeometry(cfg, slot) {
	const width = parseInt(String(readCasparSetting(cfg, `v4l2_input_${slot}_width`) ?? 0), 10) || 0
	const height = parseInt(String(readCasparSetting(cfg, `v4l2_input_${slot}_height`) ?? 0), 10) || 0
	const fps = parseInt(String(readCasparSetting(cfg, `v4l2_input_${slot}_fps`) ?? 0), 10) || 0
	return { width, height, fps }
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string}
 */
function resolveV4l2InputAudio(cfg, slot) {
	return String(readCasparSetting(cfg, `v4l2_input_${slot}_audio`) ?? 'none').trim() || 'none'
}

/**
 * @param {object} cfg
 * @returns {boolean}
 */
function isV4l2CaptureBridgeEnabled(cfg) {
	const raw = readCasparSetting(cfg, 'v4l2_capture_bridge')
	if (raw === false || raw === 'false' || raw === 0 || raw === '0') return false
	return true
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {number|null}
 */
function resolveV4l2InputChannel(cfg, slot) {
	const { getChannelMap } = require('../config/routing-map')
	const map = getChannelMap(cfg)
	const chans = Array.isArray(map.v4l2InputChannels) ? map.v4l2InputChannels : []
	const n = parseInt(String(slot), 10)
	if (!Number.isFinite(n) || n < 1 || n > chans.length) return null
	return chans[n - 1]
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {number}
 */
function resolveV4l2HostLayer(_slot) {
	return V4L2_HOST_LAYER
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null}
 */
function resolveV4l2RouteString(cfg, slot) {
	const ch = resolveV4l2InputChannel(cfg, slot)
	if (ch == null) return null
	return getRouteString(ch, V4L2_HOST_LAYER)
}

const V4L2_INPUT_BRIDGE_UDP_PORT_BASE = 52400

/**
 * @param {number} slot
 * @returns {number}
 */
function v4l2InputBridgeUdpPort(slot) {
	return V4L2_INPUT_BRIDGE_UDP_PORT_BASE + parseInt(String(slot), 10)
}

/**
 * @param {number} slot
 * @returns {string}
 */
function v4l2InputBridgePlayClip(slot) {
	const port = v4l2InputBridgeUdpPort(slot)
	return `udp://127.0.0.1:${port}?overrun_nonfatal=1&fifo_size=65536`
}

/**
 * @param {string} device
 * @returns {string}
 */
function buildV4l2DirectPlayUri(device) {
	const dev = normalizeV4l2DevicePath(device)
	if (!dev) return ''
	if (/^v4l2:\/\//i.test(dev)) return dev
	if (dev.startsWith('/')) return `v4l2://${dev}`
	return `v4l2://${dev}`
}

/**
 * Optional ffmpeg input flags after the v4l2 clip (MJPEG size/fps for UVC devices).
 * @param {string} uri
 * @param {object} cfg
 * @param {number} slot
 * @returns {string}
 */
function appendV4l2InputOptionsToClip(uri, cfg, slot) {
	const base = String(uri || '').trim()
	if (!base) return ''
	const fmtRaw = resolveV4l2InputFormat(cfg, slot)
	const { width, height, fps } = resolveV4l2InputGeometry(cfg, slot)
	/** @type {string[]} */
	const parts = [base]
	if (fmtRaw && fmtRaw !== 'auto') parts.push('-input_format', normalizeInputFormat(fmtRaw))
	if (width > 0 && height > 0) parts.push('-video_size', `${width}x${height}`)
	if (fps > 0) parts.push('-framerate', String(fps))
	return parts.join(' ')
}

/**
 * Ordered PLAY clip variants (primary + fallbacks) for recovery after ffmpeg open failures.
 * @param {object} cfg
 * @param {number} slot
 * @returns {string[]}
 */
function listV4l2PlayClipVariants(cfg, slot) {
	if (isV4l2CaptureBridgeEnabled(cfg)) return [v4l2InputBridgePlayClip(slot)]
	const device = resolveV4l2InputDevice(cfg, slot)
	if (!device) return []
	const uri = buildV4l2DirectPlayUri(device)
	/** @type {string[]} */
	const clips = []
	const withOpts = appendV4l2InputOptionsToClip(uri, cfg, slot)
	if (withOpts) clips.push(withOpts)
	if (uri && uri !== withOpts) clips.push(uri)
	return clips
}

/**
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null}
 */
function resolveV4l2PlayClip(cfg, slot) {
	if (!resolveV4l2InputDevice(cfg, slot)) return null
	if (isV4l2CaptureBridgeEnabled(cfg)) return v4l2InputBridgePlayClip(slot)
	const uri = buildV4l2DirectPlayUri(resolveV4l2InputDevice(cfg, slot))
	return appendV4l2InputOptionsToClip(uri, cfg, slot)
}

/**
 * @param {object} cfg
 * @returns {{ count: number, slots: Array<object> }}
 */
function listConfiguredV4l2Slots(cfg) {
	const count = Math.min(8, Math.max(0, parseInt(String(readCasparSetting(cfg, 'v4l2_input_count') ?? 0), 10) || 0))
	/** @type {object[]} */
	const slots = []
	for (let i = 1; i <= count; i++) {
		const device = resolveV4l2InputDevice(cfg, i)
		if (!device) continue
		const clip = resolveV4l2PlayClip(cfg, i)
		if (!clip) continue
		const geometry = resolveV4l2InputGeometry(cfg, i)
		slots.push({
			slot: i,
			channel: resolveV4l2InputChannel(cfg, i),
			layer: resolveV4l2HostLayer(i),
			device,
			label: resolveV4l2InputLabel(cfg, i),
			format: resolveV4l2InputFormat(cfg, i),
			width: geometry.width,
			height: geometry.height,
			fps: geometry.fps,
			audio: resolveV4l2InputAudio(cfg, i),
			clip,
			route: resolveV4l2RouteString(cfg, i),
		})
	}
	return { count, slots }
}

/**
 * FFmpeg ALSA device string from config (`none`, `alsa:hw:3,0`, or `hw:3,0`).
 * @param {object} cfg
 * @param {number} slot
 * @returns {string|null}
 */
function resolveFfmpegV4l2AudioDevice(cfg, slot) {
	const raw = resolveV4l2InputAudio(cfg, slot)
	if (!raw || raw === 'none') return null
	const body = raw.replace(/^alsa:\/\//i, '').trim()
	if (/^(?:plug)?hw:|^default/i.test(body)) return body
	return null
}

module.exports = {
	V4L2_INPUT_BRIDGE_UDP_PORT_BASE,
	V4L2_HOST_LAYER,
	v4l2InputBridgeUdpPort,
	normalizeV4l2DevicePath,
	normalizeInputFormat,
	isV4l2CaptureBridgeEnabled,
	resolveV4l2InputDevice,
	resolveV4l2InputLabel,
	resolveV4l2InputFormat,
	resolveV4l2InputGeometry,
	resolveV4l2InputAudio,
	resolveV4l2InputChannel,
	resolveV4l2HostLayer,
	resolveV4l2RouteString,
	v4l2InputBridgePlayClip,
	buildV4l2DirectPlayUri,
	appendV4l2InputOptionsToClip,
	listV4l2PlayClipVariants,
	resolveV4l2PlayClip,
	listConfiguredV4l2Slots,
	resolveFfmpegV4l2AudioDevice,
}
