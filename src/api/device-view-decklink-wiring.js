'use strict'

const { normalizeDeviceGraph } = require('../config/device-graph')
const { normalizeDecklinkIoDirection, DECKLINK_IO_UNASSIGNED } = require('../config/decklink-io-direction')
const { destinationsFromConfig } = require('../config/screen-destinations')
const {
	parseDecklinkDeviceIndex,
	readDecklinkKeyFillFromConnectorCaspar,
	writeDecklinkKeyFillToCasparServer,
} = require('../config/decklink-key-fill')

/**
 * @param {object} ctx
 * @param {object} casparServer
 * @param {number} slot
 * @param {number} devNum
 */
function clearDecklinkInputSlot(casparServer, slot, devNum) {
	if (!casparServer || slot < 1 || slot > 8) return
	const cur = parseInt(String(casparServer[`decklink_input_${slot}_device`] ?? 0), 10) || 0
	if (cur === devNum || cur <= 0) {
		casparServer[`decklink_input_${slot}_device`] = 0
		casparServer[`decklink_input_${slot}_direction`] = DECKLINK_IO_UNASSIGNED
	}
	let maxSlot = 0
	for (let i = 1; i <= 8; i++) {
		const d = parseInt(String(casparServer[`decklink_input_${i}_device`] ?? 0), 10) || 0
		const dir = normalizeDecklinkIoDirection({ ioDirection: casparServer[`decklink_input_${i}_direction`] })
		if (d > 0 && dir === 'in') maxSlot = i
	}
	casparServer.decklink_input_count = maxSlot
}

/**
 * When a destination feed is cabled to DeckLink SDI, mark the port as PGM/MV output.
 * @param {object} ctx
 * @param {object} graph
 * @param {string} sourceId
 * @param {string} sinkId
 * @returns {{ graph: object, changed: boolean }}
 */
function applyDecklinkOutputOnDestinationEdge(ctx, graph, sourceId, sinkId) {
	const g = normalizeDeviceGraph(graph)
	const byId = new Map((g.connectors || []).map((c) => [String(c?.id || ''), c]))
	const sink = byId.get(String(sinkId || ''))
	const source = byId.get(String(sourceId || ''))
	if (!sink || sink.kind !== 'decklink_io') return { graph: g, changed: false }
	if (normalizeDecklinkIoDirection(sink.caspar) === 'in') return { graph: g, changed: false }

	let destId = ''
	if (source?.kind === 'destination_in') destId = String(source.externalRef || '').trim()
	else if (String(sourceId || '').startsWith('dst_in_')) destId = String(sourceId).slice('dst_in_'.length).trim()
	if (!destId) return { graph: g, changed: false }

	const destinations = destinationsFromConfig(ctx.config || {})
	const dest = destinations.find((d) => String(d?.id || '') === destId)
	if (!dest) return { graph: g, changed: false }

	const mainIdx = Math.max(0, parseInt(String(dest.mainScreenIndex ?? 0), 10) || 0)
	const mode = String(dest.mode || 'pgm_prv')
	const outputBinding =
		mode === 'multiview' ? { type: 'multiview' } : { type: 'screen', index: Math.max(1, mainIdx + 1) }
	const devNum = parseInt(String(sink.externalRef || '0'), 10) || 0
	const m = String(sink.id || '').match(/^dlsdi_(\d+)$/)
	const slot = m ? parseInt(m[1], 10) : devNum

	const connectors = (g.connectors || []).map((c) => {
		if (String(c?.id || '') !== String(sink.id || '')) return c
		return {
			...c,
			caspar: {
				...(c.caspar || {}),
				ioDirection: 'out',
				outputBinding,
				bus: mode === 'multiview' ? 'multiview' : 'pgm',
				mainIndex: mode === 'multiview' ? 0 : mainIdx,
			},
		}
	})

	const cs = { ...((ctx.config && ctx.config.casparServer) || {}) }
	if (devNum > 0 && Number.isFinite(slot) && slot > 0) clearDecklinkInputSlot(cs, slot, devNum)

	if (mode === 'multiview') {
		cs.multiview_decklink_device = devNum
		const keyFill = readDecklinkKeyFillFromConnectorCaspar(sink.caspar)
		writeDecklinkKeyFillToCasparServer(cs, 'multiview_', {
			fillDevice: devNum,
			keyDevice: keyFill.enabled ? keyFill.keyDevice : 0,
			keyer: keyFill.keyer,
		})
	} else {
		const screen = Math.min(8, Math.max(1, mainIdx + 1))
		cs[`screen_${screen}_decklink_device`] = devNum
		cs[`screen_${screen}_decklink_replace_screen`] = false
		const keyFill = readDecklinkKeyFillFromConnectorCaspar(sink.caspar)
		writeDecklinkKeyFillToCasparServer(cs, `screen_${screen}_`, {
			fillDevice: devNum,
			keyDevice: keyFill.enabled ? keyFill.keyDevice : 0,
			keyer: keyFill.keyer,
		})
	}

	ctx.config.deviceGraph = { ...g, connectors }
	ctx.config.casparServer = cs
	if (ctx.configManager) {
		ctx.configManager.save({ ...ctx.configManager.get(), deviceGraph: ctx.config.deviceGraph, casparServer: cs })
		Object.assign(ctx.config, ctx.configManager.get())
	}

	return { graph: ctx.config.deviceGraph, changed: true }
}

