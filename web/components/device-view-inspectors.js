/**
 * Specialized inspector renderers for Device View.
 * Entry point that delegates to specialized modules.
 */
import { buildInspectorTable } from './device-view-ui-utils.js'
import { readableConnectorRows } from './device-view-inspector-render.js'
import { renderDeckLinkIoControls } from './device-view-inspector-decklink.js'
import { renderStreamOutControls } from './device-view-inspector-stream.js'
import { renderRecordOutControls } from './device-view-inspector-record.js'
import { renderAudioOutControls } from './device-view-inspector-audio.js'
import { renderGpuOutControls } from './device-view-inspector-gpu.js'
import { renderCasparSettingsInspector } from './device-view-inspector-caspar.js'
import { renderMappingConnectorControls } from './device-view-inspector-mapping.js'

export { renderCasparSettingsInspector }

export function renderConnectorInspector(h, conn, ctx, {
	lastPayload,
	currentSettings,
	streamingStatus,
	statusEl,
	load,
	setCasparRestartDirty,
	onRemoveStreamOutput,
	onRemoveRecordOutput,
	onRemoveAudioOutput,
}) {
	if (!conn || typeof conn !== 'object' || !conn.id) {
		h.append(
			Object.assign(document.createElement('p'), {
				className: 'device-view__status',
				textContent: 'Connector not found in current graph snapshot. Refresh Device View.',
			})
		)
		return
	}
	const edges = lastPayload?.graph?.edges || []
	const summary = { in: edges.filter((e) => e.sinkId === conn.id), out: edges.filter((e) => e.sourceId === conn.id) }
	
	const isGpu = conn?.kind === 'gpu_out' || conn?.kind === 'gpu_output'
	
	h.append(
		Object.assign(document.createElement('div'), {
			className: 'device-view__inspector-title',
			textContent: conn.label || conn.id,
		})
	)

	if (!isGpu) {
		const rows = readableConnectorRows(conn, ctx)
		rows.push({ label: 'Out cables', value: String(summary.out.length) }, { label: 'In cables', value: String(summary.in.length) })
		h.append(buildInspectorTable(rows))
	}

	if (conn?.kind === 'decklink_io' || conn?.kind === 'decklink_out') {
		renderDeckLinkIoControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty })
	} else if (conn?.kind === 'stream_out') {
		renderStreamOutControls(h, conn, { currentSettings, streamingStatus, statusEl, load, setCasparRestartDirty, onRemoveStreamOutput })
	} else if (conn?.kind === 'record_out') {
		renderRecordOutControls(h, conn, { currentSettings, statusEl, load, onRemoveRecordOutput })
	} else if (conn?.kind === 'audio_out') {
		renderAudioOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, onRemoveAudioOutput })
	} else if (conn?.kind === 'gpu_out' || conn?.kind === 'gpu_output') {
		renderGpuOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, connectorCtx: ctx })
	} else if (conn?.kind === 'pixel_map_in' || conn?.kind === 'pixel_map_out') {
		renderMappingConnectorControls(h, conn, {
			lastPayload,
			statusEl,
			load,
			setCasparRestartDirty,
			nodeId: String(conn?.deviceId || ''),
		})
	}
}
