/**
 * Shared scenes editor helpers — AMCP snippets, transition row UI, take payload.
 */

import { TRANSITION_TYPES, TRANSITION_TWEENS, TRANSITION_TYPE_LABELS, migrateTransitionTypeToAnimate, PGM_ONLY_TRANSITION_TYPES, normalizeTransitionForPgmOnly } from '../lib/program-output-state.js'
import { linearGainToCasparDb } from '../lib/audio-volume-scale.js'
import { parseNumberInput } from '../lib/math-input.js'
import { sceneState } from '../lib/scene-state.js'
import { getPipOverlaysFromLayer } from '../lib/pip-overlay-registry.js'
import {
	getLiveLayerPlayheadFrames,
	playSeekFramesForRelativeToPrevious,
} from '../lib/layer-playhead-resolve.js'
import { isLowerThirdSource, resolveLayerLowerThirdCgData, resolveLayerLowerThirdConfig, buildLowerThirdCasparCgData } from '../lib/lower-third-cg-data.js'

export function amcpParam(str) {
	if (str == null || str === '') return ''
	const s = String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
	return /\s/.test(s) ? `"${s}"` : s
}

export function chLayerAmcp(ch, ln) {
	return `${Number(ch)}-${Number(ln)}`
}

export function isMediaOrFileSource(src) {
	if (src?.isPlaceholder || src?.type === 'placeholder') return false
	const t = (src?.type || '').toLowerCase()
	return (t === 'media' || t === 'file') && !!src?.value
}

/** Layer strip / compose / deck: payloads that can become (or replace) a scene layer source. */
function isDraggableLayerSourcePayload(data) {
	if (!data || !data.value) return false
	const ty = String(data.type || 'media').toLowerCase()
	if (ty === 'effect') return false
	return true
}

/**
 * Parse Sources-panel style drag data (`application/json`, `text/plain`, or `multi`).
 * @param {DataTransfer} dt
 * @returns {object[]}
 */
export function parseDraggableSourcesPayload(dt) {
	if (!dt) return []
	let data
	try {
		data = JSON.parse(dt.getData('application/json') || '')
	} catch {
		const val = dt.getData('text/plain')
		if (val) data = { type: 'media', value: val.trim(), label: val.trim() }
	}
	if (!data) return []
	if (data.type === 'multi' && Array.isArray(data.items)) {
		return data.items.filter(isDraggableLayerSourcePayload)
	}
	return isDraggableLayerSourcePayload(data) ? [data] : []
}

/**
 * Whether the deck may show a drop highlight (files from OS, or Sources JSON / plain path).
 * Excludes internal connector drags that should stay in Sources / Live.
 * @param {DataTransfer} dt
 */
export function dataTransferOffersDeckMedia(dt) {
	if (!dt?.types) return false
	const types = [...dt.types]
	if (types.includes('application/x-highascg-connector')) return false
	if (types.includes('Files')) return true
	if (types.includes('application/json')) return true
	if (types.includes('text/plain')) return true
	return false
}

/**
 * @param {HTMLElement} mount
 * @param {{ type?: string, duration?: number, tween?: string }} dt
 * @param {(t: { type: string, duration: number, tween: string }) => void} onChange
 * @param {string} idPrefix
 * @param {{ label?: string, hint?: string, pgmOnly?: boolean, allowedTypes?: string[] }} [opts]
 */
