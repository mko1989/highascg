/**
 * WO-39: NVIDIA pool info + guarded apply; DeckLink host summary; allow-listed GUI launches on :0.
 * Implementation split across `system-hardware-*.js`.
 */

'use strict'

const { gpuNvidiaGet, handleGpuNvidiaApply } = require('./system-hardware-nvidia')
const { handleGpuLayoutGet } = require('./system-hardware-gpu-layout')
const { decklinkGet } = require('./system-hardware-decklink')
const { handleGuiLaunchPost } = require('./system-hardware-gui')
const { handleGpuPortsReset } = require('./system-hardware-gpu-ports')
const { handleXrandrLayoutGet, handleXrandrLayoutApplyPost } = require('./system-hardware-xrandr-layout')
const { handleIdentifyDisplaysPost } = require('./system-hardware-identify-displays')

/**
 * @param {string} p
 */
async function hardwareHandleGet(p, ctx) {
	if (p === '/api/system/gpu-nvidia') return gpuNvidiaGet()
	if (p === '/api/system/gpu-layout') return handleGpuLayoutGet()
	if (p === '/api/system/decklink') return decklinkGet()
	if (p === '/api/system/xrandr-layout') return handleXrandrLayoutGet(ctx)
	return null
}

/**
 * @param {string} p
 * @param {string} body
 * @param {*} ctx
 */
async function hardwareHandlePost(p, body, ctx) {
	if (p === '/api/system/gpu-nvidia/apply') return handleGpuNvidiaApply(body, ctx)
	if (p === '/api/system/gui-launch') return handleGuiLaunchPost(body, ctx)
	if (p === '/api/system/gpu-ports-reset') return handleGpuPortsReset()
	if (p === '/api/system/xrandr-layout/apply') return handleXrandrLayoutApplyPost(ctx)
	if (p === '/api/system/identify-displays') return handleIdentifyDisplaysPost(body, ctx)

	return null
}

module.exports = {
	hardwareHandleGet,
	hardwareHandlePost,
}
