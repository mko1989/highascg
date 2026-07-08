'use strict'

const { getReplicationConfig } = require('../config/replication-config')

/**
 * Combined leader↔backup parity gate (WO-147 T147.3, WO-68 §2.4, WO-64 §4):
 *  - running Caspar `INFO CONFIG` parity (channel count + per-channel video-mode)
 *  - HighAsCG channel-plan parity (PGM/PRV/multiview map from the peer ping)
 *
 * Detects the "connected but stale follower" case: peer HTTP/WS may be green while
 * the backup Caspar topology no longer matches air. Result is cached on the runtime
 * and surfaced in `GET /api/replication/status` as `parityGate`.
 *
 * @param {{ ok: boolean, skipped?: boolean, mismatches?: Array }} caspar — from validateCasparParityForPair
 * @param {{ ok: boolean, mismatches?: Array, peerAvailable?: boolean }} channelMap — from compareChannelParity
 */
function combineParityGate(caspar, channelMap) {
	const casparOk = !!caspar?.ok || !!caspar?.skipped
	const channelMapOk = channelMap?.ok !== false
	const mismatchCount = (caspar?.mismatches?.length || 0) + (channelMap?.mismatches?.length || 0)
	return {
		ok: casparOk && channelMapOk,
		skipped: !!caspar?.skipped,
		mismatchCount,
		caspar: caspar || null,
		channelMap: channelMap || null,
		checkedAt: Date.now(),
	}
}

/**
 * Run the full parity gate against the live pair. Non-destructive (read-only AMCP
 * INFO CONFIG locally + peer HTTP export); safe to trigger from the UI at any time.
 * @param {object} ctx
 * @param {{ runtime?: object }} [opts]
 */
async function validateReplicationParity(ctx, opts = {}) {
	const runtime = opts.runtime || require('./replication-service-runtime').getReplicationRuntime(ctx)
	const repl = getReplicationConfig(ctx.config)

	const { validateCasparParityForPair } = require('./caspar-parity')
	const caspar = await validateCasparParityForPair(ctx)

	let channelMap = { ok: true, mismatches: [], peerAvailable: false }
	try {
		const { buildChannelMapSummary, compareChannelParity } = require('./channel-parity')
		const local = buildChannelMapSummary(ctx.config)
		channelMap = compareChannelParity(local, runtime?.lastPeerPing?.channelMap || null)
	} catch {
		channelMap = { ok: true, mismatches: [], peerAvailable: false }
	}

	const gate = {
		...combineParityGate(caspar, channelMap),
		role: runtime?.roleState?.getRole() || repl.role || 'standalone',
		peerReachable: !!runtime?.peerReachable,
	}
	if (runtime) {
		runtime.lastCasparParity = caspar
		runtime.lastParityGate = gate
	}
	return gate
}

module.exports = { combineParityGate, validateReplicationParity }
