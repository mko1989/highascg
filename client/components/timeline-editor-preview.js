/**
 * Timeline editor preview panel (PRV/PGM compose + legacy stack).
 */

import { timelineState } from '../lib/timeline-state.js'
import { sceneState } from '../lib/scene-state.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { initPreviewPanel, drawTimelineStack } from './preview-canvas.js'
import {
	drawComposeSnapshotCell,
	isSnapshotComposePreview,
	resolveComposeChannelForCell,
	subscribeComposePreviewRefresh,
	syncComposePreviewFromChannelMap,
} from './preview-canvas-compose-snapshot.js'
import {
	drawTimelineComposeInactiveCell,
	timelineComposeCellShowsTimeline,
} from '../lib/timeline-compose-preview.js'
import { drawComposePrvPgmCellEdgeBar } from './preview-canvas-draw-base.js'
import { streamState } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'
import { isPreviewBusAvailable } from '../lib/scenes-preview-look-stack.js'
import { reportTimelineCellRects } from '../lib/operator-gui-mode.js'

/**
 * @param {object} opts
 * @param {HTMLElement} opts.previewHost
 * @param {HTMLElement | null} opts.tlSplitHandle
 * @param {HTMLElement} opts.root
 * @param {{ sendTo: object }} opts.view
 * @param {object} opts.stateStore
 * @param {() => object} opts.getPlayback
 * @param {number} opts.tlSplitPx
 */
export function initTimelineEditorPreview(opts) {
	const { previewHost, tlSplitHandle, root, view, stateStore, getPlayback, tlSplitPx } = opts

	const previewPanel = initPreviewPanel(previewHost, {
		title: 'Timeline output',
		storageKeyPrefix: 'casparcg_preview_timeline',
		fillParentHeight: true,
		hideInnerResize: true,
		onCollapsedChange: (isCollapsed) => {
			previewHost.classList.toggle('tl-preview-host--collapsed', !!isCollapsed)
			if (isCollapsed) {
				previewHost.style.flex = '0 0 auto'
			} else {
				previewHost.style.flex = `0 0 ${tlSplitPx}px`
			}
		},
		getOutputResolution: () => {
			const s = view.sendTo.screenIdx ?? 0
			const pr = stateStore.getState()?.channelMap?.programResolutions?.[s]
			if (pr?.w > 0 && pr?.h > 0) return pr
			const cv = sceneState.getCanvasForScreen(s)
			if (cv.width > 0 && cv.height > 0) return { w: cv.width, h: cv.height }
			return { w: 1920, h: 1080 }
		},
		stateStore,
		getComposeCellDefs: () => {
			const s = Math.max(0, view.sendTo.screenIdx ?? 0)
			const cm = stateStore.getState()?.channelMap || {}
			const pgmCh = cm.programChannels?.[s] ?? null
			const prvCh = cm.previewChannels?.[s] ?? null
			const labelBase = cm.virtualMainChannels?.[s]?.name || `Screen ${s + 1}`
			const defs = [{
				id: `pgm_${s + 1}`,
				role: 'pgm',
				mainIndex: s,
				label: `PGM · ${labelBase}${pgmCh != null ? ` (ch ${pgmCh})` : ''}`,
			}]
			if (isPreviewBusAvailable(cm, s) && prvCh != null) {
				defs.push({
					id: `prv_${s + 1}`,
					role: 'prv',
					mainIndex: s,
					label: `PRV · ${labelBase} (ch ${prvCh})`,
				})
			}
			return defs
		},
		getDualStreamNames: () => {
			const s = Math.max(0, view.sendTo.screenIdx ?? 0)
			const cm = stateStore.getState()?.channelMap || {}
			const pgmCh = cm.programChannels?.[s] ?? 1
			const prvCh = isPreviewBusAvailable(cm, s) ? cm.previewChannels?.[s] : null
			return { pgm: `pgm_${Math.max(1, pgmCh)}`, prv: `prv_${Math.max(1, prvCh || pgmCh)}` }
		},
		showDestinationVisualOverlay: false,
		composePrvPgmLayoutToggle: true,
		// WO-255 T255.3: surface 2/3 for the operator-GUI video overlay — no-op unless operator-GUI
		// mode is active (reportTimelineCellRects hard-gates itself).
		onComposeCellRects: (cellRects) => reportTimelineCellRects(cellRects),
		draw(ctx, W, H, isLive, meta = {}) {
			if (isSnapshotComposePreview() && meta.composeCell) {
				const layout = meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr'
				const v = meta.composeCellViewport
				const cellW = v?.w || W
				const cellH = v?.h || H
				if (isLive) {
					ctx.clearRect(0, 0, cellW, cellH)
					drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
					return
				}
				const cm = stateStore.getState()?.channelMap || {}
				const ch = resolveComposeChannelForCell(meta, cm, view.sendTo.screenIdx ?? 0)
				if (ch) {
					drawComposeSnapshotCell(ctx, cellW, cellH, ch, { onLoaded: () => previewPanel.scheduleDraw() })
					drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
					return
				}
			}
			if (
				meta.composeDualStreamPreview === true &&
				meta.composeCell &&
				!timelineComposeCellShowsTimeline(view.sendTo, meta.composeCell)
			) {
				drawTimelineComposeInactiveCell(ctx, meta, {
					stateStore,
					view,
					onRedraw: () => previewPanel.scheduleDraw(),
				})
				return
			}
			drawTimelineStack(ctx, W, H, {
				timelineState,
				getPlayback,
				isLive,
				composePrvPgmLayout: meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr',
				composeDualStreamPreview: meta.composeDualStreamPreview === true,
				composeCell: meta.composeCell,
				composeCellViewport: meta.composeCellViewport,
				getThumbUrl: (src) =>
					src?.type === 'media' && src?.value
						? getThumbnailUrl(src.value, 320, 2)
						: null,
				onThumbLoaded: () => previewPanel.scheduleDraw(),
				stateStore,
				screenIdx: meta.composeScreenIdx ?? (view.sendTo.screenIdx ?? 0),
			})
		},
	})

	function syncTimelinePreviewVisibility() {
		previewHost.style.display = ''
		if (tlSplitHandle) tlSplitHandle.style.display = ''
		root.classList.remove('tl-editor-root--no-preview')
		syncComposePreviewFromChannelMap(stateStore.getState()?.channelMap)
		previewPanel?.scheduleDraw?.()
	}
	streamState.subscribe(syncTimelinePreviewVisibility)
	settingsState.subscribe(syncTimelinePreviewVisibility)
	subscribeComposePreviewRefresh(() => previewPanel?.scheduleDraw?.())
	syncTimelinePreviewVisibility()

	return previewPanel
}
