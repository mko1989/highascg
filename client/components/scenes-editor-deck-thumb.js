/**
 * Scenes editor — deck look-card thumbnail painting.
 */

import { drawSceneComposeStack } from './preview-canvas.js'
import { drawCgOnlyLookDeckThumb } from './cg-only-look-deck-thumb.js'
import { isCgOnlyLook } from '../lib/scene-look-kind.js'
import { drawComposeSnapshotCell, isSnapshotComposePreview } from './preview-canvas-compose-snapshot.js'
import { resolveComposeChannelForEditingScene, resolveComposeChannelForCell } from '../lib/compose-preview-url.js'
import { resolveLookAirComposeChannel } from '../lib/look-air-compose-channel.js'
import { resolveSourceThumbnailUrl } from '../lib/thumbnail-url.js'
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
		getThumbForSource,
		previewPanel,
		mainHost,
	} = ctx

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

		const getDeckThumbUrl = (s) =>
			resolveSourceThumbnailUrl(s, {
				maxWidth: SCENE_THUMB_MAX_W,
				seekSec: 0,
				deckIdleMode: true,
			})

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
	}

	function repaintDeckThumbs() {
		if (sceneState.editingSceneId) return
		mainHost.querySelectorAll('.scenes-card__thumb-canvas').forEach(paintDeckThumb)
	}

	return { paintDeckThumb, repaintDeckThumbs }
}