export function mountLookTransitionControls(mount, dt, onChange, idPrefix, opts = {}) {
	const label = opts.label ?? 'Look transition'
	const hint = opts.hint ?? ''
	const pgmOnly = opts.pgmOnly === true
	const allowedTypes = opts.allowedTypes || (pgmOnly ? PGM_ONLY_TRANSITION_TYPES : TRANSITION_TYPES)
	const transitionRow = document.createElement('div')
	transitionRow.className = 'scenes-look-transition'
	transitionRow.innerHTML = `
		<select id="${idPrefix}-type" class="scenes-look-transition__select" aria-label="Transition type"></select>
		<input type="text" id="${idPrefix}-dur" class="scenes-look-transition__num inspector-math-input" inputmode="decimal" placeholder="Dur" title="Duration in frames" style="width: 40px;" />
		<select id="${idPrefix}-tween" class="scenes-look-transition__select" aria-label="Easing"></select>
	`
	const labelEl = transitionRow.querySelector('.scenes-look-transition__label')
	if (labelEl) labelEl.textContent = label
	if (hint) {
		const h = document.createElement('span')
		h.className = 'scenes-look-transition__hint'
		h.textContent = hint
		transitionRow.appendChild(h)
	}
	const typeSel = transitionRow.querySelector(`#${idPrefix}-type`)
	for (const t of allowedTypes) {
		const o = document.createElement('option')
		o.value = t
		o.textContent = TRANSITION_TYPE_LABELS[t] || t
		typeSel.appendChild(o)
	}
	const d = pgmOnly ? normalizeTransitionForPgmOnly(dt) : dt || {}
	const typeNorm = migrateTransitionTypeToAnimate(d.type)
	const typeValue = typeNorm && allowedTypes.includes(typeNorm) ? typeNorm : 'CUT'
	typeSel.value = typeValue
	const durIn = transitionRow.querySelector(`#${idPrefix}-dur`)
	durIn.value = String(Math.max(0, Math.round(Number(d.duration) || 0)))
	const tweenSel = transitionRow.querySelector(`#${idPrefix}-tween`)
	for (const val of TRANSITION_TWEENS) {
		const o = document.createElement('option')
		o.value = val
		o.textContent = val
		tweenSel.appendChild(o)
	}
	const twRaw = String(d.tween || 'linear').toLowerCase().replace(/-/g, '_')
	const twNorm = twRaw === 'ease_in_out' || twRaw === 'easeinout' ? 'easeboth' : twRaw
	tweenSel.value = TRANSITION_TWEENS.includes(twNorm) ? twNorm : 'linear'

	function readAndSave() {
		const raw = {
			type: typeSel.value || 'CUT',
			duration: Math.max(0, Math.round(parseNumberInput(durIn.value, 0))),
			tween: tweenSel.value || 'linear',
		}
		const next = pgmOnly ? normalizeTransitionForPgmOnly(raw) : {
			type: migrateTransitionTypeToAnimate(raw.type),
			duration: raw.duration,
			tween: raw.tween,
		}
		if (pgmOnly && typeSel.value !== next.type) {
			typeSel.value = next.type
			durIn.value = String(next.duration)
		}
		onChange(next)
	}
	typeSel.addEventListener('change', readAndSave)
	durIn.addEventListener('change', readAndSave)
	tweenSel.addEventListener('change', readAndSave)
	mount.appendChild(transitionRow)
}

/**
 * Timeline clip active on a layer at playhead `ms` (exclusive end).
 * @param {{ clips?: object[] } | null | undefined} layer
 * @param {number} ms
 */
export function clipAtTimelineMs(layer, ms) {
	if (!layer?.clips?.length) return null
	for (const c of layer.clips) {
		const st = c.startTime || 0
		const dur = c.duration || 0
		if (ms >= st && ms < st + dur) return c
	}
	return null
}

/**
 * @param {'beginning' | 'relativeToPrevious' | undefined} sceneLayerBehaviour
 * @param {'beginning' | 'relativeToPrevious' | undefined} clipStartBehaviour
 */
function effectiveStartBehaviour(sceneLayerBehaviour, clipStartBehaviour) {
	if (sceneLayerBehaviour === 'beginning' || sceneLayerBehaviour === 'relativeToPrevious') {
		return sceneLayerBehaviour
	}
	return clipStartBehaviour === 'relativeToPrevious' ? 'relativeToPrevious' : 'beginning'
}

/**
 * @param {object} clip
 * @param {object} timeline
 * @param {number} positionMs
 * @param {'beginning' | 'relativeToPrevious'} startBehaviour
 * @param {{ programChannel?: number, layerNumber?: number, fps?: number, mainIdx?: number, stateStore?: object, variableStore?: object, oscClient?: object } | null} [playheadCtx]
 * @returns {number | null}
 */
export function playSeekFramesFromClip(clip, timeline, positionMs, startBehaviour, playheadCtx) {
	const src = String(clip.source?.value || '')
	if (src.startsWith('route://')) return null
	const fps = Math.max(1, timeline.fps || 25)
	const inFrames = Number(clip.inPoint) || 0
	if (startBehaviour === 'relativeToPrevious') {
		const ln = playheadCtx?.layerNumber
		if (playheadCtx?.programChannel && ln != null) {
			const live = getLiveLayerPlayheadFrames({ ...playheadCtx, fps, layerNumber: ln })
			if (live != null) return inFrames + live
		}
		const localMs = Math.max(0, positionMs - (clip.startTime || 0))
		const relativeFrame = Math.floor((localMs * fps) / 1000)
		return inFrames + relativeFrame
	}
	return inFrames
}

