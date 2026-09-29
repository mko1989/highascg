/**
 * WO-570 — inspector media transport for a look layer: play/pause, trim in/out, scrub bar.
 *
 * Live transport only (owner decision 2026-09-10): controls act on the REAL Caspar layer via
 * AMCP PAUSE/RESUME/SEEK, and are only enabled while this layer's look is actually showing on
 * program or preview — there is no local/pre-air scrubbing. Trim in/out are persisted on the
 * layer (`trimInMs`/`trimOutMs`, like the timeline clip's `inPoint`) and apply on every future
 * take (`src/engine/scene-play-seek.js`, `src/engine/scene-take-lbg-jobs.js`).
 *
 * Unlike the PIP-overlay live-push (`inspector-pip-overlay.js`), this does NOT exclude
 * `editingSceneId === sceneId` — that exclusion exists there to stop a DRAFT param edit from
 * leaking onto program before Take; pausing/seeking has no draft/applied distinction to leak —
 * it controls whatever is already actually playing, whether or not this same look is also open
 * in the editor right now.
 */

import { mediaDurationMs } from '../lib/media-duration.js'
import { resolveMainIndexForScene, resolveLookStackChannelForBus } from '../lib/look-stack-amcp-channel.js'
import { createDragInput } from './inspector-common.js'
import { api } from '../lib/api-client.js'

const TICK_MS = 200

/** Source types that are never a playable video clip — excluded so those layers render nothing. */
const NON_VIDEO_SOURCE_TYPES = new Set([
	'route',
	'live',
	'live_audio',
	'ndi',
	'browser',
	'template',
	'html',
	'cg',
	'effect',
	'audio',
	'placeholder',
])
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i

/**
 * @param {{ type?: string, value?: string } | null | undefined} source
 * @returns {boolean}
 */
function looksLikeVideoMedia(source) {
	if (!source?.value) return false
	const t = String(source.type || '').toLowerCase()
	if (NON_VIDEO_SOURCE_TYPES.has(t)) return false
	if (t === 'image' || IMAGE_EXT_RE.test(String(source.value))) return false
	return true
}

/** `.inspector-field--hint` carries no CSS rule of its own — every hint paragraph in this
 * inspector sets these inline (see inspector-scene-layer.js's startHint, inspector-mixer.js,
 * etc.). Centralized here so this file's three hint paragraphs can't drift from each other. */
function makeHintParagraph(text) {
	const p = document.createElement('p')
	p.className = 'inspector-field inspector-field--hint'
	p.style.fontSize = '0.78rem'
	p.style.color = 'var(--text-muted)'
	p.textContent = text
	return p
}

/** @returns {HTMLElement} the created group, so a caller can later replace/update it */
function buildHintOnlyGroup(text) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-media-transport'
	const title = document.createElement('div')
	title.className = 'inspector-group__title'
	title.textContent = 'Media transport'
	grp.appendChild(title)
	grp.appendChild(makeHintParagraph(text))
	return grp
}

/**
 * @param {object} cm - channelMap from state
 * @param {number} mainIdx
 * @returns {number}
 */
function resolveFpsForMain(cm, mainIdx) {
	const fps = cm?.programResolutions?.[mainIdx]?.fps ?? cm?.previewResolutions?.[mainIdx]?.fps
	return Number.isFinite(fps) && fps > 0 ? fps : 25
}

/**
 * @param {import('../lib/scene-state.js').SceneState} sceneState
 * @param {object} stateStore
 * @param {object} scene
 * @param {string} sceneId
 * @returns {{ channel: number, layer: number, fps: number } | null}
 */
function resolvePhysicalTarget(sceneState, stateStore, scene, sceneId, layerNumber) {
	const mainIdx = resolveMainIndexForScene(scene, sceneState)
	const cm = stateStore.getState()?.channelMap || {}
	const fps = resolveFpsForMain(cm, mainIdx)
	if (sceneState.liveSceneIdByMain[mainIdx] === sceneId) {
		const ch = resolveLookStackChannelForBus(cm, sceneState, scene, 'pgm', mainIdx)
		if (ch) return { channel: ch, layer: layerNumber, fps, bus: 'pgm' }
	}
	if (sceneState.previewSceneIdByMain[mainIdx] === sceneId) {
		const ch = resolveLookStackChannelForBus(cm, sceneState, scene, 'prv', mainIdx)
		if (ch) return { channel: ch, layer: layerNumber, fps, bus: 'prv' }
	}
	return null
}

function fmtMs(ms) {
	const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
	const m = Math.floor(s / 60)
	const r = s % 60
	return `${m}:${String(r).padStart(2, '0')}`
}

/**
 * @param {object} stateStore
 * @param {{ channel: number, layer: number }} target
 * @returns {{ playing: boolean, elapsedMs: number } | null}
 */
