'use strict'

const {
	clampV4l2BridgeFps,
	clampJpegQuality,
	normalizeResolutionScale,
	normalizeV4l2BridgeMode,
	clampV4l2BridgeStreamPort,
} = require('./v4l2-bridge-args')

/** @type {Readonly<object>} */
const VIRTUAL_CAMERA_DEFAULTS = Object.freeze({
	enabled: false,
	label: 'Virtual cam',
	channel: 1,
	device: '/dev/video10',
	basenamePrefix: 'highascg_vcam',
	/** 'jpeg' = Caspar FILE → overwriting JPEG → relay (WO-137). 'stream' = Caspar STREAM → udp → relay (WO-145). */
	mode: 'jpeg',
	/** Loopback UDP port for mode 'stream' (Caspar sends from streamPort+10000 via ?localport=). */
	streamPort: 5555,
	width: 1920,
	height: 1080,
	fps: 50,
	resolutionScale: 'full',
	jpegQuality: 10,
	audioEnabled: true,
	/* WO-376 (owner): "maybe a tick in the virtual camera output inspector to send to shaders as
	 * camera". Opt-in: shader templates only bind their `camera` channel when this is on, so a
	 * shader never silently opens a capture device the operator did not offer it. */
	shaderCamera: false,
	alsaLoopbackCardId: 'HighAsCG_VCam',
	alsaLoopbackIndex: 20,
	alsaLoopbackPcm: 2,
	showInDeviceView: true,
})

/**
 * @param {unknown} raw
 * @returns {object}
 */
function normalizeVirtualCameraConfig(raw) {
	const src = raw && typeof raw === 'object' ? raw : {}
	const vc = { ...VIRTUAL_CAMERA_DEFAULTS, ...src }
	vc.enabled = !!vc.enabled
	vc.label = String(vc.label || VIRTUAL_CAMERA_DEFAULTS.label).trim().slice(0, 120) || VIRTUAL_CAMERA_DEFAULTS.label
	vc.channel = Math.max(1, parseInt(String(vc.channel ?? 1), 10) || 1)
	vc.device = String(vc.device || VIRTUAL_CAMERA_DEFAULTS.device).trim() || VIRTUAL_CAMERA_DEFAULTS.device
	vc.basenamePrefix = String(vc.basenamePrefix || VIRTUAL_CAMERA_DEFAULTS.basenamePrefix).trim() || VIRTUAL_CAMERA_DEFAULTS.basenamePrefix
	vc.mode = normalizeV4l2BridgeMode(vc.mode)
	vc.streamPort = clampV4l2BridgeStreamPort(vc.streamPort)
	vc.width = Math.max(320, parseInt(String(vc.width ?? 1920), 10) || 1920)
	vc.height = Math.max(240, parseInt(String(vc.height ?? 1080), 10) || 1080)
	vc.fps = clampV4l2BridgeFps(vc.fps, 50)
	vc.resolutionScale = normalizeResolutionScale(vc.resolutionScale)
	vc.jpegQuality = clampJpegQuality(vc.jpegQuality, 10)
	vc.audioEnabled = vc.audioEnabled !== false
	vc.shaderCamera = vc.shaderCamera === true
	vc.alsaLoopbackCardId = String(vc.alsaLoopbackCardId || VIRTUAL_CAMERA_DEFAULTS.alsaLoopbackCardId).trim() || VIRTUAL_CAMERA_DEFAULTS.alsaLoopbackCardId
	vc.alsaLoopbackIndex = Math.max(0, parseInt(String(vc.alsaLoopbackIndex ?? 20), 10) || 20)
	vc.alsaLoopbackPcm = Math.max(2, parseInt(String(vc.alsaLoopbackPcm ?? 2), 10) || 2)
	vc.showInDeviceView = vc.showInDeviceView !== false
	return vc
}

/**
 * @param {object} config
 * @param {object} patch
 * @returns {object}
 */
function patchVirtualCameraConfig(config, patch) {
	const cur = normalizeVirtualCameraConfig(config?.virtualCamera)
	const p = patch && typeof patch === 'object' ? patch : {}
	const next = { ...cur }
	if (p.enabled != null) next.enabled = !!p.enabled
	if (p.label != null) next.label = String(p.label).trim().slice(0, 120) || cur.label
	if (p.channel != null) next.channel = Math.max(1, parseInt(String(p.channel), 10) || 1)
	if (p.device != null) next.device = String(p.device).trim()
	if (p.basenamePrefix != null) next.basenamePrefix = String(p.basenamePrefix).trim()
	if (p.mode != null) next.mode = String(p.mode).trim()
	if (p.streamPort != null) next.streamPort = parseInt(String(p.streamPort), 10)
	if (p.fps != null) next.fps = p.fps
	if (p.width != null) next.width = parseInt(String(p.width), 10)
	if (p.height != null) next.height = parseInt(String(p.height), 10)
	if (p.resolutionScale != null) next.resolutionScale = String(p.resolutionScale)
	if (p.jpegQuality != null) next.jpegQuality = parseInt(String(p.jpegQuality), 10)
	if (p.audioEnabled != null) next.audioEnabled = !!p.audioEnabled
	if (p.shaderCamera != null) next.shaderCamera = !!p.shaderCamera
	if (p.alsaLoopbackCardId != null) next.alsaLoopbackCardId = String(p.alsaLoopbackCardId).trim()
	if (p.alsaLoopbackIndex != null) next.alsaLoopbackIndex = parseInt(String(p.alsaLoopbackIndex), 10)
	if (p.alsaLoopbackPcm != null) next.alsaLoopbackPcm = parseInt(String(p.alsaLoopbackPcm), 10)
	if (p.showInDeviceView != null) next.showInDeviceView = !!p.showInDeviceView
	return normalizeVirtualCameraConfig(next)
}

module.exports = {
	VIRTUAL_CAMERA_DEFAULTS,
	normalizeVirtualCameraConfig,
	patchVirtualCameraConfig,
}