/** @type {NodeJS.Timeout | null} */
let deviceViewCasparSyncTimer = null

/**
 * WO-172 T172.1: best-effort label for a sync failure/warning — which stream_out/record_out
 * edges (if any) were involved, so error logs are actionable instead of a bare exception message.
 * @param {object} ctx
 * @returns {string}
 */
function summarizeStreamRecordEdgesForLog(ctx) {
	try {
		const { collectDestinationOutputEdges } = require('../config/device-graph-output-mapping')
		const edges = collectDestinationOutputEdges(ctx?.config || {}).filter(
			(e) => e.sink?.kind === 'stream_out' || e.sink?.kind === 'record_out',
		)
		if (!edges.length) return 'no stream/record edges in graph'
		return edges.map((e) => `${e.sink.kind}:${e.sink.id || '?'}<-dst:${e.destinationId}`).join(', ')
	} catch {
		return 'edge summary unavailable'
	}
}

/**
 * Debounced Caspar regen after Device View output wiring (all roles).
 *
 * NOTE the absence of `{ allowRestart: true }`: this is the graph-mutation path (add/remove a
 * cable, retarget a DeckLink port). It persists config and nothing more — see
 * {@link syncDeviceViewToCaspar}.
 *
 * @param {object} ctx
 * @param {number} [delayMs]
 */
function scheduleDeviceViewCasparSync(ctx, delayMs = 1500) {
	if (deviceViewCasparSyncTimer) clearTimeout(deviceViewCasparSyncTimer)
	deviceViewCasparSyncTimer = setTimeout(() => {
		deviceViewCasparSyncTimer = null
		void syncDeviceViewToCaspar(ctx).catch((e) => {
			// WO-172 T172.1: was a silent 'warn' — this is the exact failure mode that let
			// stream/record source-channel sync silently die in production (missing export,
			// TypeError swallowed here). Sync failures are error-level now, with the edge involved.
			if (typeof ctx.log === 'function') {
				ctx.log('error', `[device-view] caspar sync failed (${summarizeStreamRecordEdgesForLog(ctx)}): ${e?.message || e}`)
			}
		})
	}, delayMs)
}

/**
 * Persist Device View output wiring into config; restart Caspar ONLY when explicitly asked.
 *
 * WO-303: this used to end in an unconditional `applyCasparConfigToDiskAndRestart(ctx)` whenever
 * the wiring touched a `casparServer` key. Cabling a screen destination to a DeckLink output is
 * exactly such a change (`applyDecklinkOutputOnDestinationEdge` writes
 * `screen_N_decklink_device` / `screen_N_decklink_replace_screen`), so a single cable click
 * bounced live playout ~1.5 s later with the operator never touching "Apply & restart".
 *
 * A graph edit is now config-write-only. The generated casparcg.config is regenerated and Caspar
 * is bounced by the explicit operator paths only (the Apply & restart button →
 * `executeApplyPlan`, or `/api/caspar-config` apply). `ctx.casparApplyPending` records that the
 * on-disk Caspar config is behind the graph, which is what the orange Apply button reflects.
 *
 * @param {object} ctx
 * @param {{ allowRestart?: boolean }} [opts] - `allowRestart: true` is the operator explicitly
 *   asking for a restart. Never pass it from a graph-mutation handler.
 * @returns {Promise<{ casparServerChanged: boolean, restarted: boolean, restartDeferred: boolean }>}
 */
