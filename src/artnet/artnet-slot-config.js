'use strict'

const { PATCH_CHANNEL_COUNT } = require('./artnet-constants')

function artnetScreenIndex(dmx = {}) {
	const idx = parseInt(String(dmx.artnetInputScreenIndex ?? 0), 10)
	return Number.isFinite(idx) && idx >= 0 && idx <= 3 ? idx : 0
}

function slotListenEnabled(slot) {
	if (!slot || typeof slot !== 'object') return false
	const raw = slot.artnetListenEnabled ?? slot.params?.artnetListenEnabled
	if (raw === undefined || raw === null) return false
	if (raw === false || raw === 0 || raw === 'false' || raw === '0') return false
	return true
}

function slotLightingProtocol(slot) {
	if (!slot || typeof slot !== 'object') return 'artnet'
	const raw = slot.lightingProtocol ?? slot.params?.lightingProtocol
	if (raw === 'sacn') return 'sacn'
	return 'artnet'
}

function normalizeChannelMap(slot, channelCount = PATCH_CHANNEL_COUNT) {
	const raw = slot?.artnetChannelMap
	if (!Array.isArray(raw)) return Array(channelCount).fill(true)
	const out = []
	for (let i = 0; i < channelCount; i++) {
		out.push(raw[i] !== false)
	}
	return out
}

function runtimeParamsFromSlot(slot) {
	if (!slot) {
		return { side: 'inside', opacity: 1, type: 'border', enabled: false }
	}
	const p = slot.params && typeof slot.params === 'object' ? slot.params : {}
	return {
		side: 'inside',
		enabled: slot.enabled !== false,
		type: slot.type || 'border',
		opacity: p.opacity != null ? Number(p.opacity) : 1,
		color: p.color != null ? String(p.color) : '#e63946',
		width: p.width != null ? Number(p.width) : 4,
		intensity: p.intensity != null ? Number(p.intensity) : p.width != null ? Number(p.width) : 15,
		speed: p.speed != null ? Number(p.speed) : 0.1,
		pulseSpeed: p.pulseSpeed != null ? Number(p.pulseSpeed) : 2,
		spread: p.spread != null ? Number(p.spread) : 0,
		blur: p.blur != null ? Number(p.blur) : 0,
		glowColor: p.glowColor != null ? String(p.glowColor) : '#000000',
		radius: p.radius != null ? Number(p.radius) : 0,
		count: p.count != null ? Number(p.count) : 1,
		length: p.length != null ? Number(p.length) : 5,
		segmentMode: p.segmentMode || p.segmentationMode || 'full',
		segmentationMode: p.segmentationMode || p.segmentMode || 'full',
		segmentsPerEdge: p.segmentsPerEdge != null ? Number(p.segmentsPerEdge) : 1,
		segmentEase: p.segmentEase != null ? Number(p.segmentEase) : 0,
		segmentation: p.segmentation != null ? Number(p.segmentation) : 0,
	}
}

function resolveArtnetPatch(appCtx, dmxOverride = null, projectScenesCache = null) {
	const dmx = dmxOverride || appCtx.config?.dmx || {}
	const screenIdx = artnetScreenIndex(dmx)
	const scenes = loadProjectScenesForLookup(appCtx, projectScenesCache)
	const slot = globalBorderSlotFromScenes(scenes, screenIdx)
	const patch = slot?.artnetPatch && typeof slot.artnetPatch === 'object' ? slot.artnetPatch : {}

	const cfgUniverse = parseInt(String(dmx.artnetInputUniverse ?? ''), 10)
	const cfgStart = parseInt(String(dmx.artnetInputStartChannel ?? ''), 10)

	return {
		net: Number.isFinite(parseInt(patch.net, 10)) ? parseInt(patch.net, 10) : (dmx.artnetInputNet ?? 0),
		subnet: Number.isFinite(parseInt(patch.subnet, 10))
			? parseInt(patch.subnet, 10)
			: (dmx.artnetInputSubnet ?? 0),
		universe: Number.isFinite(cfgUniverse)
			? cfgUniverse
			: Number.isFinite(parseInt(patch.universe, 10))
				? parseInt(patch.universe, 10)
				: 0,
		startChannel: Number.isFinite(cfgStart)
			? cfgStart
			: Number.isFinite(parseInt(patch.startChannel, 10))
				? parseInt(patch.startChannel, 10)
				: 1,
		screenIndex: screenIdx,
	}
}

function loadProjectScenesFromDisk() {
	try {
		const { loadProjectScenes } = require('../engine/project-scenes')
		return loadProjectScenes()
	} catch (_) {
		return null
	}
}

function loadProjectScenesForLookup(appCtx, projectScenesCache) {
	if (projectScenesCache && typeof projectScenesCache === 'object') {
		return projectScenesCache
	}
	return loadProjectScenesFromDisk()
}

function globalBorderSlotFromScenes(scenes, screenIdx) {
	if (!scenes || !Array.isArray(scenes.globalBorders)) return null
	const gb = scenes.globalBorders[screenIdx]
	return gb && typeof gb === 'object' ? gb : null
}

function resolveProgramChannel(appCtx, screenIdx) {
	try {
		const { getChannelMap } = require('../config/routing')
		const cm = getChannelMap(appCtx.config || {}, appCtx.switcherOutputBusByChannel)
		const ch = cm?.programChannels?.[screenIdx] ?? cm?.programChannels?.[0]
		if (Number.isFinite(ch) && ch >= 1) return ch
	} catch (_) {}
	return 1
}

module.exports = {
	artnetScreenIndex,
	slotListenEnabled,
	slotLightingProtocol,
	normalizeChannelMap,
	runtimeParamsFromSlot,
	resolveArtnetPatch,
	loadProjectScenesFromDisk,
	loadProjectScenesForLookup,
	globalBorderSlotFromScenes,
	resolveProgramChannel,
}
