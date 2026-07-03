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
const { operatorDisplayGet } = require('./system-hardware-operator-display')
const {
	handleNetworkGet,
	handleNetworkApplyPost,
	handleNetworkResetPost,
	handleNetworkRefreshSplashIpPost,
} = require('./system-hardware-network')

/**
 * @param {string} p
 */
async function hardwareHandleGet(p, ctx) {
	if (p === '/api/system/gpu-nvidia') return gpuNvidiaGet()
	if (p === '/api/system/gpu-layout') return handleGpuLayoutGet()
	if (p === '/api/system/decklink') return decklinkGet()
	if (p === '/api/system/xrandr-layout') return handleXrandrLayoutGet(ctx)
	if (p === '/api/system/network') return handleNetworkGet(ctx)
	if (p === '/api/system/operator-display') return operatorDisplayGet(ctx)
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
	if (p === '/api/system/pointer-confine') {
		const { handlePointerConfinePost } = require('./system-hardware-gui')
		return handlePointerConfinePost(body, ctx)
	}
	if (p === '/api/system/gpu-ports-reset') return handleGpuPortsReset(body, ctx)
	if (p === '/api/system/xrandr-layout/apply') return handleXrandrLayoutApplyPost(ctx)
	if (p === '/api/system/identify-displays') return handleIdentifyDisplaysPost(body, ctx)
	if (p === '/api/system/network/apply') return handleNetworkApplyPost(body, ctx)
	if (p === '/api/system/network/reset') return handleNetworkResetPost(body, ctx)
	if (p === '/api/system/network/refresh-splash-ip') return handleNetworkRefreshSplashIpPost(body, ctx)

	return null
}

module.exports = {
	hardwareHandleGet,
	hardwareHandlePost,
}
