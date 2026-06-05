'use strict'

const { GLOBAL_BORDER_LAYER } = require('./artnet-constants')
const { globalBorderSlotFromScenes, loadProjectScenesFromDisk } = require('./artnet-slot-config')

function broadcastGlobalBorderToClient(appCtx, channel, targetScreenIndex, params, type) {
	if (!appCtx?._wsBroadcast) return

	const scenes = loadProjectScenesFromDisk()
	const slot = globalBorderSlotFromScenes(scenes, targetScreenIndex)
	const slotSlices = Array.isArray(slot?.slices) ? slot.slices : []
	const { enabled, type: _t, ...paramRest } = params
	const runtimeBorder = {
		enabled: enabled !== false,
		type: type || params.type || 'border',
		params: { ...paramRest },
		fadeDuration: slot?.fadeDuration ?? 25,
		slices: slotSlices,
	}

	appCtx._wsBroadcast('global_border_sync', { screenIndex: targetScreenIndex, border: runtimeBorder })

	try {
		const liveSceneState = require('../state/live-scene-state')
		const live = liveSceneState.getChannel(channel)
		if (live?.scene) {
			if (!live.scene.globalBorder) {
				live.scene.globalBorder = {
					...runtimeBorder,
					borderPresets: [],
				}
			} else {
				const gb = live.scene.globalBorder
				gb.enabled = runtimeBorder.enabled
				gb.type = runtimeBorder.type
				gb.params = { ...runtimeBorder.params }
				if (Array.isArray(runtimeBorder.slices)) gb.slices = runtimeBorder.slices
			}
			liveSceneState.setChannel(channel, live)
		}
	} catch (_) {}
}

function sendCasparBorderAdd(appCtx, log, channel, overlay) {
	const amcp = appCtx.amcp
	if (!amcp?.isConnected) {
		log('warn', '[ArtNet] Cannot load border, AMCP not connected')
		return
	}

	const layer = GLOBAL_BORDER_LAYER
	const { buildGlobalBorderAmcpLines } = require('../engine/global-border')
	const { markCasparBorderType } = require('../engine/global-border-live')
	const lines = buildGlobalBorderAmcpLines(channel, layer, overlay, appCtx, {
		initialOpacity: 1,
		updateDuration: 1,
	})
	markCasparBorderType(channel, overlay.type)

	for (const line of lines) {
		amcp.raw(line).catch((e) => {
			log('error', `[ArtNet] Failed to send AMCP: ${e.message}`)
		})
	}
	if (lines.some((l) => /\bDEFER\b/i.test(String(l)))) {
		void amcp.mixerCommit(channel).catch((e) => {
			log('error', `[ArtNet] MIXER COMMIT failed: ${e.message}`)
		})
	}
}

function flushCasparBorder(pending, appCtx, log) {
	if (!pending) return
	const overlay = {
		type: pending.type || pending.params.type || 'border',
		params: pending.params,
		slices: pending.slices,
	}
	const { writeGlobalBorderLiveFile } = require('../engine/global-border-live')
	writeGlobalBorderLiveFile(pending.channel, overlay, log)
	if (pending.forceAdd) {
		sendCasparBorderAdd(appCtx, log, pending.channel, overlay)
	}
}

module.exports = {
	broadcastGlobalBorderToClient,
	sendCasparBorderAdd,
	flushCasparBorder,
}
