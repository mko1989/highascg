import {
	connectorById,
	connectorRole,
	orderEdgeForDeviceView,
	friendlyConnectorLabel,
} from './device-view-helpers.js'
import { setStatus } from './device-view-ui-utils.js'
import { renderCableOverlay } from './device-view-cables.js'
import { describeCableRejection, cableReasonFromError } from '../lib/device-view-cable-messages.js'
import {
	isUnknownCableConnectorError,
	resolveCableEdgeIds,
	findGpuSinkCableConflict,
	canonicalCableConnectorId,
} from '../lib/device-view-cable-resolve.js'
import {
	pickRegrabCandidate,
	planCableRegrab,
	planRegrabRollback,
	describeRegrabRestore,
} from '../lib/device-view-cable-regrab.js'
import { createSnapshotPrewarmer } from '../lib/device-view-snapshot-prewarm.js'
import { gpuPhysicalPortCableId } from '../lib/device-view-gpu-port-list.js'
import { resolveGpuPhysicalScreenIndex, resolveGpuScreenNumber } from './device-view-inspector-gpu-resolve.js'
import {
	screenConsumerSeedSettingsPatch,
	shouldSeedScreenConsumerDefaults,
	multiviewConsumerDefaultsSettingsPatch,
	shouldSeedMultiviewAlwaysOnTopDefault,
} from '../lib/screen-consumer-defaults.js'
import {
	gpuOutputBindingFromCableSource,
	gpuScreenInheritedSettingsPatch,
	mergeSettingsPatches,
	resolveCableSourceResolution,
} from '../lib/device-view-gpu-source-inherit.js'
import { cableSinkAffectsCasparRestart, isStreamingDedicatedOutputChannel } from '../lib/caspar-restart-dirty-policy.js'
import { saveVirtualCameraConfig, stopVirtualCamera } from '../lib/virtual-camera-state.js'
import * as Actions from './device-view-actions.js'

