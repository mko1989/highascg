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
 * @param {object} ctx
 */
async function syncDeviceViewToCaspar(ctx) {
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
	if (!mappingRes || !mappingRes.casparServerChanged) return
	try {
		const { isFollowerRole, syncFollowerDeviceViewToCaspar } = require('../replication/follower-machine-profile')
		if (isFollowerRole(ctx)) {
			await syncFollowerDeviceViewToCaspar(ctx)
			return
		}
	} catch {
		/* optional */
	}
	const { applyCasparConfigToDiskAndRestart } = require('./routes-caspar-config')
	await applyCasparConfigToDiskAndRestart(ctx)
}

module.exports = {
	applyDecklinkOutputOnDestinationEdge,
	clearDecklinkInputSlot,
	scheduleDeviceViewCasparSync,
	syncDeviceViewToCaspar,
}
