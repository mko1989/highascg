'use strict'

const { PATCH_CHANNEL_COUNT } = require('./artnet-constants')
const { slotListenEnabled, normalizeChannelMap } = require('./artnet-slot-config')

function applyPatch(receiver, patch, source = 'config') {
	const net = Math.max(0, Math.min(127, parseInt(patch?.net, 10) || 0))
	const subnet = Math.max(0, Math.min(15, parseInt(patch?.subnet, 10) || 0))
	const universe = Math.max(0, Math.min(15, parseInt(patch?.universe, 10) || 0))
	const startChannel = Math.max(1, Math.min(512, parseInt(patch?.startChannel, 10) || 1))
	const subuni = (subnet << 4) | (universe & 0x0f)
	const portKey = (subuni << 8) | (net & 0xff)

	const changed =
		net !== receiver._inputNet ||
		subnet !== receiver._inputSubnet ||
		universe !== receiver._inputUniverse ||
		startChannel !== receiver._startChannel

	receiver._inputNet = net
	receiver._inputSubnet = subnet
	receiver._inputUniverse = universe
	receiver._startChannel = startChannel
	receiver._portKey = portKey
	receiver._targetScreenIndex = patch.screenIndex ?? receiver._artnetScreenIndex()

	if (changed) {
		receiver.lastData = null
		receiver._lastAppliedKey = null
		receiver.log(
			'info',
			`[ArtNet] Patch (${source}): net=${net} subnet=${subnet} universe=${universe} startCh=${startChannel} (port key=0x${portKey.toString(16)})`,
		)
	}
	return changed
}

function logListenState(receiver, screenIdx, slot, source) {
	const master = receiver._isMasterDmxEnabled()
	const slotListen = slot ? slotListenEnabled(slot) : false
	const raw = slot?.artnetListenEnabled
	if (receiver._effectiveListen()) {
		receiver.log(
			'info',
			`[ArtNet] Screen ${screenIdx + 1} listen on (${source}) master=${master} slot.artnetListenEnabled=${JSON.stringify(raw)} effective=true`,
		)
	} else {
		receiver.log(
			'info',
			`[ArtNet] Screen ${screenIdx + 1} listen off (${source}) master=${master} ` +
				`targetConfigured=${receiver._targetConfigured} slotPresent=${!!slot} ` +
				`slot.artnetListenEnabled=${JSON.stringify(raw)} slotListen=${slotListen}`,
		)
	}
}

function getInputStatus(receiver) {
	const patch = receiver._resolveArtnetPatch()
	const screenIdx = patch.screenIndex ?? 0
	const slot = receiver._globalBorderSlot(screenIdx)
	const masterDmxEnabled = receiver._isMasterDmxEnabled()
	const artnetListenEnabled = slot ? slotListenEnabled(slot) : false
	const artnetChannelMap = slot ? normalizeChannelMap(slot) : Array(PATCH_CHANNEL_COUNT).fill(true)
	const effectiveListen =
		masterDmxEnabled && !!slot && artnetListenEnabled && receiver._targetConfigured
	return {
		listening: !!receiver._socket,
		targetConfigured: receiver._targetConfigured,
		screenIndex: screenIdx,
		screenLabel: `main ${screenIdx + 1}`,
		programChannel: receiver._resolveProgramChannel(),
		globalBorderSlotPresent: !!slot,
		globalBorderEnabled: !!(slot && slot.enabled),
		masterDmxEnabled,
		artnetListenEnabled,
		slotArtnetListenRaw: slot?.artnetListenEnabled ?? null,
		runtimeArtnetListenEnabled: receiver._artnetListenEnabled,
		artnetChannelMap,
		effectiveListen,
		patch: {
			net: receiver._inputNet,
			subnet: receiver._inputSubnet,
			universe: receiver._inputUniverse,
			startChannel: receiver._startChannel,
			portKeyHex: `0x${receiver._portKey.toString(16)}`,
		},
		resolvedFrom: {
			artnetPatch: slot?.artnetPatch || null,
			configOverrideUniverse: Number.isFinite(parseInt(String(receiver.appCtx.config?.dmx?.artnetInputUniverse ?? ''), 10)),
		},
		logIntervalMs: receiver._logIntervalMs,
		wsBroadcastIntervalMs: receiver._wsBroadcastIntervalMs,
		statsLogIntervalMs: receiver._statsLogIntervalMs,
		rxStats: { ...receiver._stats },
	}
}

module.exports = {
	applyPatch,
	logListenState,
	getInputStatus,
}
