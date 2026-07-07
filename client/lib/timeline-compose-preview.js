/**
 * Timeline compose preview — inactive bus cells show live/snapshot, not the edit stack.
 */
import { resolveComposeChannelForCell } from './compose-preview-url.js'
import { shouldShowLiveVideo } from './stream-state.js'
import { drawComposeSnapshotCell } from '../components/preview-canvas-compose-snapshot.js'
import { drawComposePrvPgmCellEdgeBar } from '../components/preview-canvas-draw-base.js'

export { timelineComposeCellShowsTimeline } from './timeline-state-model.js'

/**
 * Compose cell that is not receiving timeline output — show live bus underneath or a channel snapshot.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} meta
 * @param {{ stateStore: object, view: { sendTo: object }, onRedraw?: () => void }} deps
 */
export function drawTimelineComposeInactiveCell(ctx, meta, deps) {
	const { stateStore, view, onRedraw } = deps
	const layout = meta.composePrvPgmLayout === 'tb' ? 'tb' : 'lr'
	const v = meta.composeCellViewport
	const cellW = v?.w > 0 ? v.w : ctx.canvas.width
	const cellH = v?.h > 0 ? v.h : ctx.canvas.height
	ctx.clearRect(0, 0, cellW, cellH)
	if (!shouldShowLiveVideo()) {
		const cm = stateStore.getState()?.channelMap || {}
		const ch = resolveComposeChannelForCell(meta, cm, view.sendTo?.screenIdx ?? 0)
		if (ch) {
			drawComposeSnapshotCell(ctx, cellW, cellH, ch, { onLoaded: onRedraw })
		}
	}
	drawComposePrvPgmCellEdgeBar(ctx, cellW, cellH, { layout, cell: meta.composeCell })
}
