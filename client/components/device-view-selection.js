import { CASPAR_HOST, connectorById, resolveDestinationSinkConnectorId } from './device-view-helpers.js'
import { renderPreservingFocus } from './device-view-ui-utils.js'
import { renderDeviceInspector, renderEdgeInspector } from './device-view-inspector-render.js'
import { renderConnectorInspector, renderCasparSettingsInspector } from './device-view-inspectors.js'
import { findScreenDestinationById, mergeSettingsIntoDeviceViewPayload } from '../lib/device-view-host-channels.js'
import { renderDestinationInspector } from './device-view-destinations-inspector.js'
import * as Actions from './device-view-actions.js'
import { settingsState } from '../lib/settings-state.js'

export function registerDeviceViewSelection(ctx) {
	const { refs, state, gHost } = ctx
	const { inspector, applyCasparBtn } = refs

	const rIntoInsp = (fn) => {
		const h = gHost || inspector
		if (gHost) {
			gHost.classList.add('device-view-inspector-host')
			if (gHost.id === 'panel-inspector-scroll') h.classList.add('panel-inspector__scroll')
		}
		renderPreservingFocus(h, () => {
			h.innerHTML = ''
			fn(h)
		})
		if (h !== inspector) inspector.innerHTML = '<p class="device-view__status">Details in right panel.</p>'
	}

	ctx.rIntoInsp = rIntoInsp

	ctx.setCasparRestartDirty = (dirty = true) => {
		state.casparRestartDirty = !!dirty
		applyCasparBtn.classList.toggle('device-view__apply-btn--dirty', state.casparRestartDirty)
	}

	ctx.selectDevice = (devId, live) => {
		state.selectedKey = null
		state.selectedConnectorId = null
		state.selectedEdgeId = null
		state.selectedDestinationId = null
		state.selectedDeviceId = devId
		const dev = (state.lastPayload?.graph?.devices || []).find((d) => d.id === devId)
		rIntoInsp((h) => {
			if (devId === CASPAR_HOST) {
				renderCasparSettingsInspector(h, {
					currentSettings: state.currentSettings,
					lastPayload: state.lastPayload,
					statusEl: refs.statusEl,
					load: ctx.load,
					setCasparRestartDirty: ctx.setCasparRestartDirty,
				})
			} else {
				renderDeviceInspector(h, devId, live, dev, {
					lastPayload: state.lastPayload,
					load: ctx.load,
					setCasparRestartDirty: ctx.setCasparRestartDirty,
					statusEl: refs.statusEl,
				})
			}
		})
	}

	ctx.selectKey = (key, selCtx) => {
		const requestedConnectorId = String(
			selCtx?.connectorId ||
				selCtx?.connector?.id ||
				(typeof key === 'string' && key.startsWith('conn:') ? key.slice(5) : '') ||
				(typeof key === 'string' && key.startsWith('caspar_overlay:') ? key.split(':')[1] : '') ||
				'',
		).trim()
		if (!requestedConnectorId) {
			state.selectedKey = null
			state.selectedConnectorId = null
			state.selectedEdgeId = null
			state.selectedDeviceId = null
			rIntoInsp((h) =>
				h.append(
					Object.assign(document.createElement('p'), {
						className: 'device-view__status',
						textContent: 'Select a valid connector from the current graph snapshot.',
					}),
				),
			)
			ctx.updateUI()
			return
		}
		// WO-303 (A): a cable's visible end is the connector *marker* (the 36px icon / port body),
		// not the small `.device-view__connector-dot` child that owns the cable gesture. Clicking
		// that marker lands here — and the `state.selectedEdgeId = null` below used to fire first,
		// destroying the very "cable is already selected" precondition `tryBeginCableRegrab`
		// requires. The gesture from WO-278 ("select a cable, click one of its ends to lift it")
		// was therefore unreachable for every operator who did not hit the dot exactly.
		//
		// Offer the re-grab before clearing. `tryBeginCableRegrab` is itself strict: it returns
		// false unless a currently-SELECTED edge actually terminates at this connector, so a plain
		// connector click still selects the connector exactly as before.
		if (typeof ctx.tryBeginCableRegrab === 'function' && ctx.tryBeginCableRegrab(requestedConnectorId)) return
		state.selectedKey = key
		state.selectedConnectorId = requestedConnectorId
		state.selectedEdgeId = null
		state.selectedDestinationId = null
		state.selectedDeviceId = null
		let conn = connectorById(state.lastPayload, state.selectedConnectorId)
		if (!conn && selCtx?.connector?.isVirtual) {
			conn = selCtx.connector
		}

		if (!conn) {
			rIntoInsp((h) =>
				h.append(
					Object.assign(document.createElement('p'), {
						className: 'device-view__status',
						textContent: `Connector "${String(state.selectedConnectorId || '')}" is not available in current graph snapshot.`,
					}),
				),
			)
			ctx.updateUI()
			return
		}
		rIntoInsp((h) =>
			renderConnectorInspector(h, conn, selCtx, {
				lastPayload: state.lastPayload,
				currentSettings: state.currentSettings,
				streamingStatus: state.streamingStatus,
				statusEl: refs.statusEl,
				load: ctx.load,
				setCasparRestartDirty: ctx.setCasparRestartDirty,
				onRemoveStreamOutput: ctx.removeStreamOutputConnector,
				onRemoveRecordOutput: ctx.removeRecordOutputConnector,
				onRemoveAudioOutput: ctx.removeAudioOutputConnector,
				onRemoveVirtualCamOutput: ctx.removeVirtualCamOutputConnector,
			}),
		)
		ctx.updateUI()
	}

	ctx.focusConnectorById = (connectorId) => {
		const cid = String(connectorId || '').trim()
		if (!cid) return
		const conn = connectorById(state.lastPayload, cid)
		if (!conn) {
			void ctx.load()
			return
		}
		state.selectedEdgeId = null
		state.selectedKey = `conn:${cid}`
		ctx.selectKey(state.selectedKey, { connectorId: cid, connector: conn, type: conn.kind || 'connector' })
	}

	ctx.selectEdgeById = (id) => {
		const e = (state.lastPayload?.graph?.edges || []).find((x) => x.id === id)
		if (!e) return
		state.selectedEdgeId = id
		state.selectedConnectorId = null
		state.selectedKey = null
		state.selectedDestinationId = null
		state.selectedDeviceId = null
		rIntoInsp((h) => renderEdgeInspector(h, e, (edgeId) => ctx.removeEdge(edgeId)))
		ctx.updateUI()
	}

	ctx.selectDestinationById = (id) => {
		const d = findScreenDestinationById(state.lastPayload, id)
		if (!d) {
			state.selectedDestinationId = null
			return
		}
		state.selectedDestinationId = id
		state.selectedEdgeId = null
		state.selectedConnectorId = null
		state.selectedKey = null
		state.selectedDeviceId = null
		const mode = String(d.mode || 'pgm_prv')
		const intentItems = Array.isArray(state.lastPayload?.live?.caspar?.destinationIntent?.items)
			? state.lastPayload.live.caspar.destinationIntent.items
			: []
		const intent = intentItems.find((x) => String(x.id) === String(d.id)) || null
		const sinkConnectorId = resolveDestinationSinkConnectorId(state.lastPayload, d)
		const graphEdges = Array.isArray(state.lastPayload?.graph?.edges) ? state.lastPayload.graph.edges : []
		const graphConnectors = Array.isArray(state.lastPayload?.graph?.connectors) ? state.lastPayload.graph.connectors : []
		const suggestedConnectors = Array.isArray(state.lastPayload?.suggested?.connectors)
			? state.lastPayload.suggested.connectors
			: []
		const connectorByIdMap = new Map([...graphConnectors, ...suggestedConnectors].map((c) => [String(c?.id || ''), c]))
		const mappedOutputEdges = graphEdges.filter((e) => String(e?.sourceId || '') === String(sinkConnectorId || ''))

		rIntoInsp((host) =>
			renderDestinationInspector({
				host,
				d,
				mode,
				intent,
				mappedOutputEdges,
				connectorById: connectorByIdMap,
				// WO-276: `ctx.load()` short-circuits to the module-level payload cache for 5 s
				// (device-view-render.js), so a second destination edit committed within that window
				// re-rendered the inspector from the *pre-edit* payload and silently reverted the field
				// that was just saved (classically: set width, then set height → height snaps back to
				// 1080). The PATCH itself always succeeded; only the read-back was stale. A mutation
				// must never be answered from a cache written before it.
				patchDestination: (did, patch) =>
					Actions.patchDestination(did, patch).then(() => {
						ctx.setCasparRestartDirty(true)
						return ctx.load({ forceRefresh: true })
					}),
				// WO-490: the removal is a mutation too — same reason as patchDestination above.
				removeDestination: (did) =>
					Actions.removeDestination(did).then(() => {
						state.selectedDestinationId = null
						ctx.setCasparRestartDirty(true)
						return ctx.load({ forceRefresh: true })
					}),
				currentSettings: state.currentSettings,
				updateDestinationOutputLayer: ctx.updateDestinationOutputLayer,
				lastPayload: state.lastPayload,
				onWebpageHostApplied: () => {
					if (state.selectedDestinationId) ctx.selectDestinationById(state.selectedDestinationId)
				},
				onHostInputRemoved: async (_dest, removeResult) => {
					state.selectedDestinationId = null
					state.selectedConnectorId = null
					state.selectedKey = null
					ctx.setCasparRestartDirty(true)
					try {
						await settingsState.load()
					} catch {
						/* best-effort */
					}
					if (removeResult?.payload) {
						state.lastPayload = mergeSettingsIntoDeviceViewPayload(
							{ ...state.lastPayload, ...removeResult.payload },
							settingsState.getSettings?.() || state.currentSettings,
						)
					}
					ctx.rIntoInsp?.((h) => {
						h.replaceChildren(
							Object.assign(document.createElement('p'), {
								className: 'device-view__status',
								textContent: 'DeckLink input removed.',
							}),
						)
					})
					ctx.renderFromState?.({ restoreInspector: false })
					ctx.updateUI?.()
					await ctx.load({ restoreInspector: false })
					ctx.setStatus?.(ctx.statusEl, 'DeckLink input removed', true)
				},
			}),
		)
		ctx.updateUI()
	}
}
