import { sceneState } from '../lib/scene-state.js'
import { buildIncomingScenePayload } from './scenes-shared.js'
import { UI_FONT_FAMILY } from '../lib/ui-font.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { normalizeTransitionForPgmOnly } from '../lib/transition-presets.js'

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

export { escapeHtml } from '../lib/dom-escape.js'

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
	const tabsHost = document.createElement('div')
	tabsHost.className = 'scenes-tabs-host'
	const mainHost = document.createElement('div')
	mainHost.className = 'scenes-main scenes-split__main'

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
	mainHost.appendChild(tabsHost)

	return { rundownPlaybackSlot, scenesSplit, splitHandle, previewHost, mainHost, tabsHost, splitPx }
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
 * @param {{ post: (path: string, body?: any) => Promise<any> }} deps.api
 * @param {import('../lib/state-store.js').StateStore} deps.stateStore
 * @param {() => object} deps.getChannelMap
 * @param {() => number} deps.getProgramChannel
 * @param {() => Promise<void>} [deps.stopActiveTimelineOnServer]
 * @param {() => void} [deps.flushSceneDeckSync]
 * @param {function(string, string=): void} deps.showToast
 * @param {function(string): void} deps.primePreviewSnapshotFromScene
 */
export function createTakeSceneToProgram(deps) {
	let takeBusy = false

	/**
	 * Take SEVERAL looks to their programs SIMULTANEOUSLY (WO-150 B150.6): all payloads are
	 * built first, every POST /api/scene/take is dispatched concurrently (one per channel),
	 * and responses are merged afterwards — so a two-screen preset recall / global take starts
	 * both channels' transitions together instead of waiting out screen 1's fade.
	 * One busy window guards the whole batch (double-click protection preserved).
	 *
	 * @param {Array<{ sceneId: string, mainIdx: number }>} entries
	 * @param {boolean} forceCut
	 * @param {{ transitionOverride?: { type?: string, duration?: number, tween?: string } }} [takeOpts]
	 */
	async function takeScenesToProgram(entries, forceCut, takeOpts = {}) {
		if (takeBusy) return
		const list = (entries || []).filter((e) => e && e.sceneId != null && Number.isFinite(Number(e.mainIdx)))
		if (!list.length) return
		const transitionOverride =
			takeOpts?.transitionOverride && typeof takeOpts.transitionOverride === 'object'
				? { ...takeOpts.transitionOverride }
				: null

		takeBusy = true
		// The take response snapshot echoes the (possibly overridden) transition and
		// applySceneFromTakePayload copies it into the deck look — keep each look's own.
		const origTransitionByScene = new Map()
		try {
			await deps.stopActiveTimelineOnServer?.()
			deps.flushSceneDeckSync?.()
			const cm = deps.getChannelMap() || {}
			const programChannels =
				Array.isArray(cm.programChannels) && cm.programChannels.length > 0
					? cm.programChannels
					: [deps.getProgramChannel()]
			const variableStore = deps.getVariableStore?.() ?? null
			const oscClient = deps.getOscClient?.() ?? null

			const jobs = []
			for (const entry of list) {
				const mainIdx = Number(entry.mainIdx)
				if (mainIdx < 0 || mainIdx >= programChannels.length) continue
				const programCh = programChannels[mainIdx]
				if (!Number.isFinite(Number(programCh)) || Number(programCh) <= 0) continue
				const scene = sceneState.getScene(entry.sceneId)
				if (!scene) continue
				if (transitionOverride && scene.defaultTransition && !origTransitionByScene.has(scene.id)) {
					origTransitionByScene.set(scene.id, { ...scene.defaultTransition })
				}
				const fps = cm.programResolutions?.[mainIdx]?.fps ?? 50
				const pgmOnly = !isPreviewBusAvailable(cm, mainIdx)
				const incomingSceneForTake = buildIncomingScenePayload(scene, {
					timeline: null,
					positionMs: 0,
					programChannel: Number(programCh),
					mainIdx,
					fps,
					stateStore: deps.stateStore,
					variableStore,
					oscClient,
					transitionTake: !forceCut && !pgmOnly,
					pgmOnly,
				})
				if (transitionOverride) {
					incomingSceneForTake.defaultTransition = pgmOnly
						? normalizeTransitionForPgmOnly(transitionOverride)
						: { ...transitionOverride }
				}
				/* WO-360: name what will be black BEFORE it is. */
				import('../lib/media-exists.js').then((m) => m.warnMissingMediaOnTake(incomingSceneForTake)).catch(() => {})
				jobs.push({
					scene,
					sceneId: scene.id,
					mainIdx,
					channel: Number(programCh),
					incomingSceneForTake,
					// Dispatch NOW — all channels' takes run server-side concurrently.
					promise: deps.api.post('/api/scene/take', {
						channel: Number(programCh),
						sceneId: scene.id,
						framerate: fps,
						forceCut,
						useServerLive: true,
						incomingScene: {
							...incomingSceneForTake,
							globalBorder: sceneState.getGlobalBorderForScreen(mainIdx),
						},
					}),
				})
			}

			const results = await Promise.allSettled(jobs.map((j) => j.promise))

			const prevLive = deps.stateStore.getState()?.scene?.live || {}
			const mergedLive = { ...prevLive }
			const touched = []
			const failed = []
			for (let i = 0; i < jobs.length; i++) {
				const job = jobs[i]
				const res = results[i]
				if (res.status !== 'fulfilled') {
					failed.push({ job, error: res.reason })
					continue
				}
				const takeRes = res.value
				touched.push({ mainIdx: job.mainIdx, channel: job.channel })
				sceneState.setLiveSceneId(job.sceneId, job.mainIdx, { silent: true })
				if (takeRes?.sceneLive && typeof takeRes.sceneLive === 'object') {
					for (const [k, v] of Object.entries(takeRes.sceneLive)) {
						if (v && typeof v === 'object' && v.sceneId != null && v.scene) {
							mergedLive[k] = { sceneId: v.sceneId, scene: v.scene }
						}
					}
				} else {
					mergedLive[String(job.channel)] = { sceneId: job.sceneId, scene: job.incomingSceneForTake }
				}
				const liveSnap = takeRes?.sceneLive?.[String(job.channel)]
				if (liveSnap?.scene && liveSnap.sceneId === job.sceneId) {
					sceneState.applySceneFromTakePayload(job.sceneId, liveSnap.scene, { silent: true })
				} else {
					sceneState.applySceneFromTakePayload(job.sceneId, buildIncomingScenePayload(job.scene), { silent: true })
				}
			}
			for (const [sceneId, t] of origTransitionByScene) {
				const s = sceneState.getScene(sceneId)
				if (s) s.defaultTransition = { ...t }
			}
			deps.stateStore.applyChange('scene.live', mergedLive)
			sceneState.applyServerLiveChannels(mergedLive, cm)
			for (const sceneId of new Set(jobs.map((j) => j.sceneId))) {
				deps.primePreviewSnapshotFromScene(sceneId)
			}
			if (touched.length === 0 && failed.length === 0) {
				deps.showToast('No program output mapped for those screens. Check Settings → channel routing.', 'error')
			} else if (touched.length > 0) {
				const mode = forceCut ? 'Cut' : 'Take'
				const names = [...new Set(jobs.map((j) => j.scene.name || 'Look'))].join('”, “')
				const routeText = touched.map((x) => `M${x.mainIdx + 1} ch${x.channel}`).join(', ')
				deps.showToast(`${mode}: “${names}” → ${routeText}`, 'info')
			}
			for (const f of failed) {
				deps.showToast(f.error?.message || String(f.error), 'error')
			}
		} catch (e) {
			deps.showToast(e?.message || String(e), 'error')
		} finally {
			takeBusy = false
		}
	}

	/**
	 * @param {string} sceneId
	 * @param {boolean} forceCut
	 * @param {{ targetMains?: number[], transitionOverride?: { type?: string, duration?: number, tween?: string } }} [takeOpts]
	 *   `targetMains`: when set (e.g. from a deck column), take only those mains — not armed pills alone.
	 *   `transitionOverride`: B150.5 — replace the look's own default transition for this take (e.g. deck global default on preset recall).
	 */
	async function takeSceneToProgram(sceneId, forceCut, takeOpts = {}) {
		if (takeBusy) return
		const scene = sceneState.getScene(sceneId)
		if (!scene) return
		const cm = deps.getChannelMap() || {}
		const programChannels =
			Array.isArray(cm.programChannels) && cm.programChannels.length > 0
				? cm.programChannels
				: [deps.getProgramChannel()]
		const targetMains = (() => {
			if (Array.isArray(takeOpts?.targetMains) && takeOpts.targetMains.length > 0) {
				const picked = takeOpts.targetMains
					.map((x) => parseInt(String(x), 10))
					.filter((idx) => Number.isFinite(idx) && idx >= 0 && idx < programChannels.length)
				if (picked.length > 0) return picked
				// Explicit column/deck take — do not fall back to another main (would hit wrong PGM / HTTP 500 if routing differs).
				return []
			}
			const fallback = sceneState.armedScreenIndices?.length ? sceneState.armedScreenIndices : [sceneState.activeScreenIndex]
			const valid = fallback.filter((idx) => idx >= 0 && idx < programChannels.length)
			return valid.length > 0 ? valid : [0]
		})()
		if (targetMains.length === 0) {
			deps.showToast(
				Array.isArray(takeOpts?.targetMains) && takeOpts.targetMains.length > 0
					? 'That screen is not in the current channel map (or routing list is stale). Reload the page or fix Settings → outputs.'
					: 'No program output mapped for this screen. Check Settings → channel routing.',
				'error',
			)
			return
		}
		await takeScenesToProgram(
			targetMains.map((mainIdx) => ({ sceneId, mainIdx })),
			forceCut,
			{ transitionOverride: takeOpts?.transitionOverride },
		)
	}

	/** Batch variant exposed for multi-screen preset recall / global take (WO-150 B150.6). */
	takeSceneToProgram.batch = takeScenesToProgram
	return takeSceneToProgram
}

/**
 * @param {HTMLElement} container
 * @param {object} channelMap
 * @param {number} activeIndex
 * @param {(idx: number) => void} onSwitch
 */
export function renderScreenTabs(container, channelMap, activeIndex, onSwitch) {
	container.innerHTML = ''
	const count = Math.max(1, channelMap.screenCount ?? 1)
	if (count <= 1) return

	const tabs = document.createElement('div')
	tabs.className = 'scenes-tabs'
	tabs.style.cssText = 'display:flex;gap:4px;margin-bottom:12px;overflow-x:auto;padding-bottom:4px;'

	const virtuals = channelMap.virtualMainChannels || []
	for (let i = 0; i < count; i++) {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'btn ' + (activeIndex === i ? 'btn--primary' : 'btn--secondary')
		btn.style.padding = '0.35rem 0.75rem'
		btn.style.fontSize = '12px'
		btn.style.whiteSpace = 'nowrap'
		const v = virtuals[i]
		btn.textContent = v && v.name ? v.name : `Screen ${i + 1}`
		btn.onclick = (e) => {
			e.preventDefault()
			onSwitch(i)
		}
		tabs.appendChild(btn)
	}
	container.appendChild(tabs)
}
