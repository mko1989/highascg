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

export { renderCasparSettingsInspector }

export function renderConnectorInspector(h, conn, ctx, {
	lastPayload,
	currentSettings,
	streamingStatus,
	skipPh,
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
	const rows = readableConnectorRows(conn, ctx)
	const edges = lastPayload?.graph?.edges || []
	const summary = { in: edges.filter((e) => e.sinkId === conn.id), out: edges.filter((e) => e.sourceId === conn.id) }
	rows.push({ label: 'Out cables', value: String(summary.out.length) }, { label: 'In cables', value: String(summary.in.length) })
	h.append(Object.assign(document.createElement('p'), { textContent: 'Selected connector' }), buildInspectorTable(rows))

	if (conn?.kind === 'decklink_io') {
		renderDeckLinkIoControls(h, conn, { skipPh, load })
	} else if (conn?.kind === 'stream_out') {
		renderStreamOutControls(h, conn, { currentSettings, streamingStatus, statusEl, load, setCasparRestartDirty, onRemoveStreamOutput })
	} else if (conn?.kind === 'record_out') {
		renderRecordOutControls(h, conn, { currentSettings, statusEl, load, onRemoveRecordOutput })
	} else if (conn?.kind === 'audio_out') {
		renderAudioOutControls(h, conn, { currentSettings, lastPayload, statusEl, load, setCasparRestartDirty, onRemoveAudioOutput })
	} else if (conn?.kind === 'gpu_out') {
		renderGpuOutControls(h, conn, { currentSettings, lastPayload, skipPh, statusEl, load, setCasparRestartDirty })
	}
}
