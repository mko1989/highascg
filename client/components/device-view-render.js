import { friendlyConnectorLabel, resolveConnectorId, isConnectorVisible, resolveDestinationSinkConnectorId } from './device-view-helpers.js'
import { setStatus } from './device-view-ui-utils.js'
import { renderCableOverlay } from './device-view-cables.js'
import { renderDestinations } from './device-view-destinations-ui.js'
import { renderBands } from './device-view-bands-render.js'
import { renderMatrix } from './device-view-matrix.js'
import { connectorById } from './device-view-helpers.js'
import { migrateLegacyGpuLayoutPrefsToServer } from '../lib/device-view-gpu-port-list.js'
import { gpuTopologyMismatchActive } from '../lib/device-view-gpu-port-topology.js'
import { getStreamingChannelStatus } from '../lib/streaming-channel-state.js'
import { getAppWs } from '../lib/app-runtime.js'
import * as Actions from './device-view-actions.js'

export function registerDeviceViewRender(ctx) {
	const { refs, state, gHost } = ctx
	const { wrap, layout, destBody, mappingPanel, rearPanel, edgesHost, matrixHost, matrixCk, simpleWiringCk, statusEl } =
		refs

	let topologyBannerEl = null

	function renderEdgesList() {
		edgesHost.innerHTML = ''
		const edges = state.lastPayload?.graph?.edges || []
		if (!edges.length) return edges
		const b = Object.assign(document.createElement('div'), { className: 'device-view__band' })
		b.append(Object.assign(document.createElement('h3'), { textContent: 'Cables' }))
		const ul = Object.assign(document.createElement('ul'), { className: 'device-view__edge-list' })
		edges.forEach((e) => {
			const li = Object.assign(document.createElement('li'), {
				className: `device-view__edge-item ${state.selectedEdgeId === e.id ? 'device-view__edge-item--selected' : ''}`,
			})
			li.onmouseenter = () => {
				state.hoveredEdgeId = e.id
				renderCableOverlay(ctx.getCOCtx())
			}
			li.onmouseleave = () => {
				state.hoveredEdgeId = null
				renderCableOverlay(ctx.getCOCtx())
			}
			li.onclick = () => ctx.selectEdgeById(e.id)
			li.append(
				Object.assign(document.createElement('span'), {
					textContent: `${friendlyConnectorLabel(state.lastPayload, e.sourceId)} → ${friendlyConnectorLabel(state.lastPayload, e.sinkId)} `,
				}),
			)
			ul.append(li)
		})
		b.append(ul)
		edgesHost.append(b)
		return edges
	}

	function restoreInspectorSelection(edges) {
		const activeInsp = gHost || refs.inspector
		const hasFocus = activeInsp && activeInsp.querySelector('input:focus, select:focus, textarea:focus')
		if (hasFocus) return
		if (state.selectedEdgeId) {
			if (edges.some((e) => String(e?.id || '') === String(state.selectedEdgeId))) ctx.selectEdgeById(state.selectedEdgeId)
			else state.selectedEdgeId = null
		}
		if (!state.selectedEdgeId && state.selectedConnectorId) {
			const conn = connectorById(state.lastPayload, state.selectedConnectorId)
			if (conn) {
				ctx.selectKey(state.selectedKey || `conn:${state.selectedConnectorId}`, {
					connectorId: state.selectedConnectorId,
					connector: conn,
					type: conn.kind || 'connector',
				})
			} else {
				state.selectedConnectorId = null
				state.selectedKey = null
			}
		}
		if (!state.selectedEdgeId && !state.selectedConnectorId && state.selectedDestinationId) {
			ctx.selectDestinationById(state.selectedDestinationId)
		}
		if (!state.selectedEdgeId && !state.selectedConnectorId && !state.selectedDestinationId && state.selectedDeviceId) {
			const dev = (state.lastPayload?.graph?.devices || []).find(
				(d) => String(d?.id || '') === String(state.selectedDeviceId),
			)
			if (dev) ctx.selectDevice(state.selectedDeviceId, state.lastPayload?.live)
			else state.selectedDeviceId = null
		}
	}

	function updateTopologyMismatchBanner() {
		if (!wrap || !state.lastPayload) return
		const show = gpuTopologyMismatchActive(state.lastPayload)
		if (!show) {
			if (topologyBannerEl) {
				topologyBannerEl.remove()
				topologyBannerEl = null
			}
			return
		}
		if (!topologyBannerEl) {
			topologyBannerEl = Object.assign(document.createElement('div'), {
				className: 'device-view__gpu-topology-banner device-view__note',
				style: 'background:#432;color:#fc9;padding:6px 10px;margin:4px 0;border-radius:4px',
			})
			wrap.insertBefore(topologyBannerEl, layout)
		}
		topologyBannerEl.textContent =
			'Detected GPU wiring differs from saved layout — open a GPU port in the inspector and use the layout editor to review.'
	}

	ctx.renderFromState = ({ restoreInspector = false } = {}) => {
		if (!state.lastPayload) return
		updateTopologyMismatchBanner()
		renderDestinations({
			destBody,
			lastPayload: state.lastPayload,
			highlightDestinationIntent: () => {},
			clearChipHighlights: () => {},
			renderIntoInspector: ctx.rIntoInsp,
			selectDestinationById: ctx.selectDestinationById,
			patchDestination: (id, p) =>
				Actions.patchDestination(id, p).then(() => {
					ctx.setCasparRestartDirty(true)
					return ctx.load()
				}),
			removeDestination: (id) =>
				Actions.removeDestination(id).then(() => {
					state.selectedDestinationId = null
					ctx.setCasparRestartDirty(true)
					return ctx.load()
				}),
			applyPlan: () =>
				Actions.applyDeviceViewPlan({ applyCaspar: true }).then(() => {
					ctx.setCasparRestartDirty(false)
					return ctx.load()
				}),
			resolveDestinationSinkConnectorId: (d) => resolveDestinationSinkConnectorId(state.lastPayload, d),
			cableSourceId: state.cableSourceId,
			onDestinationPortClick: (connectorId) => ctx.beginOrCompleteCable('dest:' + connectorId, connectorId, {}),
			onDecklinkDropToDestinationOutput: (connectorId, d, intent) =>
				ctx.setDecklinkAsDestinationOutput(connectorId, d, intent),
			updateDestinationOutputLayer: ctx.updateDestinationOutputLayer,
			requestCableOverlayRender: () => renderCableOverlay(ctx.getCOCtx()),
		})
		if (matrixCk.checked) {
			renderMatrix(
				matrixHost,
				state.lastPayload,
				ctx.pushUndo,
				ctx.setCasparRestartDirty,
				ctx.load,
				ctx.selectKey,
				ctx.selectDestinationById,
			)
		} else {
			renderBands(
				mappingPanel,
				rearPanel,
				{
					live: state.lastPayload.live,
					lastPayload: state.lastPayload,
					resolveConnectorId: (t, d) => resolveConnectorId(state.lastPayload, t, d),
					isConnectorVisible: (id) => isConnectorVisible(state.lastPayload, id),
					selectedKey: state.selectedKey,
					cableSourceId: state.cableSourceId,
					onPortClick: ctx.selectKey,
					onPortStartCable: ctx.beginOrCompleteCable,
					selectDevice: ctx.selectDevice,
					selectedConnectorId: state.selectedConnectorId,
					simpleWiring: simpleWiringCk.checked,
				},
				{
					currentSettings: state.currentSettings,
					statusEl,
					load: ctx.load,
					setCasparRestartDirty: ctx.setCasparRestartDirty,
				},
			)
			rearPanel.append(edgesHost)
		}
		const edges = renderEdgesList()
		if (restoreInspector) restoreInspectorSelection(edges)
		requestAnimationFrame(() => ctx.updateUI())
	}

	ctx.load = async () => {
		try {
			getAppWs()?.send?.({ type: 'device_view_subscribe' })
			await migrateLegacyGpuLayoutPrefsToServer(Actions.saveGpuPhysicalTopology)
			const cachedStream = getStreamingChannelStatus()
			const [payload, settings, stream] = await Promise.all([
				Actions.loadDeviceView(),
				Actions.loadSettings(),
				cachedStream ? Promise.resolve(cachedStream) : Actions.getStreamingChannelStatus().catch(() => null),
			])
			state.lastPayload = { ...payload, gpuPhysicalTopology: settings?.gpuPhysicalTopology || null, _settings: settings }
			state.currentSettings = settings
			state.streamingStatus = stream
			ctx.renderFromState({ restoreInspector: true })
			setStatus(statusEl, `Updated ${state.lastPayload?.live?.host?.collectedAt || ''}`, true)
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}
}