/**
 * SEEK frame for look take — timeline clip on same layer index, or scene-only start behaviour.
 * @param {{ timeline?: object | null, layerIdx: number, positionMs?: number, sceneLayer?: { layerNumber?: number, source?: { value?: string }, startBehaviour?: string } | null, playheadCtx?: object | null }} opts
 * @returns {number | null} Frame index, or null to omit SEEK (Caspar default).
 */
export function resolvePlaySeekFramesForSceneLayer(opts) {
	const { timeline, layerIdx, sceneLayer, playheadCtx } = opts
	const positionMs = typeof opts.positionMs === 'number' ? opts.positionMs : 0
	const sceneSb =
		sceneLayer?.startBehaviour === 'beginning' || sceneLayer?.startBehaviour === 'relativeToPrevious'
			? sceneLayer.startBehaviour
			: undefined
	const layerCtx =
		playheadCtx && sceneLayer?.layerNumber != null
			? { ...playheadCtx, layerNumber: sceneLayer.layerNumber }
			: playheadCtx

	const tlLayer = timeline?.layers?.[layerIdx]
	const clip = tlLayer ? clipAtTimelineMs(tlLayer, positionMs) : null
	if (clip && timeline) {
		return playSeekFramesFromClip(
			clip,
			timeline,
			positionMs,
			effectiveStartBehaviour(sceneSb, clip.startBehaviour),
			layerCtx,
		)
	}

	if (sceneSb === 'beginning') return 0
	if (sceneSb === 'relativeToPrevious') {
		if (layerCtx?.programChannel && sceneLayer?.layerNumber != null) {
			return playSeekFramesForRelativeToPrevious(0, layerCtx)
		}
		return 0
	}
	return null
}

/**
 * @param {object} timeline
 * @param {number} layerIdx
 * @param {number} positionMs
 * @param {'beginning' | 'relativeToPrevious' | undefined} [sceneLayerBehaviour]
 * @returns {number | null}
 */
export function playSeekFramesForSceneLayerFromTimeline(timeline, layerIdx, positionMs, sceneLayerBehaviour) {
	return resolvePlaySeekFramesForSceneLayer({
		timeline,
		layerIdx,
		positionMs,
		sceneLayer: sceneLayerBehaviour ? { startBehaviour: sceneLayerBehaviour } : undefined,
	})
}

/**
 * @param {import('../lib/scene-state.js').Scene} scene
 * @param {{
 *   timeline?: object | null,
 *   positionMs?: number,
 *   programChannel?: number,
 *   mainIdx?: number,
 *   fps?: number,
 *   stateStore?: object,
 *   variableStore?: object,
 *   oscClient?: object,
 *   transitionTake?: boolean — when true (MIX etc.), SEEK each layer to live `current_duration` on PGM if known.
 *   pgmOnly?: boolean — normalize transitions for PGM-only direct-program take (MIX → MIX + Animate, etc.)
 * }} [seekOpts] — adds `playSeekFrames` per layer (timeline + live PGM playhead).
 */
