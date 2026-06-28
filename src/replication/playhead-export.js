'use strict'

const { parseString } = require('xml2js')
const { getChannelMap } = require('../config/routing')
const liveSceneState = require('../state/live-scene-state')
const { getInfoXml2jsOptions, extractChannelInfoFromParsed } = require('../state/info-channel-parse')
const { isOscPlaybackActive, pickClipFromOscLayer } = require('../state/playback-tracker-osc')

/**
 * @param {string} xmlStr
 * @returns {Promise<{ framerate: string, layers: Record<string, { clip: string, state: string, timeSec: number, frame: number, fps: number }> }>}
 */
function parseChannelPlayheadXml(xmlStr) {
	return new Promise((resolve) => {
		if (!xmlStr || !xmlStr.includes('<')) {
			resolve({ framerate: '', layers: {} })
			return
		}
		parseString(xmlStr, getInfoXml2jsOptions(), (err, result) => {
			if (err || !result) {
				resolve({ framerate: '', layers: {} })
				return
			}
			try {
				resolve(layerRecordFromParsedInfo(extractChannelInfoFromParsed(result)))
			} catch {
				resolve({ framerate: '', layers: {} })
			}
		})
	})
}

/**
 * @param {{ framerate: string, layers: Array<object|undefined> }} parsed
 */
function layerRecordFromParsedInfo(parsed) {
	const framerate = parsed.framerate
	const fps = parseInt(framerate, 10) || 25
	/** @type {Record<string, { clip: string, state: string, timeSec: number, frame: number, fps: number }>} */
	const layers = {}
	for (let layerIdx = 0; layerIdx < parsed.layers.length; layerIdx++) {
		const entry = parsed.layers[layerIdx]
		if (!entry?.fgClip) continue
		const timeSec = parseFloat(entry.timeSec)
		if (!Number.isFinite(timeSec)) continue
		layers[String(layerIdx)] = {
			clip: String(entry.fgClip),
			state: String(entry.fgState || 'empty'),
			timeSec,
			frame: Math.max(0, Math.round(timeSec * fps)),
			fps,
		}
	}
	return { framerate: String(framerate || fps), layers }
}

/**
 * @param {number} pgmCh
 * @param {object} ctx
 * @returns {{ framerate: string, layers: Record<string, object> } | null}
 */
function exportLayersFromOsc(ctx, pgmCh) {
	if (!isOscPlaybackActive(ctx) || typeof ctx.oscState?.getSnapshot !== 'function') return null
	const snap = ctx.oscState.getSnapshot()
	const channels = (snap && snap.channels) || {}
	const chan = channels[pgmCh] ?? channels[String(pgmCh)]
	if (!chan || typeof chan !== 'object') return null

	const fps = parseInt(chan.framerate, 10) || 50
	/** @type {Record<string, { clip: string, state: string, timeSec: number, frame: number, fps: number }>} */
	const layers = {}
	for (const [layerId, layer] of Object.entries(chan.layers || {})) {
		if (!layer || typeof layer !== 'object') continue
		if (String(layer.type || '') === 'empty') continue
		const clip = pickClipFromOscLayer(layer)
		if (!clip) continue
		const f = layer.file || {}
		let timeSec = Number.isFinite(f.elapsed) ? f.elapsed : NaN
		if (!Number.isFinite(timeSec) && Number.isFinite(f.frameElapsed)) {
			const fileFps = Number.isFinite(f.fps) && f.fps > 0 ? f.fps : fps
			timeSec = f.frameElapsed / fileFps
		}
		if (!Number.isFinite(timeSec) || timeSec < 0) continue
		const state = layer.paused === true ? 'paused' : 'playing'
		layers[String(layerId)] = {
			clip,
			state,
			timeSec,
			frame: Math.max(0, Math.round(timeSec * fps)),
			fps,
		}
	}
	if (Object.keys(layers).length === 0) return null
	return { framerate: String(fps), layers }
}

/**
 * @param {number} pgmCh
 * @param {object} ctx
 * @returns {{ framerate: string, layers: Record<string, object> } | null}
 */
function exportLayersFromState(ctx, pgmCh) {
	const st = ctx.state?.getState?.()
	if (!st?.channels) return null
	const ch = st.channels.find((c) => c.id === pgmCh)
	if (!ch?.layers) return null
	const fps = parseInt(ch.framerate, 10) || 50
	/** @type {Record<string, { clip: string, state: string, timeSec: number, frame: number, fps: number }>} */
	const layers = {}
	for (let layerIdx = 0; layerIdx < ch.layers.length; layerIdx++) {
		const entry = ch.layers[layerIdx]
		if (!entry?.fgClip) continue
		const timeSec = parseFloat(entry.timeSec)
		if (!Number.isFinite(timeSec)) continue
		layers[String(layerIdx)] = {
			clip: String(entry.fgClip),
			state: String(entry.fgState || 'playing'),
			timeSec,
			frame: Math.max(0, Math.round(timeSec * fps)),
			fps,
		}
	}
	if (Object.keys(layers).length === 0) return null
	return { framerate: String(ch.framerate || fps), layers }
}

/**
 * Sample playhead for all live program channels from OSC / in-memory state only (no AMCP INFO poll).
 * @param {object} ctx
 * @returns {Promise<{ at: number, channels: Record<string, { sceneId: string, framerate: string, layers: Record<string, object> }> }>}
 */
async function exportProgramPlayheads(ctx) {
	const at = Date.now()
	/** @type {Record<string, { sceneId: string, framerate: string, layers: Record<string, object> }>} */
	const channels = {}
	if (!ctx) return { at, channels }

	const map = getChannelMap(ctx.config || {})
	const live = liveSceneState.getAll()

	for (let screenIdx = 1; screenIdx <= map.screenCount; screenIdx++) {
		const pgmCh = map.programCh(screenIdx)
		const entry = live[String(pgmCh)]
		if (!entry?.sceneId) continue

		let parsed = exportLayersFromOsc(ctx, pgmCh)
		if (!parsed) parsed = exportLayersFromState(ctx, pgmCh)
		if (!parsed) {
			const xml = ctx.gatheredInfo?.channelXml?.[String(pgmCh)]
			if (xml) parsed = await parseChannelPlayheadXml(xml)
		}
		if (!parsed || Object.keys(parsed.layers).length === 0) continue

		channels[String(pgmCh)] = {
			sceneId: String(entry.sceneId),
			framerate: parsed.framerate,
			layers: parsed.layers,
		}
	}

	return { at, channels }
}

module.exports = {
	exportProgramPlayheads,
	parseChannelPlayheadXml,
	exportLayersFromOsc,
	exportLayersFromState,
}
