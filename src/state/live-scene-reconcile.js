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
				// Old lineage: some builds emitted `<producer name="Clip">ffmpeg</producer>` (name
				// as an XML attribute). Caspar 2.6-dev's `<producer>` is a plain string (producer
				// *type*, e.g. "ffmpeg"/"html"/"empty" — core/producer/layer.cpp:133
				// `state_["foreground"]["producer"] = foreground_->name()`), so `p.$`/`p.name` are
				// both undefined here and this branch is a harmless no-op on the new binary; the
				// `fg.file` block below is what actually resolves the clip identity there.
				const p = fg.producer[0]
				fgClip = p.$ && p.$.name ? p.$.name : p.name && p.name[0] ? p.name[0] : ''
			}
			if (fg && fg.file && fg.file[0]) {
				const f = fg.file[0]
				if (f.$ && f.$.name) {
					// Old lineage: `<file name="Clip">` attribute.
					fgClip = f.$.name
				} else if (f.name && f.name[0]) {
					// WO-235: Caspar 2.6-dev `<file><name>Clip</name>...</file>` — canonical clip id
					// (av_producer.cpp:764 `state_["file/name"] = u8(name_)`). Must be checked before
					// the `<clip>` fallback below: the new binary repurposes `<clip>` as a numeric
					// [start_sec, duration_sec] pair (av_producer.cpp:989), not a name.
					fgClip = String(f.name[0])
				} else if (Array.isArray(f.clip) && f.clip.length) {
					// Old lineage: `<file><clip>ClipName</clip></file>` — single string clip name.
					// Guard against the new [start_sec, duration_sec] numeric-pair shape so we never
					// mistake a duration ("5.04") for a clip name and wrongly clear a persisted look.
					const looksLikeNumericPair = f.clip.length >= 2 && f.clip.every((v) => Number.isFinite(Number(v)))
					if (!looksLikeNumericPair) fgClip = String(f.clip[0])
				}
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

/**
 * Layer index string -> foreground producer *type* ('' when the layer has no foreground
 * producer). Caspar 2.6-dev emits the type as element text ("ffmpeg"/"html"/"empty" —
 * core/producer/layer.cpp:133); old lineage put the clip in a `name` attribute, so any
 * producer node with attributes still counts as loaded ('unknown').
 * @returns {Record<string, string>}
 */
async function parseLayerFgProducerTypesFromChannelXml(xmlStr) {
	const out = {}
	if (!xmlStr || typeof xmlStr !== 'string') return out
	const result = await parseXml(xmlStr)
	const stage = result.channel && result.channel.stage && result.channel.stage[0]
	const layers = stage && stage.layer && stage.layer[0]
	if (!layers || typeof layers !== 'object') return out
	for (const key of Object.keys(layers)) {
		if (!key.startsWith('layer_') || !Array.isArray(layers[key]) || !layers[key][0]) continue
		const layerIdx = key.replace('layer_', '')
		const fg = layers[key][0].foreground && layers[key][0].foreground[0]
		const p = fg && fg.producer && fg.producer[0]
		let type = ''
		if (typeof p === 'string') type = p.trim().toLowerCase()
		else if (p && typeof p === 'object') {
			if (typeof p._ === 'string' && p._.trim()) type = p._.trim().toLowerCase()
			else if (p.$ && p.$.name) type = 'unknown'
		}
		out[layerIdx] = type
	}
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
						'debug',
						`Live scene reconcile: channel ${ch} layer ${k} on Caspar but not in persisted look (likely stale bank slot); keeping persisted live JSON.`,
					)
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
	parseLayerFgProducerTypesFromChannelXml,
	reconcileLiveSceneFromGatheredXml,
	reconcileAfterInfoGather,
}