function readMatrixCell(stateStore, target) {
	if (!target) return null
	const st = stateStore.getState() || {}
	const matrix = st?.playback?.matrix || st?.playbackMatrix || {}
	const cell = matrix[`${target.channel}-${target.layer}`]
	if (!cell) return null
	const elapsedMs = cell.playing
		? Math.max(0, Date.now() - (cell.startedAt || Date.now()))
		: Math.max(0, cell.pausedElapsedMs || 0)
	return { playing: !!cell.playing, elapsedMs }
}

/** How long to keep retrying a duration lookup that raced the media catalog on first render
 * (WS `media` state can arrive a beat after page load — see the retry loop below). */
const DURATION_RETRY_MS = 400
const DURATION_RETRY_MAX = 25 // ~10s

/**
 * @param {HTMLElement} root
 * @param {{
 *   sceneId: string,
 *   layerIndex: number,
 *   layer: object,
 *   scene: object,
 *   sceneState: import('../lib/scene-state.js').SceneState,
 *   stateStore: object,
 * }} ctx
 */
export function appendMediaTransportGroup(root, { sceneId, layerIndex, layer, scene, sceneState, stateStore }) {
	if (!looksLikeVideoMedia(layer.source)) return
	if (layer.sourceMode === 'list') {
		root.appendChild(
			buildHintOnlyGroup('Not available in playlist mode — switch this layer to a single source to pause/trim it.')
		)
		return
	}

	const initialDurationMs = mediaDurationMs(layer.source.value)
	if (initialDurationMs && initialDurationMs > 0) {
		root.appendChild(
			buildTransportControls(initialDurationMs, { sceneId, layerIndex, layer, scene, sceneState, stateStore })
		)
		return
	}

	// Unresolved on this render — most likely the media catalog is still arriving over WS right
	// after a page load (empirically confirmed: the SAME lookup against the live catalog a moment
	// later resolves fine). Retry instead of leaving the operator stuck on a stale "unknown"
	// forever just because this component happened to render first.
	let placeholder = buildHintOnlyGroup(`Clip duration unknown for "${layer.source.value}" — checking media scan…`)
	root.appendChild(placeholder)
	let tries = 0
	const retryTimer = setInterval(() => {
		if (!document.body.contains(placeholder)) {
			clearInterval(retryTimer)
			return
		}
		tries++
		const durationMs = mediaDurationMs(layer.source.value)
		if (durationMs && durationMs > 0) {
			clearInterval(retryTimer)
			const controls = buildTransportControls(durationMs, { sceneId, layerIndex, layer, scene, sceneState, stateStore })
			placeholder.replaceWith(controls)
			placeholder = controls
			return
		}
		if (tries >= DURATION_RETRY_MAX) {
			clearInterval(retryTimer)
			const p = placeholder.querySelector('.inspector-field--hint')
			if (p) {
				p.textContent = `Clip duration unknown for "${layer.source.value}" — play/pause/trim need a known length (check the media scan / Sources tab).`
			}
		}
	}, DURATION_RETRY_MS)
}

/**
 * @param {number} durationMs
 * @param {{ sceneId: string, layerIndex: number, layer: object, scene: object, sceneState: object, stateStore: object }} ctx
 * @returns {HTMLElement}
 */
