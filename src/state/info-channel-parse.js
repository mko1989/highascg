/**
 * AMCP INFO channel XML → framerate + per-layer playback fields.
 * Supports xml2js default (arrays everywhere) and `explicitArray: false` (PF-04 D fast mode).
 */
'use strict'

/** @returns {object} xml2js builder options — empty = library default */
function getInfoXml2jsOptions() {
	const m = String(process.env.HIGHASCG_INFO_PARSE_MODE || 'full').toLowerCase()
	if (m === 'fast') return { explicitArray: false, trim: true }
	return {}
}

function _first(el) {
	if (el == null) return undefined
	return Array.isArray(el) ? el[0] : el
}

function _str(v) {
	if (v == null) return ''
	return Array.isArray(v) ? String(v[0] ?? '') : String(v)
}

/**
 * @param {*} result — xml2js callback result
 * @returns {{ framerate: string, layers: Array<{ fgClip?: string, fgState?: string, bgClip?: string, durationSec?: string, timeSec?: string, remainingSec?: string } | undefined> }}
 */
function extractChannelInfoFromParsed(result) {
	let framerate = ''
	/** @type {Record<number, { fgClip: string, fgState: string, bgClip: string, durationSec: string, timeSec: string, remainingSec: string }>} */
	const layers = []

	const chRoot = result && result.channel
	const channel = _first(chRoot)
	if (channel) {
		framerate = _str(channel.framerate)

		const stage = _first(channel.stage)
		if (stage) {
			const layerWrap = _first(stage.layer)
			const layerObj = layerWrap && typeof layerWrap === 'object' ? layerWrap : null
			if (layerObj) {
				Object.keys(layerObj).forEach((key) => {
					if (!key.startsWith('layer_')) return
					const layerIdx = parseInt(key.replace('layer_', ''), 10)
					if (!Number.isFinite(layerIdx)) return
					const lrBlocks = layerObj[key]
					const lr = _first(lrBlocks)
					if (!lr) return
					const fg = _first(lr.foreground)
					const bg = _first(lr.background)
					let fgClip = ''
					let fgState = 'empty'
					let bgClip = ''
					let nbFrames = 0
					let currentFrame = 0
					let fileElapsedSec = NaN
					if (fg) {
						const p = _first(fg.producer)
						if (p) {
							const pAttrs = p.$ || {}
							fgClip = pAttrs.name || _str(p.name)
							const paused = fg.paused
							fgState =
								(Array.isArray(paused) ? paused[0] : paused) === 'true' || paused === true ? 'paused' : 'playing'
							nbFrames = parseInt(_str(p['nb-frames']), 10) || 0
							currentFrame =
								parseInt(_str(p.frame), 10) ||
								parseInt(_str(p['frame-time']), 10) ||
								0
						}
						const file = _first(fg.file)
						if (file) {
							const fAttrs = file.$ || {}
							const fileName = _str(file.name) || fAttrs.name
							if (fileName) fgClip = fileName
							const filePath = _str(file.path)
							if (!fgClip && filePath) {
								const parts = filePath.split(/[/\\]/)
								fgClip = parts[parts.length - 1] || fgClip
							}

							const timeRaw = file.time
							/** @type {number[]} */
							const timeVals = []
							if (Array.isArray(timeRaw)) {
								for (const t of timeRaw) {
									const n = parseFloat(_str(t))
									if (Number.isFinite(n)) timeVals.push(n)
								}
							} else if (timeRaw != null) {
								const n = parseFloat(_str(timeRaw))
								if (Number.isFinite(n)) timeVals.push(n)
							}
							if (timeVals.length > 0) fileElapsedSec = timeVals[0]
							const durSec =
								timeVals.length >= 2 && Number.isFinite(timeVals[1]) && timeVals[1] > 0
									? timeVals[1]
									: NaN

							const fpsNum = parseInt(framerate, 10) || 1
							if (Number.isFinite(fileElapsedSec) && fileElapsedSec >= 0) {
								currentFrame = Math.round(fileElapsedSec * fpsNum)
							}
							if (Number.isFinite(durSec) && durSec > 0) {
								nbFrames = Math.round(durSec * fpsNum)
							} else {
								const clipRaw = file.clip
								const clipSecond = Array.isArray(clipRaw)
									? clipRaw[1]
									: clipRaw && typeof clipRaw === 'object'
										? clipRaw._
										: undefined
								if (clipSecond != null && String(clipSecond).length && nbFrames <= 0) {
									nbFrames = Math.floor(parseFloat(String(clipSecond)) * fpsNum)
								}
							}
						}
					}
					if (bg) {
						const bp = _first(bg.producer)
						if (bp) {
							const bAttr = bp.$ || {}
							bgClip = bAttr.name || _str(bp.name)
						}
					}
					const fpsNum = parseInt(framerate, 10) || 1
					const durationSec =
						nbFrames > 0 ? (nbFrames / fpsNum).toFixed(2) : Number.isFinite(fileElapsedSec) ? String(fileElapsedSec) : ''
					const timeSec =
						Number.isFinite(fileElapsedSec) && fileElapsedSec >= 0
							? fileElapsedSec.toFixed(2)
							: nbFrames > 0 && currentFrame >= 0
								? (currentFrame / fpsNum).toFixed(2)
								: ''
					const remainingSec = nbFrames > 0 && currentFrame >= 0 ? ((nbFrames - currentFrame) / fpsNum).toFixed(2) : ''
					layers[layerIdx] = { fgClip, fgState, bgClip, durationSec, timeSec, remainingSec }
				})
			}
		}
	}

	/** Single-layer INFO shape (no `<channel>` wrapper depth) */
	const topLayer = result && result.layer
	const tl = _first(topLayer)
	if (tl) {
		const fg = _first(tl.foreground)
		if (fg) {
			const p = _first(fg.producer)
			if (p) {
				const fr = _str(p.fps)
				const fpsNum = parseInt(fr, 10) || 1
				const nb = parseInt(_str(p['nb-frames']), 10) || 0
				const cur = parseInt(_str(p.frame), 10) || 0
				const pAttrs = p.$ || {}
				const fgClip = pAttrs.name || _str(p.name)
				const paused = fg.paused
				const fgState =
					(Array.isArray(paused) ? paused[0] : paused) === 'true' || paused === true ? 'paused' : 'playing'
				layers[0] = {
					fgClip,
					fgState,
					bgClip: '',
					durationSec: nb > 0 ? (nb / fpsNum).toFixed(2) : '',
					timeSec: nb > 0 && cur >= 0 ? (cur / fpsNum).toFixed(2) : '',
					remainingSec: nb > 0 && cur >= 0 ? ((nb - cur) / fpsNum).toFixed(2) : '',
					/** Strip before persisting / WS; used only for Companion variables on this INFO shape */
					fgFps: fr,
				}
			}
		}
	}

	return { framerate, layers }
}

module.exports = {
	getInfoXml2jsOptions,
	extractChannelInfoFromParsed,
}
