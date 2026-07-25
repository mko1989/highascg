import { setStatus } from './device-view-ui-utils.js'
import { cableSinkAffectsCasparRestart, isStreamingDedicatedOutputChannel } from '../lib/caspar-restart-dirty-policy.js'
import { saveVirtualCameraConfig, stopVirtualCamera } from '../lib/virtual-camera-state.js'
import * as Actions from './device-view-actions.js'

export function registerDeviceViewCableOutputs(ctx) {
	const { refs, state } = ctx
	const { statusEl } = refs

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