async function syncDeviceViewToCaspar(ctx, opts = {}) {
	const { applyDestinationOutputEdgesToCasparConfig } = require('./device-view-apply')
	const mappingRes = applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })
	if (mappingRes && Array.isArray(mappingRes.warnings) && mappingRes.warnings.length && typeof ctx.log === 'function') {
		for (const w of mappingRes.warnings) {
			ctx.log('warn', `[device-view] caspar sync: ${w.message || w.code || 'mapping warning'} (target=${w.target || ''}, destinationId=${w.destinationId || ''})`)
		}
	}
	// WO-172 T172.1/T172.3: only DeckLink/screen output mapping (casparServer keys) requires the
	// full config write + Caspar restart. Stream/record/vcam source-channel sync (videoSource,
	// recordOutputs[].source, virtualCamera.channel) already persisted above is config-write-only —
	// the next Start/PLAY reads fresh config, no restart needed (A172.1; matches the WO-81
	// stream_out/record_out/v4l2_out restart-exempt policy in client/lib/caspar-restart-dirty-policy.js).
	if (!mappingRes || !mappingRes.casparServerChanged) {
		return { casparServerChanged: false, restarted: false, restartDeferred: false }
	}

	// WO-303: the casparServer keys are already persisted by the mapping step above. Everything
	// below this point restarts Caspar, and Caspar is on air — so it only runs when the operator
	// asked for it. A cable click marks the config pending and stops here.
	if (opts.allowRestart !== true) {
		ctx.casparApplyPending = true
		if (typeof ctx.log === 'function') {
			ctx.log(
				'info',
				'[device-view] output wiring changed casparServer — config saved, Caspar restart deferred to the operator (Apply & restart)',
			)
		}
		try {
			if (typeof ctx._wsBroadcast === 'function') ctx._wsBroadcast('caspar-apply-pending', { pending: true })
		} catch {
			/* optional */
		}
		return { casparServerChanged: true, restarted: false, restartDeferred: true }
	}

	try {
		const { isFollowerRole, syncFollowerDeviceViewToCaspar } = require('../replication/follower-machine-profile')
		if (isFollowerRole(ctx)) {
			await syncFollowerDeviceViewToCaspar(ctx)
			return { casparServerChanged: true, restarted: true, restartDeferred: false }
		}
	} catch {
		/* optional */
	}
	const { applyCasparConfigToDiskAndRestart } = require('./routes-caspar-config')
	await applyCasparConfigToDiskAndRestart(ctx)
	return { casparServerChanged: true, restarted: true, restartDeferred: false }
}

/**
 * WO-491: {@link applyDecklinkOutputOnDestinationEdge} writes POSITIONAL state in two places —
 * `connector.caspar.outputBinding = { type: 'screen', index: mainScreenIndex + 1 }` and
 * `casparServer.screen_N_decklink_device`. Deleting the destination prunes only the graph EDGE, so
 * both survived; and because `normalizeScreenDestinations` COMPACTS `mainScreenIndex`, the next
 * destination to slide into that index inherited a DeckLink output it was never cabled to. Clearing
 * the flat key alone is not enough — the generator's legacy fallback re-asserts it from the
 * connector binding whenever the port has no incoming edge — so both have to go.
 *
 * This is the deletion half of WO-275, which only released a device when some OTHER target claimed
 * it; nothing claims a deleted destination's DeckLink. Flat keys are cleared only where they still
 * name this same device, and tiled (LED-wall) screens are skipped — they own their device through
 * `screen_N_decklink_tiles`, exactly as `releaseDecklinkDeviceFromOtherTargets` treats them.
 *
 * Must run BEFORE `pruneDestinationFromGraph`: it reads the edges that pruning is about to drop.
 * @param {object} ctx
 * @param {object} graph - graph still containing the destination's edges
 * @param {string} destinationId
 * @returns {{ graph: object, casparServerChanged: boolean }}
 */
function releaseDecklinkOutputsForDestination(ctx, graph, destinationId) {
	const { destinationInputConnectorIds } = require('../config/device-graph-edges')
	const g = normalizeDeviceGraph(graph)
	const srcIds = destinationInputConnectorIds(g, destinationId)
	return releaseDecklinkSinksOfSources(ctx, g, srcIds)
}

