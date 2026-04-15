import { sceneState } from '../lib/scene-state.js'
import { api } from '../lib/api-client.js'
import { buildIncomingScenePayload } from './scenes-shared.js'
import { timelineState } from '../lib/timeline-state.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'

/** Thumbnail width for the compose preview canvas (local ffmpeg path yields higher quality). */
export const SCENE_THUMB_MAX_W = 960
/** Smaller thumbnail for deck cards and layer strips (they display at ~100-200px). */
export const SCENE_CARD_THUMB_W = 480

export function showScenesToast(msg, type = 'info') {
	let container = document.getElementById('scenes-toast-container')
	if (!container) {
		container = document.createElement('div')
		container.id = 'scenes-toast-container'
		container.style.cssText =
			'position:fixed;bottom:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;'
		document.body.appendChild(container)
	}
	const toast = document.createElement('div')
	toast.style.cssText = `padding:10px 16px;border-radius:6px;font-size:13px;font-family:${UI_FONT_FAMILY};max-width:360px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.4);background:${
		type === 'error' ? '#b91c1c' : '#1d4ed8'
	};color:#fff;`
	toast.textContent = msg
	container.appendChild(toast)
	setTimeout(() => toast.remove(), 6000)
}

export function escapeHtml(s) {
	const div = document.createElement('div')
	div.textContent = s
	return div.innerHTML
}

const SPLIT_LS = 'casparcg_scenes_preview_split_px'

/**
 * @param {HTMLElement} root
 * @returns {{
 *   rundownPlaybackSlot: HTMLDivElement,
 *   scenesSplit: HTMLDivElement,
 *   splitHandle: HTMLDivElement,
 *   previewHost: HTMLDivElement,
 *   mainHost: HTMLDivElement,
 *   splitPx: { current: number },
 * }}
 */
export function appendScenesEditorShell(root) {
	const rundownPlaybackSlot = document.createElement('div')
	rundownPlaybackSlot.id = 'scenes-rundown-playback-slot'
	rundownPlaybackSlot.className = 'scenes-rundown-playback'
	const scenesSplit = document.createElement('div')
	scenesSplit.className = 'scenes-split'
	const splitHandle = document.createElement('div')
	splitHandle.className = 'resize-handle scenes-split__handle'
	splitHandle.title = 'Drag to resize compose preview'
	const previewHost = document.createElement('div')
	previewHost.className = 'preview-host scenes-preview-host'
	const mainHost = document.createElement('div')
	mainHost.className = 'scenes-main dashboard-main scenes-split__main'

	const vh = typeof window !== 'undefined' ? window.innerHeight : 800
	const splitPx = { current: Math.round(Math.min(420, Math.max(220, vh * 0.32))) }
	try {
		const n = parseInt(localStorage.getItem(SPLIT_LS) || '', 10)
		if (!Number.isNaN(n) && n >= 140 && n <= 2000) splitPx.current = n
	} catch {}
	previewHost.style.flex = `0 0 ${splitPx.current}px`
	previewHost.style.minHeight = '0'

	root.appendChild(rundownPlaybackSlot)
	root.appendChild(scenesSplit)
	scenesSplit.appendChild(previewHost)
	scenesSplit.appendChild(splitHandle)
	scenesSplit.appendChild(mainHost)

	return { rundownPlaybackSlot, scenesSplit, splitHandle, previewHost, mainHost, splitPx }
}

/**
 * @param {{
 *   splitHandle: HTMLElement,
 *   previewHost: HTMLElement,
 *   previewPanel: { scheduleDraw: () => void },
 *   splitPx: { current: number },
 * }} args
 */
export function bindScenesPreviewSplitDrag({ splitHandle, previewHost, previewPanel, splitPx }) {
	splitHandle.addEventListener('mousedown', (e) => {
		if (e.button !== 0) return
		e.preventDefault()
		const splitDragStartY = e.clientY
		const splitStartH = previewHost.getBoundingClientRect().height
		const onMove = (ev) => {
			const dy = ev.clientY - splitDragStartY
			const maxH = Math.min(2000, Math.floor(window.innerHeight * 0.9))
			const nh = Math.max(140, Math.min(maxH, splitStartH + dy))
			previewHost.style.flex = `0 0 ${nh}px`
			previewPanel.scheduleDraw()
		}
		const onUp = () => {
			document.removeEventListener('mousemove', onMove)
			document.removeEventListener('mouseup', onUp)
			document.body.style.cursor = ''
			document.body.style.userSelect = ''
			splitPx.current = Math.round(previewHost.getBoundingClientRect().height)
			try {
				localStorage.setItem(SPLIT_LS, String(splitPx.current))
			} catch {}
		}
		document.body.style.cursor = 'row-resize'
		document.body.style.userSelect = 'none'
		document.addEventListener('mousemove', onMove)
		document.addEventListener('mouseup', onUp)
	})
}

/**
 * @param {object} deps
 * @param {import('../lib/state-store.js').StateStore} deps.stateStore
 * @param {() => object} deps.getChannelMap
 * @param {() => number} deps.getProgramChannel
 * @param {() => number} deps.getTimelinePositionMsForTake
 * @param {function(string, string=): void} deps.showToast
 * @param {function(string): void} deps.primePreviewSnapshotFromScene
 */
export function createTakeSceneToProgram(deps) {
	let takeBusy = false
	return async function takeSceneToProgram(sceneId, forceCut) {
		if (takeBusy) return
		const scene = sceneState.getScene(sceneId)
		if (!scene) return
		const hasContent = (scene.layers || []).some((l) => l?.source?.value)
		if (!hasContent) {
			deps.showToast('Add at least one layer with a source before taking live.', 'error')
			return
		}
		takeBusy = true
		try {
			const programCh = deps.getProgramChannel()
			const fps = deps.getChannelMap().programResolutions?.[sceneState.activeScreenIndex]?.fps ?? 50
			const scenePayloadForState = buildIncomingScenePayload(scene)
			const incomingJson = buildIncomingScenePayload(scene, {
				timeline: timelineState.getActive(),
				positionMs: deps.getTimelinePositionMsForTake(),
			})
			const body = {
				channel: programCh,
				incomingScene: incomingJson,
				framerate: fps,
				forceCut,
				useServerLive: true,
			}
			const takeRes = await api.post('/api/scene/take', body)
			sceneState.setLiveSceneId(sceneId)
			const prevLive = deps.stateStore.getState()?.scene?.live || {}
			if (takeRes?.sceneLive && typeof takeRes.sceneLive === 'object') {
				const merged = { ...prevLive }
				for (const [k, v] of Object.entries(takeRes.sceneLive)) {
					if (v && typeof v === 'object' && v.sceneId != null && v.scene) {
						merged[k] = { sceneId: v.sceneId, scene: v.scene }
					}
				}
				deps.stateStore.applyChange('scene.live', merged)
			} else {
				deps.stateStore.applyChange('scene.live', {
					...prevLive,
					[String(programCh)]: { sceneId: scene.id, scene: incomingJson },
				})
			}
			const liveSnap = takeRes?.sceneLive?.[String(programCh)]
			if (liveSnap?.scene && liveSnap.sceneId === scene.id) {
				sceneState.applySceneFromTakePayload(sceneId, liveSnap.scene)
			} else {
				sceneState.applySceneFromTakePayload(sceneId, scenePayloadForState)
			}
			deps.primePreviewSnapshotFromScene(sceneId)
		} catch (e) {
			deps.showToast(e?.message || String(e), 'error')
		} finally {
			takeBusy = false
		}
	}
}
