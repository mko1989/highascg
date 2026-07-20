/**
 * Scenes editor — deck look-card thumbnail painting.
 */

import { drawSceneComposeStack } from './preview-canvas.js'
import { drawCgOnlyLookDeckThumb } from './cg-only-look-deck-thumb.js'
import { isCgOnlyLook } from '../lib/scene-look-kind.js'
import { drawComposeSnapshotCell, isSnapshotComposePreview } from './preview-canvas-compose-snapshot.js'
import { resolveComposeChannelForEditingScene, resolveComposeChannelForCell } from '../lib/compose-preview-url.js'
import { resolveLookAirComposeChannel } from '../lib/look-air-compose-channel.js'
import {
	resolveSourceThumbnailUrl,
	liveThumbnailCacheBustWindow,
	LIVE_THUMBNAIL_TTL_MS,
} from '../lib/thumbnail-url.js'
import { invalidateThumbnailCache } from './preview-canvas-draw-base.js'
import * as Logic from './scenes-editor-logic.js'
import { SCENE_CARD_THUMB_W, SCENE_THUMB_MAX_W } from './scenes-editor-support.js'

/**
 * @param {object} ctx
 */
export function createDeckThumbPainter(ctx) {
	const {
		sceneState,
		stateStore,
		getChannelMap,
		getProgramChannel,
		previewPanel,
		mainHost,
	} = ctx

	/** @type {ReturnType<typeof setTimeout> | null} */
	let liveRefreshTimer = null
	/** @type {number | null} */
	let liveRefreshWindow = null

	function paintDeckThumb(c) {
		const id = c.dataset.sceneId
		const scene = id ? sceneState.getScene(id) : null
		if (!scene) return
		const main = Number.isFinite(Number(c.dataset.deckMain))
			? parseInt(c.dataset.deckMain, 10)
			: 0
		const res = Logic.getResolutionForScreen(main, sceneState, stateStore)
		const cw = SCENE_CARD_THUMB_W
		const ch = Math.round((cw * res.h) / res.w)
		if (c.width !== cw) {
			c.width = cw
			c.height = ch
		}
		const canvasCtx = c.getContext('2d')
		const cm = getChannelMap()
		const sceneLive = stateStore.getState()?.scene?.live || {}

		if (isSnapshotComposePreview()) {
			const air = resolveLookAirComposeChannel(scene.id, main, sceneState, cm, sceneLive)
			if (air?.channel) {
				drawComposeSnapshotCell(canvasCtx, cw, ch, air.channel, { onLoaded: () => previewPanel.scheduleDraw() })
				return
			}
			if (scene.id === sceneState.editingSceneId) {
				const { channel: editCh } = resolveComposeChannelForEditingScene(scene, sceneState, cm)
				if (editCh) {
					drawComposeSnapshotCell(canvasCtx, cw, ch, editCh, { onLoaded: () => previewPanel.scheduleDraw() })
					return
				}
			}
			const previewId = sceneState.getPreviewSceneIdForMain(main)
			if (previewId === scene.id) {
				const previewCh = resolveComposeChannelForCell(
					{ composeCell: 'prv', composeScreenIdx: main },
					cm,
					main,
				)
				if (previewCh) {
					drawComposeSnapshotCell(canvasCtx, cw, ch, previewCh, { onLoaded: () => previewPanel.scheduleDraw() })
					return
				}
			}
		}

		if (isCgOnlyLook(scene)) {
			drawCgOnlyLookDeckThumb(canvasCtx, cw, ch, scene, {
				onRepaint: () => {
					previewPanel.scheduleDraw()
					if (!c.isConnected) return
					requestAnimationFrame(() => {
						if (!c.isConnected) return
						paintDeckThumb(c)
					})
				},
			})
			return
		}

		// DeckLink-input layers resolve to `/api/thumbnail/live/<inputCh>` (the server captures via
		// PRINT). The bust token is quantised to the live-thumbnail TTL, so every repaint inside a
		// window reuses one cached image and the frame refreshes at most once per TTL.
		const liveBust = liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS)
		let usedLiveInputThumb = false
		const getDeckThumbUrl = (s) => {
			const url = resolveSourceThumbnailUrl(s, {
				maxWidth: SCENE_THUMB_MAX_W,
				seekSec: 0,
				deckIdleMode: true,
				channelMap: cm,
				cacheBust: liveBust,
			})
			if (url && url.includes('/api/thumbnail/live/')) usedLiveInputThumb = true
			return url
		}

		drawSceneComposeStack(canvasCtx, cw, ch, {
			scene,
			selectedLayerIndex: null,
			getThumbUrl: getDeckThumbUrl,
			onThumbLoaded: () => {
				previewPanel.scheduleDraw()
				if (!c.isConnected) return
				requestAnimationFrame(() => {
					if (!c.isConnected) return
					paintDeckThumb(c)
				})
			},
			deckThumbnailMode: true,
		})

		if (usedLiveInputThumb) armLiveInputRefresh(liveBust)
	}

	/**
	 * One shared timer for the whole deck: when the TTL window rolls over, drop the per-URL canvas
	 * image cache for live thumbs (also bounds that Map) and repaint once. Re-armed only while a
	 * DeckLink-input layer is actually on screen, so an idle deck runs no timers at all.
	 * @param {number} bustWindow
	 */
	function armLiveInputRefresh(bustWindow) {
		if (typeof window === 'undefined') return
		if (liveRefreshTimer != null && liveRefreshWindow === bustWindow) return
		if (liveRefreshTimer != null) clearTimeout(liveRefreshTimer)
		liveRefreshWindow = bustWindow
		const dueAt = (bustWindow + 1) * LIVE_THUMBNAIL_TTL_MS
		liveRefreshTimer = setTimeout(() => {
			liveRefreshTimer = null
			liveRefreshWindow = null
			invalidateThumbnailCache('/api/thumbnail/live/')
			repaintDeckThumbs()
		}, Math.max(250, dueAt - Date.now()))
	}

	function repaintDeckThumbs() {
		if (sceneState.editingSceneId) return
		mainHost.querySelectorAll('.scenes-card__thumb-canvas').forEach(paintDeckThumb)
	}

	// Canvas-mode PRV deck cells go stale after MIXER-only look edits (no new source thumbnail URL
	// to invalidate the composite) — `scenes-preview-runtime.js` fires this (debounced) after every
	// completed preview push (T155.4a). `repaintDeckThumbs` already no-ops while the editor is open
	// (deck cards aren't mounted then); the deck picks up the current geometry on its next render.
	if (typeof window !== 'undefined') {
		window.addEventListener('scenes-deck-thumb-redraw', repaintDeckThumbs)
	}

	return { paintDeckThumb, repaintDeckThumbs }
}
