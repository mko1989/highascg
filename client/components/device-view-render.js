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
import { FACTORY_RESET_GPU_LAYOUT_KEY } from '../lib/device-view-gpu-port-constants.js'
import { settingsState } from '../lib/settings-state.js'
import { populateDestinationTypeSelect, mergeSettingsIntoDeviceViewPayload } from '../lib/device-view-host-channels.js'
import { renderLiveSourcesBand, openAddLiveSourceModal } from './device-view-live-sources-render.js'
import * as Actions from './device-view-actions.js'

// Module-level cache for progressive render (T202.1-T202.2)
let lastPayload = null
let lastPayloadAt = 0
let lastRequestId = 0

export function registerDeviceViewRender(ctx) {
	const { refs, state, gHost } = ctx
	const {
		wrap,
		layout,
		destBody,
		destLiveHost,
		destType,
		mappingPanel,
		rearPanel,
		edgesHost,
		matrixHost,
		matrixCk,
		simpleWiringCk,
		statusEl,
	} = refs

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
		populateDestinationTypeSelect(destType, state.lastPayload)
		updateTopologyMismatchBanner()
		renderDestinations({
			destBody,
			lastPayload: state.lastPayload,
			highlightDestinationIntent: () => {},
			clearChipHighlights: () => {},
			renderIntoInspector: ctx.rIntoInsp,
			selectDestinationById: ctx.selectDestinationById,
			/* WO-490: every reload below answers a mutation the server has already committed, so it
			 * MUST refetch. A plain ctx.load() is served from the 5 s payload cache and skips the
			 * fetch entirely, re-rendering the pre-mutation snapshot — a removed destination stays
			 * on screen until some later forced load (classically: until a new one is added, which
			 * does force). Same class as WO-276 / WO-480. */
			patchDestination: (id, p) =>
				Actions.patchDestination(id, p).then(() => {
					ctx.setCasparRestartDirty(true)
					return ctx.load({ forceRefresh: true })
				}),
			removeDestination: (id) =>
				Actions.removeDestination(id).then(() => {
					state.selectedDestinationId = null
					ctx.setCasparRestartDirty(true)
					return ctx.load({ forceRefresh: true })
				}),
			applyPlan: () =>
				Actions.applyDeviceViewPlan({ applyCaspar: true }).then(() => {
					ctx.setCasparRestartDirty(false)
					return ctx.load({ forceRefresh: true })
				}),
			resolveDestinationSinkConnectorId: (d) => resolveDestinationSinkConnectorId(state.lastPayload, d),
			cableSourceId: state.cableSourceId,
			onDestinationPortClick: (connectorId, half) => ctx.beginOrCompleteCable('dest:' + connectorId, connectorId, { half }),
			onDecklinkDropToDestinationOutput: (connectorId, d, intent, half) =>
				ctx.setDecklinkAsDestinationOutput(connectorId, d, intent, half),
			updateDestinationOutputLayer: ctx.updateDestinationOutputLayer,
			requestCableOverlayRender: () => renderCableOverlay(ctx.getCOCtx()),
		})
		if (destLiveHost) {
			destLiveHost.innerHTML = ''
			destLiveHost.append(
				renderLiveSourcesBand({
					lastPayload: state.lastPayload,
					selectedKey: state.selectedKey,
					onPortClick: ctx.selectKey,
					onAddLiveSource: () =>
						openAddLiveSourceModal({
							load: ctx.load,
							statusEl,
							setStatusFn: setStatus,
						}),
				}),
			)
		}
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

	ctx.load = async (opts = {}) => {
		try {
			getAppWs()?.send?.({ type: 'device_view_subscribe' })

			const forceRefresh = opts.forceRefresh === true
			const now = Date.now()
			const isCached = lastPayload && (now - lastPayloadAt) < 5000
			const shouldUseCache = !forceRefresh && isCached && lastPayload

			let freshGpu = opts.freshGpu === true
			try {
				if (!freshGpu && sessionStorage.getItem(FACTORY_RESET_GPU_LAYOUT_KEY)) {
					freshGpu = true
				}
			} catch {
				/* ignore */
			}

			await settingsState.load().catch(() => {})
			if (!freshGpu) {
				await migrateLegacyGpuLayoutPrefsToServer(Actions.saveGpuPhysicalTopology)
			}

			// T202.1: Progressive render - render from cache immediately if available
			if (shouldUseCache) {
				// Fresh cache hit: render and skip fetch entirely
				state.lastPayload = lastPayload
				ctx.renderFromState({ restoreInspector: opts.restoreInspector !== false })
				return
			}

			// T202.2: If we have a stale payload, render it immediately then fetch background
			if (!forceRefresh && lastPayload && (now - lastPayloadAt) >= 5000) {
				// Stale cache: render immediately, then fetch in background
				state.lastPayload = lastPayload
				ctx.renderFromState({ restoreInspector: opts.restoreInspector !== false })

				// Fetch in background with request ID to guard against out-of-order responses
				const currentRequestId = ++lastRequestId
				const fetchAndUpdate = async () => {
					try {
						const cachedStream = getStreamingChannelStatus()
						const [payload, settings, stream] = await Promise.all([
							Actions.loadDeviceView({ freshGpu, bustCache: forceRefresh }),
							Actions.loadSettings(),
							cachedStream ? Promise.resolve(cachedStream) : Actions.getStreamingChannelStatus().catch(() => null),
						])

						// Only update if this is still the latest request
						if (currentRequestId === lastRequestId) {
							lastPayload = mergeSettingsIntoDeviceViewPayload(
								{ ...payload, gpuPhysicalTopology: settings?.gpuPhysicalTopology || null },
								settings,
							)
							lastPayloadAt = Date.now()
							state.lastPayload = lastPayload
							state.currentSettings = settings
							state.streamingStatus = stream
							ctx.renderFromState({ restoreInspector: false })
							setStatus(statusEl, `Updated ${state.lastPayload?.live?.host?.collectedAt || ''}`, true)
						}
					} catch (e) {
						if (currentRequestId === lastRequestId) {
							setStatus(statusEl, e.message, false)
						}
					}
				}
				void fetchAndUpdate()
				return
			}

			// First open: non-destructive loading overlay (WO-202 hotfix — an innerHTML
			// replacement here detached the shell's pre-built mount nodes, so the later
			// renderFromState wrote into orphaned elements and the pane never updated).
			let skelEl = null
			if (!lastPayload && refs.layout && !state.lastPayload) {
				skelEl = document.createElement('div')
				skelEl.style.cssText = 'padding:16px;text-align:center;color:#999;'
				skelEl.textContent = 'Loading devices…'
				refs.layout.appendChild(skelEl)
			}
			const removeSkel = () => {
				if (skelEl) {
					skelEl.remove()
					skelEl = null
				}
			}

			const currentRequestId = ++lastRequestId
			const cachedStream = getStreamingChannelStatus()
			let payload, settings, stream
			try {
				;[payload, settings, stream] = await Promise.all([
					/* WO-490: this is the only path a forceRefresh reaches, and it was the one not
					 * passing bustCache — so forceRefresh bypassed our 5 s payload cache but the
					 * response could still come from the browser's own `Cache-Control: max-age=3`
					 * copy, i.e. still pre-mutation. (The `bustCache: forceRefresh` on the stale-
					 * cache background fetch above is always false by construction and harmless:
					 * that branch only runs once >5 s have passed, so the 3 s HTTP cache is dead.) */
					Actions.loadDeviceView({ freshGpu, bustCache: forceRefresh }),
					Actions.loadSettings(),
					cachedStream ? Promise.resolve(cachedStream) : Actions.getStreamingChannelStatus().catch(() => null),
				])
			} finally {
				removeSkel()
			}

			// Only update if this is still the latest request
			if (currentRequestId === lastRequestId) {
				if (freshGpu) {
					try {
						sessionStorage.removeItem(FACTORY_RESET_GPU_LAYOUT_KEY)
					} catch {
						/* ignore */
					}
				}
				lastPayload = mergeSettingsIntoDeviceViewPayload(
					{ ...payload, gpuPhysicalTopology: settings?.gpuPhysicalTopology || null },
					settings,
				)
				lastPayloadAt = Date.now()
				state.lastPayload = lastPayload
				state.currentSettings = settings
				state.streamingStatus = stream
				ctx.renderFromState({ restoreInspector: opts.restoreInspector !== false })
				setStatus(statusEl, `Updated ${state.lastPayload?.live?.host?.collectedAt || ''}`, true)
			}
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}
}