export function registerDeviceViewCable(ctx) {
	const { refs, state } = ctx
	const { wrap, clearCableBtn, messinessSlider, simpleWiringCk, cableOverlay, rearPanel, statusEl } = refs

	ctx.getCOCtx = () => ({
		cableOverlay,
		bands: rearPanel,
		surfaceEl: wrap,
		lastPayload: state.lastPayload,
		hoveredEdgeId: state.hoveredEdgeId,
		selectedEdgeId: state.selectedEdgeId,
		selectedConnectorId: state.selectedConnectorId,
		selectEdgeById: ctx.selectEdgeById,
		cableSourceId: state.cableSourceId,
		cablePointer: state.cablePointer,
		messiness: messinessSlider.value,
		simpleWiring: simpleWiringCk.checked,
		regrabEdgeId: state.cableRegrab?.edgeId || null,
	})

	// WO-278 (A): the dominant cost of applying a cable is the server's cold live-hardware
	// snapshot (measured 274 ms median / 1770 ms worst, vs 43 ms warm). Arming a cable is a
	// reliable warning that a mutation is ~1 s away, so warm the cache during the gesture.
	// The timer exists only between arm and commit/cancel — no idle polling.
	const snapshotPrewarm = createSnapshotPrewarmer({ warm: () => Actions.prewarmDeviceViewSnapshot() })

	/** Leave cable/re-grab mode. Client-side only: no intermediate state was ever persisted. */
	ctx.clearCableGesture = () => {
		state.cableSourceId = null
		state.cablePointer = null
		state.cableRegrab = null
		snapshotPrewarm.stop()
	}

	ctx.pushUndo = () => {
		if (!state.lastPayload?.graph || !state.currentSettings?.screenDestinations) return
		state.undoStack.push({
			graph: JSON.parse(JSON.stringify(state.lastPayload.graph)),
			screenDestinations: JSON.parse(
				JSON.stringify(
					state.currentSettings.screenDestinations ||
						state.lastPayload.screenDestinations ||
						{ version: 1, destinations: [], edidNotes: '' },
				),
			),
		})
		if (state.undoStack.length > 50) state.undoStack.shift()
	}

	ctx.undoLastCableAction = async () => {
		if (!state.undoStack.length) {
			setStatus(statusEl, 'Nothing to undo', false)
			return
		}
		const { graph, screenDestinations } = state.undoStack.pop()
		try {
			await Actions.saveSettingsPatch({ deviceGraph: graph, screenDestinations })
			ctx.setCasparRestartDirty(true)
			await ctx.load()
			setStatus(statusEl, 'Undo successful', true)
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	ctx.updateUI = () => {
		for (const el of wrap.querySelectorAll(
			'.device-view__port--selected, .device-view__port--cable-armed, .device-view__connector-target--valid, .device-view__connector-target--invalid, .device-view__simple-node--selected, .device-view__simple-node--armed',
		)) {
			el.classList.remove(
				'device-view__port--selected',
				'device-view__port--cable-armed',
				'device-view__connector-target--valid',
				'device-view__connector-target--invalid',
				'device-view__simple-node--selected',
				'device-view__simple-node--armed',
			)
		}
		if (state.selectedKey) wrap.querySelector(`[data-port-key="${state.selectedKey}"]`)?.classList.add('device-view__port--selected')
		if (state.selectedConnectorId) {
			const sel = wrap.querySelector(`[data-connector-id="${state.selectedConnectorId}"]`)
			sel?.classList.add('device-view__port--selected')
			sel?.closest('.device-view__simple-node')?.classList.add('device-view__simple-node--selected')
		}
		if (state.cableSourceId) {
			const armed = wrap.querySelector(`[data-connector-id="${state.cableSourceId}"]`)
			armed?.classList.add('device-view__port--cable-armed')
			armed?.closest('.device-view__simple-node')?.classList.add('device-view__simple-node--armed')
			const source = String(state.cableSourceId)
			for (const el of wrap.querySelectorAll('[data-connector-id]')) {
				const targetId = String(el.getAttribute('data-connector-id') || '').trim()
				if (!targetId || targetId === source) continue
				const allowed = !!orderEdgeForDeviceView(source, targetId, (cid) => connectorById(state.lastPayload, cid))
				el.classList.add(allowed ? 'device-view__connector-target--valid' : 'device-view__connector-target--invalid')
			}
		}
		clearCableBtn.style.display = state.cableSourceId ? '' : 'none'
		renderCableOverlay(ctx.getCOCtx())
	}

	/**
	 * WO-278 (B): click a cable to select it, then click either of its ends to lift that end
	 * off its port. The far end stays anchored and the whole existing arm/complete machinery
	 * (ghost cable, valid/invalid target highlighting, click-elsewhere-to-cancel) is reused by
	 * pointing `cableSourceId` at the anchor.
	 * @returns {boolean} true if a re-grab was started
	 */
	ctx.tryBeginCableRegrab = (connectorId) => {
		if (state.cableSourceId || state.cableRegrab) return false
		if (!state.selectedEdgeId) return false
		// WO-303 (A): edges store canonical graph ids (`gpu_p0`), but a click can hand us a UI id
		// for the same socket (`gpu_p0__DP_1`, `DP-1`). `planCableRegrab` canonicalises its drop
		// target, but the hit-test that decides whether a re-grab starts at all did not — so on a
		// bracket-split GPU jack the endpoint under the cursor never matched its own cable.
		const hitId = canonicalCableConnectorId(state.lastPayload, connectorId) || connectorId
		const grab = pickRegrabCandidate(state.lastPayload?.graph?.edges, hitId, {
			selectedEdgeId: state.selectedEdgeId,
		})
		if (!grab) return false
		state.cableRegrab = grab
		state.cableSourceId = grab.anchorId
		state.cablePointer = null
		state.suppressDocCableClickUntil = Date.now() + 100
		snapshotPrewarm.start()
		ctx.updateUI()
		setStatus(statusEl, 'Cable end grabbed: click another connector to move it, or click empty space to restore.', true)
		return true
	}

	ctx.beginOrCompleteCable = (k, c, d) => {
		if (!c) return
		if (state.cableSourceId && state.cableSourceId !== c) {
			void ctx.tryAddCable(c)
			return
		}
		// Re-grab takes priority over starting a new cable, but only when the operator has
		// already picked out which cable they mean by selecting it.
		if (ctx.tryBeginCableRegrab(c)) return
		const conn = connectorById(state.lastPayload, c)
		const role = connectorRole(conn)
		if (role !== 'destination_out' && role !== 'caspar_out' && role !== 'pixel_mapping_out') {
			setStatus(statusEl, 'Cable can start only from destination output or output connector.', false)
			return
		}
		ctx.selectKey(k, { ...d, connectorId: c })
		state.cableSourceId = c
		state.suppressDocCableClickUntil = Date.now() + 100
		// WO-278 (A): warm the server snapshot while the operator picks a target.
		snapshotPrewarm.start()
		ctx.updateUI()
		setStatus(statusEl, 'Cable armed: click another connector dot to connect', true)
	}

	/**
	 * WO-278 (B): commit a held cable end onto `targetId`.
	 *
	 * Validation runs BEFORE anything is written. Anything short of a valid new target is a
	 * restore, which costs nothing because the original edge was never removed. If the server
	 * rejects the new edge after the old one is gone, the original is put back — a re-grab can
	 * never end in a silent disconnect.
	 */
	ctx.commitCableRegrab = async (targetId) => {
		const grab = state.cableRegrab
		const plan = planCableRegrab({
			grab,
			targetId,
			orderEdge: (a, b) => orderEdgeForDeviceView(a, b, (cid) => connectorById(state.lastPayload, cid)),
			findSinkConflict: (sinkId) => findGpuSinkCableConflict(state.lastPayload, sinkId),
			canonicalize: (cid) => canonicalCableConnectorId(state.lastPayload, cid),
		})

		if (plan.action !== 'retarget') {
			ctx.clearCableGesture()
			// Nothing was persisted, so "restore" is just redrawing the edge we had hidden.
			ctx.updateUI()
			if (plan.action === 'restore') setStatus(statusEl, describeRegrabRestore(plan), plan.reason === 'unchanged')
			return
		}

		const rollback = planRegrabRollback(grab)
		ctx.clearCableGesture()
		try {
			ctx.pushUndo()
			// Remove first: moving a SOURCE end re-uses the same sink, and one-cable-per-sink
			// would reject the new edge while the old one still holds it.
			const removed = await Actions.removeEdge(plan.removeEdgeId)
			if (removed?.graph) state.lastPayload.graph = removed.graph
			let res
			try {
				res = await Actions.addCable(plan.sourceId, plan.sinkId)
				if (res?.error) throw new Error(describeCableRejection(res.error))
			} catch (addErr) {
				if (rollback) {
					try {
						const back = await Actions.addCable(rollback.sourceId, rollback.sinkId)
						if (back?.graph) state.lastPayload.graph = back.graph
					} catch {
						/* surfaced below; the forced reload shows the operator the real graph */
					}
				}
				throw addErr
			}
			if (res?.graph) state.lastPayload.graph = res.graph
			if (state.selectedEdgeId === plan.removeEdgeId) state.selectedEdgeId = null
			const sinkConn = connectorById(state.lastPayload, plan.sinkId)
			if (
				cableSinkAffectsCasparRestart(sinkConn, {
					dedicatedStreamingChannel: isStreamingDedicatedOutputChannel(state.currentSettings),
				})
			) {
				ctx.setCasparRestartDirty(true)
			}
			setStatus(statusEl, `Cable moved to ${friendlyConnectorLabel(state.lastPayload, plan.sinkId)}`, true)
			// WO-276: a read issued right after a write must never be answered from the 5 s cache.
			await ctx.load({ forceRefresh: true })
		} catch (e) {
			setStatus(statusEl, `Cable move failed — original connection restored: ${cableReasonFromError(e)}`, false)
			ctx.updateUI()
			await ctx.load({ forceRefresh: true })
		}
	}

	ctx.tryAddCable = async (id) => {
		if (state.cableRegrab) {
			await ctx.commitCableRegrab(id)
			return
		}
		const o = orderEdgeForDeviceView(state.cableSourceId, id, (cid) => connectorById(state.lastPayload, cid))
		if (!o) {
			setStatus(statusEl, 'These connectors cannot be cabled together (wrong roles or direction).', false)
			ctx.clearCableGesture()
			ctx.updateUI()
			return
		}
		const resolved = resolveCableEdgeIds(state.lastPayload, o.sourceId, o.sinkId)
		const sinkConflict = findGpuSinkCableConflict(state.lastPayload, resolved.sinkId)
		if (sinkConflict) {
			const sinkLabel = friendlyConnectorLabel(state.lastPayload, resolved.sinkId)
			const srcLabel = friendlyConnectorLabel(state.lastPayload, sinkConflict.sourceId)
			const clickedPort = gpuPhysicalPortCableId(id)
			const bracketNote =
				clickedPort &&
				resolved.sinkId &&
				clickedPort === resolved.sinkId &&
				/__/.test(String(id))
					? ' (DP A/B names on the same physical socket share one cable slot)'
					: ''
			setStatus(
				statusEl,
				`${sinkLabel} already has a cable from ${srcLabel}. Remove that cable first.${bracketNote}`,
				false,
			)
			ctx.clearCableGesture()
			ctx.focusConnectorById(id)
			ctx.updateUI()
			return
		}
		try {
			ctx.pushUndo()
			const preflight = await Actions.ensureCableConnectorsInSavedGraph(
				state.lastPayload,
				state.currentSettings,
				resolved.sourceId,
				resolved.sinkId,
			)
			if (preflight?.graph) state.lastPayload.graph = preflight.graph
			if (preflight?.fresh) {
				state.lastPayload = {
					...preflight.fresh,
					gpuPhysicalTopology: state.lastPayload.gpuPhysicalTopology,
				}
			}
			let res
			try {
				res = await Actions.addCable(resolved.sourceId, resolved.sinkId)
			} catch (firstErr) {
				if (!isUnknownCableConnectorError(firstErr?.message || firstErr)) throw firstErr
				const recovered = await Actions.recoverDeviceGraphForCable(
					state.lastPayload,
					state.currentSettings,
					resolved.sourceId,
					resolved.sinkId,
				)
				if (recovered.topology) {
					state.lastPayload = { ...state.lastPayload, gpuPhysicalTopology: recovered.topology }
					if (state.currentSettings) {
						state.currentSettings = { ...state.currentSettings, gpuPhysicalTopology: recovered.topology }
					}
				}
				if (recovered.fresh) {
					state.lastPayload = {
						...recovered.fresh,
						gpuPhysicalTopology: recovered.topology || state.lastPayload.gpuPhysicalTopology,
					}
				} else if (recovered.graph) {
					state.lastPayload.graph = recovered.graph
				}
				res = await Actions.addCable(resolved.sourceId, resolved.sinkId)
			}
			if (res?.error) {
				setStatus(
					statusEl,
					`${describeCableRejection(res.error)} (${resolved.sourceId} → ${resolved.sinkId})`,
					false,
				)
				ctx.clearCableGesture()
				ctx.focusConnectorById(id)
				ctx.updateUI()
				return
			}
			if (res?.graph) state.lastPayload.graph = res.graph
			const sinkConn = connectorById(state.lastPayload, resolved.sinkId)
			if (sinkConn?.kind === 'gpu_out' && state.currentSettings) {
				const cs =
					state.currentSettings.casparServer && typeof state.currentSettings.casparServer === 'object'
						? state.currentSettings.casparServer
						: {}
				const screenN = resolveGpuScreenNumber(sinkConn, state.lastPayload)
				const portN = resolveGpuPhysicalScreenIndex(sinkConn, state.lastPayload)
				const source = resolveCableSourceResolution(state.lastPayload, resolved.sourceId)
				const outputBinding = gpuOutputBindingFromCableSource(state.lastPayload, resolved.sourceId)
				const isMultiviewOutput = outputBinding?.type === 'multiview'
				const settingsPatches = []
				if (shouldSeedScreenConsumerDefaults(cs, portN)) {
					settingsPatches.push(screenConsumerSeedSettingsPatch(cs, portN))
				}
				if (isMultiviewOutput && shouldSeedMultiviewAlwaysOnTopDefault(cs)) {
					settingsPatches.push(multiviewConsumerDefaultsSettingsPatch())
				}
				if (source) {
					settingsPatches.push(gpuScreenInheritedSettingsPatch(screenN, source))
				}
				if (settingsPatches.length) {
					await Actions.saveSettingsPatch(mergeSettingsPatches(...settingsPatches))
				}
				if (source) {
					const connectorPatch = { caspar: { mode: source.videoMode } }
					if (outputBinding) connectorPatch.caspar.outputBinding = outputBinding
					await Actions.updateConnector(resolved.sinkId, connectorPatch)
				}
			}
			ctx.clearCableGesture()
			// WO-172 T172.3: stream_out/record_out cabling only needs the restart flag in
			// dedicated-output-channel mode (setupAllRouting must re-run to move the PLAY route://
			// binding); attach mode and record are config-write-only (A172.2 decision matrix).
			if (cableSinkAffectsCasparRestart(sinkConn, { dedicatedStreamingChannel: isStreamingDedicatedOutputChannel(state.currentSettings) })) {
				ctx.setCasparRestartDirty(true)
			}
			// WO-276/WO-278: a plain ctx.load() here is answered from the 5 s payload cache and
			// re-assigns state.lastPayload to the module-level object captured BEFORE this write,
			// throwing away the graph the POST just returned — the new cable would vanish until
			// some later fetch. A mutation must always force the refresh.
			ctx.load({ forceRefresh: true })
		} catch (e) {
			setStatus(statusEl, cableReasonFromError(e), false)
			ctx.clearCableGesture()
			ctx.focusConnectorById(id)
			ctx.updateUI()
		}
	}

	ctx.removeEdge = async (id) => {
		try {
			ctx.pushUndo()
			const res = await Actions.removeEdge(id)
			if (res?.graph) state.lastPayload.graph = res.graph
			if (state.selectedEdgeId === id) state.selectedEdgeId = null
			ctx.load({ forceRefresh: true }) // WO-276: never read a mutation back from the cache
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	ctx.resetCabling = async () => {
		if (!confirm('Are you sure you want to remove ALL cable connections?')) return
		try {
			ctx.pushUndo()
			const res = await Actions.removeAllEdges()
			if (res?.graph) state.lastPayload.graph = res.graph
			state.selectedEdgeId = null
			ctx.setCasparRestartDirty(true)
			ctx.load({ forceRefresh: true }) // WO-276: never read a mutation back from the cache
			setStatus(statusEl, 'All cabling removed', true)
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	ctx.updateDestinationOutputLayer = async (edgeId, outputLayer) => {
		if (!state.lastPayload?.graph || !edgeId) return
		const g = JSON.parse(JSON.stringify(state.lastPayload.graph))
		const edges = Array.isArray(g.edges) ? g.edges : []
		const idx = edges.findIndex((e) => String(e?.id || '') === String(edgeId))
		if (idx < 0) return
		edges[idx].note = JSON.stringify({
			outputLayer: Math.max(1, parseInt(String(outputLayer || 1), 10) || 1),
		})
		g.edges = edges
		try {
			await Actions.saveDeviceGraph(g)
			ctx.setCasparRestartDirty(true)
			ctx.load()
		} catch (e) {
			setStatus(statusEl, `Output mapping update failed: ${e.message}`, false)
		}
	}

	ctx.setDecklinkAsDestinationOutput = async (connectorId, destination, intent) => {
		if (!connectorId) return
		try {
			const mode = String(destination?.mode || intent?.mode || 'pgm_prv')
			const mainIdx = Number.isFinite(intent?.mainScreenIndex)
				? intent.mainScreenIndex
				: Math.max(0, parseInt(String(destination?.mainScreenIndex ?? 0), 10) || 0)
			const outputBinding =
				mode === 'multiview' ? { type: 'multiview' } : { type: 'screen', index: Math.max(1, mainIdx + 1) }
			await Actions.updateConnector(connectorId, { caspar: { ioDirection: 'out', outputBinding } })
			setStatus(statusEl, `DeckLink ${connectorId} mapped to destination output`, true)
			ctx.setCasparRestartDirty(true)
			await ctx.load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	async function pruneConnectorFromGraph(connectorId) {
		const cid = String(connectorId || '').trim()
		if (!cid || !state.lastPayload?.graph) return
		const g = JSON.parse(JSON.stringify(state.lastPayload.graph))
		g.edges = (Array.isArray(g.edges) ? g.edges : []).filter(
			(e) => String(e.sourceId) !== cid && String(e.sinkId) !== cid,
		)
		g.connectors = (Array.isArray(g.connectors) ? g.connectors : []).filter((c) => String(c?.id) !== cid)
		await Actions.saveDeviceGraph(g)
		if (state.selectedConnectorId === cid) {
			state.selectedConnectorId = null
			state.selectedKey = null
		}
	}

	ctx.removeStreamOutputConnector = async (id) => {
		const cid = String(id || '').trim()
		if (!cid) return
		try {
			const cur = Array.isArray(state.currentSettings?.streamOutputs) ? state.currentSettings.streamOutputs : []
			await Actions.saveSettingsPatch({ streamOutputs: cur.filter((s) => String(s?.id) !== cid) })
			await pruneConnectorFromGraph(cid)
			// WO-172 T172.3: fixes the WO-81 regression — this used to unconditionally dirty the
			// restart flag. Only dedicated-output-channel mode needs it (same rule as cabling above);
			// attach mode's next Start already resolves from fresh config.
			if (isStreamingDedicatedOutputChannel(state.currentSettings)) ctx.setCasparRestartDirty(true)
			setStatus(statusEl, 'Stream output removed', true)
			await ctx.load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	ctx.removeRecordOutputConnector = async (id) => {
		const cid = String(id || '').trim()
		if (!cid) return
		try {
			const cur = Array.isArray(state.currentSettings?.recordOutputs) ? state.currentSettings.recordOutputs : []
			await Actions.saveSettingsPatch({ recordOutputs: cur.filter((s) => String(s?.id) !== cid) })
			await pruneConnectorFromGraph(cid)
			// WO-172 T172.3: fixes the WO-81 regression — record has no "dedicated channel" concept
			// (resolveRecordSourceChannel always resolves live from fresh config at record-start), so
			// removing a record output connector never needs the restart flag.
			setStatus(statusEl, 'Record output removed', true)
			await ctx.load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	ctx.removeAudioOutputConnector = async (id) => {
		const cid = String(id || '').trim()
		if (!cid) return
		try {
			const cur = Array.isArray(state.currentSettings?.audioOutputs) ? state.currentSettings.audioOutputs : []
			await Actions.saveSettingsPatch({ audioOutputs: cur.filter((s) => String(s?.id) !== cid) })
			await pruneConnectorFromGraph(cid)
			ctx.setCasparRestartDirty(true)
			setStatus(statusEl, 'Audio output removed', true)
			await ctx.load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}

	ctx.removeVirtualCamOutputConnector = async (id) => {
		const cid = String(id || 'vcam_1').trim() || 'vcam_1'
		try {
			try {
				await stopVirtualCamera({ persist: false })
			} catch {
				/* best-effort stop before hide */
			}
			await saveVirtualCameraConfig({ showInDeviceView: false, enabled: false }, { persist: true })
			await pruneConnectorFromGraph(cid)
			setStatus(statusEl, 'Virtual camera output removed', true)
			await ctx.load()
		} catch (e) {
			setStatus(statusEl, e.message, false)
		}
	}
}