/**
 * WO-494: same release, for a pixel-mapping node's DeckLinks.
 *
 * Deleting a mapping node had NO server handler — the client rewrote the graph and POSTed the whole
 * thing, so nothing ever released these bindings. It stayed invisible because `screen_N_decklink_tiles`
 * is generate-time only (`pixel-mapping-config.js` writes it into `merged` and `delete`s
 * `screen_N_decklink_device` on the same pass) and the DeckLink projection refuses to touch a tiled
 * screen — so while the node exists, the stale flat key is MASKED. Remove the node and the mask goes.
 *
 * A node's outputs are subregions of ONE program channel, so every port it feeds carries the same
 * `outputBinding {type:'screen', index}` and they collide on a single `screen_N_decklink_device`
 * slot — which is why the owner saw the LAST card (DeckLink 2) survive rather than the first.
 *
 * Must run BEFORE the node's connectors/edges are pruned.
 * @param {object} ctx
 * @param {object} graph - graph still containing the node's edges
 * @param {string} nodeId
 * @returns {{ graph: object, casparServerChanged: boolean }}
 */
function releaseDecklinkOutputsForMappingNode(ctx, graph, nodeId) {
	const g = normalizeDeviceGraph(graph)
	const id = String(nodeId || '').trim()
	if (!id) return { graph: g, casparServerChanged: false }
	const srcIds = new Set(
		(g.connectors || [])
			.filter((c) => String(c?.deviceId || '') === id && c?.kind === 'pixel_map_out')
			.map((c) => String(c.id || '')),
	)
	return releaseDecklinkSinksOfSources(ctx, g, srcIds)
}

/**
 * Shared body for WO-491 / WO-494: release every DeckLink port fed by `srcIds`.
 *
 * Clears the port's positional `caspar.outputBinding` (plus `bus`/`mainIndex`) — the generator's
 * legacy `!incomingEdge` fallback re-asserts the screen binding from it, so clearing the flat key
 * alone does nothing — and clears `screen_N_*` / multiview keys ONLY where they still name that
 * same device, so a target another destination legitimately owns is never stomped. Tiled LED-wall
 * screens are skipped: they own their device through `screen_N_decklink_tiles`, the same carve-out
 * `releaseDecklinkDeviceFromOtherTargets` makes. The physical port survives as an output.
 * @param {object} ctx
 * @param {object} g - normalized graph, edges still intact
 * @param {Set<string>} srcIds - source connector ids whose DeckLink sinks are being released
 * @returns {{ graph: object, casparServerChanged: boolean }}
 */
function releaseDecklinkSinksOfSources(ctx, g, srcIds) {
	if (!srcIds || !srcIds.size) return { graph: g, casparServerChanged: false }

	const byId = new Map((g.connectors || []).map((c) => [String(c?.id || ''), c]))
	const releaseIds = new Set()
	for (const e of g.edges || []) {
		if (!srcIds.has(String(e?.sourceId || ''))) continue
		const sink = byId.get(String(e?.sinkId || ''))
		if (sink && (sink.kind === 'decklink_out' || sink.kind === 'decklink_io')) releaseIds.add(String(sink.id))
	}
	if (!releaseIds.size) return { graph: g, casparServerChanged: false }

	const cs = { ...((ctx.config && ctx.config.casparServer) || {}) }
	let casparServerChanged = false

	const connectors = (g.connectors || []).map((c) => {
		if (!releaseIds.has(String(c?.id || ''))) return c
		const devNum = parseDecklinkDeviceIndex(c?.externalRef)
		if (devNum > 0) {
			for (let n = 1; n <= 16; n++) {
				const tiles = cs[`screen_${n}_decklink_tiles`]
				if (Array.isArray(tiles) && tiles.length > 0) continue
				if ((parseInt(String(cs[`screen_${n}_decklink_device`] || '0'), 10) || 0) !== devNum) continue
				cs[`screen_${n}_decklink_device`] = 0
				cs[`screen_${n}_decklink_key_device`] = 0
				cs[`screen_${n}_decklink_replace_screen`] = false
				casparServerChanged = true
			}
			if ((parseInt(String(cs.multiview_decklink_device || '0'), 10) || 0) === devNum) {
				cs.multiview_decklink_device = 0
				cs.multiview_decklink_key_device = 0
				casparServerChanged = true
			}
		}
		// The physical port survives (and stays an output); only the binding goes.
		const caspar = { ...(c.caspar || {}) }
		delete caspar.outputBinding
		delete caspar.bus
		delete caspar.mainIndex
		return { ...c, caspar }
	})

	if (casparServerChanged) ctx.config.casparServer = cs
	return { graph: normalizeDeviceGraph({ ...g, connectors }), casparServerChanged }
}

module.exports = {
	applyDecklinkOutputOnDestinationEdge,
	clearDecklinkInputSlot,
	releaseDecklinkOutputsForDestination,
	releaseDecklinkOutputsForMappingNode,
	scheduleDeviceViewCasparSync,
	syncDeviceViewToCaspar,
}