export function buildIncomingScenePayload(scene, seekOpts) {
	const layers = (scene.layers || []).map((l) => {
		const ltCfg = isLowerThirdSource(l.source) ? resolveLayerLowerThirdConfig(l) : null
		const row = {
			layerNumber: l.layerNumber,
			source: l.source
				? {
						type: l.source.type,
						value: l.source.value,
						isPlaceholder: !!l.source.isPlaceholder,
						template: l.source.template,
						...(l.source.parameters != null ? { parameters: l.source.parameters } : {}),
						...(ltCfg ? { lowerThirdConfig: JSON.parse(JSON.stringify(ltCfg)) } : {}),
					}
				: null,
			loop: !!l.loop,
			straightAlpha: !!l.straightAlpha,
			contentFit: l.contentFit || (l.fillNativeAspect === false ? 'stretch' : 'native'),
			aspectLocked: l.aspectLocked !== false,
			fill: l.fill ? { ...l.fill } : undefined,
			opacity: l.opacity ?? 1,
			rotation: l.rotation ?? 0,
			transition: l.transition ? { ...l.transition } : null,
			audioRoute: l.audioRoute || '1+2',
			muted: !!l.muted,
			volume: l.volume != null ? l.volume : 1,
			volumeDb: linearGainToCasparDb(l.muted ? 0 : l.volume != null ? l.volume : 1),
			fadeOnEnd:
				l.fadeOnEnd && typeof l.fadeOnEnd === 'object'
					? { enabled: !!l.fadeOnEnd.enabled, frames: l.fadeOnEnd.frames ?? 12 }
					: { enabled: false, frames: 12 },
			sourceMode: l.sourceMode || 'single',
			playlist: Array.isArray(l.playlist) ? JSON.parse(JSON.stringify(l.playlist)) : [],
			playlistTransition: l.playlistTransition ? { ...l.playlistTransition } : { type: 'MIX', duration: 12, tween: 'linear' },
			playlistLoop: l.playlistLoop !== false,
			playlistAdvance: l.playlistAdvance || 'auto',
		}
		if (Array.isArray(l.effects) && l.effects.length > 0) {
			row.effects = JSON.parse(JSON.stringify(l.effects))
		}
		const pipOverlays = getPipOverlaysFromLayer(l)
		if (pipOverlays.length > 0) {
			row.pipOverlays = JSON.parse(JSON.stringify(pipOverlays))
		}
		if (ltCfg || resolveLayerLowerThirdCgData(l)) {
			row.cgData = buildLowerThirdCasparCgData(ltCfg || l.source?.lowerThirdConfig || {})
		} else if (l.templateData && typeof l.templateData === 'object') {
			row.templateData = JSON.parse(JSON.stringify(l.templateData))
		} else if (l.source?.type === 'template' && l.source?.data && typeof l.source.data === 'object') {
			row.cgData = JSON.parse(JSON.stringify(l.source.data))
		} else if (isLowerThirdSource(l.source)) {
			row.cgData = { data: {}, style: {} }
		}
		return row
	})

	const sceneLayers = scene.layers || []
	const tl = seekOpts?.timeline ?? null
	const pos =
		typeof seekOpts?.positionMs === 'number' && Number.isFinite(seekOpts.positionMs)
			? seekOpts.positionMs
			: 0
	const playheadBase =
		seekOpts?.programChannel != null
			? {
					programChannel: seekOpts.programChannel,
					mainIdx: seekOpts.mainIdx,
					fps: seekOpts.fps,
					stateStore: seekOpts.stateStore,
					variableStore: seekOpts.variableStore,
					oscClient: seekOpts.oscClient,
				}
			: null
	for (let i = 0; i < layers.length; i++) {
		const sl = sceneLayers[i]
		let frames = null
		if (seekOpts?.transitionTake && playheadBase && sl?.layerNumber != null && sl?.source?.value) {
			const live = getLiveLayerPlayheadFrames({
				...playheadBase,
				layerNumber: sl.layerNumber,
			})
			if (live != null) frames = live
		}
		if (frames == null) {
			frames = resolvePlaySeekFramesForSceneLayer({
				timeline: tl,
				layerIdx: i,
				positionMs: pos,
				sceneLayer: sl,
				playheadCtx: playheadBase,
			})
		}
		if (frames != null) layers[i] = { ...layers[i], playSeekFrames: frames }
	}

	const cv = sceneState.getCanvasForScreen(sceneState.activeScreenIndex)
	const pgmOnly = seekOpts?.pgmOnly === true
	let payload = {
		id: scene.id,
		name: scene.name || 'Untitled look',
		defaultTransition: scene.defaultTransition
			? { ...scene.defaultTransition }
			: { type: 'CUT', duration: 0, tween: 'linear' },
		/** Matches layer.fill normalization in the inspector (same as getCanvasForScreen). */
		composeCanvas: { w: cv.width, h: cv.height },
		globalBorder: scene.globalBorder ? JSON.parse(JSON.stringify(scene.globalBorder)) : undefined,
		layers,
	}
	if (pgmOnly) {
		payload = {
			...payload,
			defaultTransition: normalizeTransitionForPgmOnly(payload.defaultTransition),
			layers: payload.layers.map((l) => ({
				...l,
				transition: l.transition ? normalizeTransitionForPgmOnly(l.transition) : l.transition,
				playlistTransition: l.playlistTransition
					? normalizeTransitionForPgmOnly(l.playlistTransition)
					: l.playlistTransition,
			})),
		}
	}
	return payload
}

/**
 * Parse `route://channel-layer` (layer-specific route consumer).
 * @param {unknown} value
 * @returns {{ channel: number, layer: number } | null}
 */
export function parseRouteChannelLayer(value) {
	const m = String(value || '').match(/^route:\/\/(\d+)-(\d+)/i)
	if (!m) return null
	const channel = parseInt(m[1], 10)
	const layer = parseInt(m[2], 10)
	if (!Number.isFinite(channel) || channel < 1 || !Number.isFinite(layer) || layer < 1) return null
	return { channel, layer }
}
