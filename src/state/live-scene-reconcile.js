/**
 * Parse INFO channel XML, compare clip paths, reconcile persisted scene.live vs Caspar (see companion).
 */

'use strict'

const util = require('util')
const { parseString } = require('xml2js')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('./live-scene-state')
const { normalizeProgramLayerBank } = require('../engine/program-layer-bank')
const { isTimelineOnlyScene, physicalProgramLayer } = require('../engine/scene-transition')

const parseXml = util.promisify(parseString)

function layerHasContent(l) {
	return !!(l && l.source && l.source.value)
}

function normPath(s) {
	return String(s || '')
		.trim()
		.toLowerCase()
		.replace(/\\/g, '/')
}

/**
 * Caspar foreground name vs project path (basename or suffix match).
 */
function pathsMatch(expected, actualFg) {
	const e = normPath(expected)
	const a = normPath(actualFg)
	if (!e && !a) return true
	if (!e || !a) return false
	if (e === a) return true
	const baseE = e.split('/').pop() || e
	const baseA = a.split('/').pop() || a
	if (baseE && baseA && (baseE === baseA || a.includes(baseE) || e.includes(baseA))) return true
	return false
}

/**
 * @returns {Record<string, string>} layer index string -> foreground clip name
 */
async function parseLayerFgClipsFromChannelXml(xmlStr) {
	const out = {}
	if (!xmlStr || typeof xmlStr !== 'string') return out
	const result = await parseXml(xmlStr)
	let framerate = ''
	if (result.channel && result.channel.framerate && result.channel.framerate[0]) framerate = result.channel.framerate[0]
	if (result.channel && result.channel.stage && result.channel.stage[0] && result.channel.stage[0].layer && result.channel.stage[0].layer[0]) {
		const layers = result.channel.stage[0].layer[0]
		for (const key of Object.keys(layers)) {
			if (!key.startsWith('layer_') || !Array.isArray(layers[key]) || !layers[key][0]) continue
			const layerIdx = key.replace('layer_', '')
			const fg = layers[key][0].foreground && layers[key][0].foreground[0]
			let fgClip = ''
			if (fg && fg.producer && fg.producer[0]) {
				const p = fg.producer[0]
				fgClip = p.$ && p.$.name ? p.$.name : p.name && p.name[0] ? p.name[0] : ''
			}
			if (fg && fg.file && fg.file[0]) {
				const f = fg.file[0]
				fgClip = f.$ && f.$.name ? f.$.name : f.clip && f.clip[1] ? String(f.clip[1]) : fgClip
			}
			out[layerIdx] = fgClip || ''
		}
	}
	if (result.layer && result.layer.foreground && result.layer.foreground[0]) {
		const p = result.layer.foreground[0].producer && result.layer.foreground[0].producer[0]
		if (p) {
			const fgClip = p.$ && p.$.name ? p.$.name : p.name && p.name[0] ? p.name[0] : ''
			out['0'] = fgClip || ''
		}
	}
	void framerate
	return out
}

function shouldSkipSceneReconcile(scene) {
	if (isTimelineOnlyScene(scene)) return true
	for (const l of scene?.layers || []) {
		if (!layerHasContent(l)) continue
		const t = String(l.source?.type || '')
		if (t !== 'file' && t !== 'template' && t !== 'media') return true
	}
	return false
}

/**
 * Compare persisted scene.live to INFO XML in gatheredInfo.channelXml.
 * @param {object} self - app ctx (config, gatheredInfo, log, programLayerBankByChannel, _wsBroadcast)
 */
async function reconcileLiveSceneFromGatheredXml(self) {
	if (!self) return
	const liveAll = liveSceneState.getAll()
	if (!liveAll || Object.keys(liveAll).length === 0) return

	const map = getChannelMap(self.config || {})
	const programSet = new Set(map.programChannels || [])
	let anyCleared = false

	for (const chStr of Object.keys(liveAll)) {
		const ch = parseInt(chStr, 10)
		if (!Number.isFinite(ch) || ch < 1) continue
		if (!programSet.has(ch)) continue

		const entry = liveAll[chStr]
		const scene = entry?.scene
		if (!scene || !Array.isArray(scene.layers)) continue

		if (shouldSkipSceneReconcile(scene)) continue

		const xml = self.gatheredInfo?.channelXml?.[chStr]
		if (!xml || !String(xml).trim()) continue

		let fgByLayer
		try {
			fgByLayer = await parseLayerFgClipsFromChannelXml(xml)
		} catch (e) {
			self.log('debug', `Live scene reconcile: parse INFO XML ch ${ch}: ${e?.message || e}`)
			continue
		}

		const persistedWithContent = (scene.layers || []).filter(layerHasContent)
		const bank = normalizeProgramLayerBank(self.programLayerBankByChannel?.[chStr])
		const expectedPhysical = new Set(
			persistedWithContent.map((l) => String(physicalProgramLayer(l.layerNumber, bank)))
		)

		let cleared = false
		for (const layer of persistedWithContent) {
			const num = String(parseInt(layer.layerNumber, 10))
			const phys = String(physicalProgramLayer(layer.layerNumber, bank))
			const t = String(layer.source?.type || 'file')
			const val = layer.source?.value != null ? String(layer.source.value) : ''
			if (t !== 'file' && t !== 'template' && t !== 'media') continue
			const actual = fgByLayer[phys] != null ? String(fgByLayer[phys]) : ''
			if (!pathsMatch(val, actual)) {
				self.log(
					'info',
					`Live scene reconcile: channel ${ch} layer ${num} (physical ${phys}) mismatch (expected ${t} vs Caspar); clearing persisted live look.`
				)
				liveSceneState.clearChannel(ch)
				cleared = true
				break
			}
		}

		if (!cleared) {
			for (const k of Object.keys(fgByLayer)) {
				const clip = String(fgByLayer[k] || '').trim()
				if (!clip) continue
				if (!expectedPhysical.has(k)) {
					self.log(
						'info',
						`Live scene reconcile: channel ${ch} layer ${k} has output in Caspar but not in persisted look; clearing.`
					)
					liveSceneState.clearChannel(ch)
					cleared = true
					break
				}
			}
		}

		if (cleared) anyCleared = true
	}

	if (anyCleared) liveSceneState.broadcastSceneLive(self)
}

/**
 * One-shot after connect when reconcile_live_on_connect is not false.
 */
async function reconcileAfterInfoGather(self) {
	if (!self || self.config?.reconcile_live_on_connect === false) return
	await reconcileLiveSceneFromGatheredXml(self)
}

module.exports = {
	pathsMatch,
	normPath,
	parseLayerFgClipsFromChannelXml,
	reconcileLiveSceneFromGatheredXml,
	reconcileAfterInfoGather,
}