function buildTransportControls(durationMs, { sceneId, layerIndex, layer, scene, sceneState, stateStore }) {
	const grp = document.createElement('div')
	grp.className = 'inspector-group inspector-media-transport'
	const title = document.createElement('div')
	title.className = 'inspector-group__title'
	title.textContent = 'Media transport'
	grp.appendChild(title)

	const transportRow = document.createElement('div')
	transportRow.className = 'inspector-media-transport__row'
	const playBtn = document.createElement('button')
	playBtn.type = 'button'
	playBtn.className = 'scenes-btn scenes-btn--sm scenes-btn--icon'
	playBtn.setAttribute('aria-label', 'Play/pause')
	const timeLabel = document.createElement('span')
	timeLabel.className = 'inspector-media-transport__time'
	const scrub = document.createElement('input')
	scrub.type = 'range'
	scrub.className = 'inspector-media-transport__scrub'
	scrub.min = '0'
	scrub.max = String(durationMs)
	scrub.step = '100'
	scrub.value = '0'
	scrub.setAttribute('aria-label', 'Scrub position')
	transportRow.appendChild(playBtn)
	transportRow.appendChild(scrub)
	transportRow.appendChild(timeLabel)
	grp.appendChild(transportRow)

	const hint = makeHintParagraph('')
	grp.appendChild(hint)

	function target() {
		return resolvePhysicalTarget(sceneState, stateStore, scene, sceneId, layer.layerNumber)
	}

	let scrubbing = false
	function refresh() {
		const t = target()
		if (!t) {
			playBtn.disabled = true
			scrub.disabled = true
			playBtn.textContent = '▶'
			timeLabel.textContent = `— / ${fmtMs(durationMs)}`
			hint.textContent = 'Not currently on program or preview — transport is live-only.'
			return
		}
		hint.textContent = ''
		playBtn.disabled = false
		scrub.disabled = false
		const cell = readMatrixCell(stateStore, t)
		const playing = cell?.playing ?? false
		playBtn.textContent = playing ? '⏸' : '▶'
		if (!scrubbing) {
			const elapsed = Math.min(durationMs, cell?.elapsedMs ?? 0)
			scrub.value = String(elapsed)
			timeLabel.textContent = `${fmtMs(elapsed)} / ${fmtMs(durationMs)}`
		}
	}

	playBtn.addEventListener('click', async () => {
		const t = target()
		if (!t) return
		const cell = readMatrixCell(stateStore, t)
		const path = cell?.playing ? '/api/pause' : '/api/resume'
		try {
			await api.post(path, { channel: t.channel, layer: t.layer })
		} catch {
			/* transient AMCP hiccup — next tick's refresh reconciles the button state */
		}
		refresh()
	})

	let seekDebounce = null
	scrub.addEventListener('input', () => {
		scrubbing = true
		const ms = Number(scrub.value) || 0
		timeLabel.textContent = `${fmtMs(ms)} / ${fmtMs(durationMs)}`
		clearTimeout(seekDebounce)
		seekDebounce = setTimeout(() => void doSeek(ms), 60)
	})
	scrub.addEventListener('change', () => {
		const ms = Number(scrub.value) || 0
		clearTimeout(seekDebounce)
		void doSeek(ms).finally(() => {
			scrubbing = false
		})
	})

	async function doSeek(ms) {
		const t = target()
		if (!t) return
		const frame = Math.max(0, Math.round((ms * t.fps) / 1000))
		try {
			await api.post('/api/seek', { channel: t.channel, layer: t.layer, frame, positionMs: ms })
		} catch {
			/* transient AMCP hiccup — leave the bar where the operator left it */
		}
	}

	const tickTimer = setInterval(() => {
		if (!document.body.contains(scrub)) {
			clearInterval(tickTimer)
			return
		}
		refresh()
	}, TICK_MS)
	refresh()

	// --- Trim in / out (persisted on the layer — applies to every future take) ---
	const trimRow = document.createElement('div')
	trimRow.className = 'inspector-media-transport__trim-row'

	function patchTrim(patch) {
		sceneState.patchLayer(sceneId, layerIndex, patch)
	}

	const durationSec = durationMs / 1000
	const trimIn = createDragInput({
		label: 'Trim in (s)',
		value: layer.trimInMs != null ? Number(layer.trimInMs) / 1000 : 0,
		min: 0,
		max: durationSec,
		step: 0.1,
		decimals: 2,
		slider: true,
		onChange: (v) => patchTrim({ trimInMs: v > 0 ? Math.round(v * 1000) : null }),
	})
	const trimOut = createDragInput({
		label: 'Trim out (s)',
		value: layer.trimOutMs != null ? Number(layer.trimOutMs) / 1000 : durationSec,
		min: 0,
		max: durationSec,
		step: 0.1,
		decimals: 2,
		slider: true,
		onChange: (v) => patchTrim({ trimOutMs: v < durationSec ? Math.round(v * 1000) : null }),
	})
	trimRow.appendChild(trimIn.wrap)
	trimRow.appendChild(trimOut.wrap)
	grp.appendChild(trimRow)

	const trimBtnRow = document.createElement('div')
	trimBtnRow.className = 'inspector-media-transport__trim-buttons'
	const setInBtn = document.createElement('button')
	setInBtn.type = 'button'
	setInBtn.className = 'scenes-btn scenes-btn--sm'
	setInBtn.textContent = 'Set in ← playhead'
	setInBtn.addEventListener('click', () => {
		const t = target()
		const cell = t ? readMatrixCell(stateStore, t) : null
		if (!cell) return
		const ms = Math.min(durationMs, cell.elapsedMs)
		trimIn.setValue(ms / 1000, false)
		patchTrim({ trimInMs: ms > 0 ? Math.round(ms) : null })
	})
	const setOutBtn = document.createElement('button')
	setOutBtn.type = 'button'
	setOutBtn.className = 'scenes-btn scenes-btn--sm'
	setOutBtn.textContent = 'Set out ← playhead'
	setOutBtn.addEventListener('click', () => {
		const t = target()
		const cell = t ? readMatrixCell(stateStore, t) : null
		if (!cell) return
		const ms = Math.min(durationMs, cell.elapsedMs)
		trimOut.setValue(ms / 1000, false)
		patchTrim({ trimOutMs: ms < durationMs ? Math.round(ms) : null })
	})
	trimBtnRow.appendChild(setInBtn)
	trimBtnRow.appendChild(setOutBtn)
	grp.appendChild(trimBtnRow)

	grp.appendChild(
		makeHintParagraph(
			'Applies on the NEXT take of this layer (with "Start from beginning") — not the currently playing instance.'
		)
	)

	return grp
}
