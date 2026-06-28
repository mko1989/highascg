'use strict'

const { parseServerChannels } = require('../config/config-compare')
const { getReplicationConfig } = require('../config/replication-config')
const { peerHttpRequest } = require('./peer-client')

/**
 * @param {object} ctx
 * @returns {Promise<{ ok: boolean, channels: Array, channelCount: number, error?: string }>}
 */
async function fetchLocalCasparChannels(ctx) {
	if (!ctx?.amcp?.query?.infoConfig) {
		return { ok: false, channels: [], channelCount: 0, error: 'Caspar AMCP not available' }
	}
	try {
		const res = await ctx.amcp.query.infoConfig()
		const xml =
			typeof res === 'string'
				? res
				: res?.data != null
					? String(res.data)
					: res?.body != null
						? String(res.body)
						: ''
		const channels = await parseServerChannels(xml)
		return { ok: channels.length > 0, channels, channelCount: channels.length }
	} catch (e) {
		return { ok: false, channels: [], channelCount: 0, error: e?.message || String(e) }
	}
}

/**
 * @param {Array<{ index: number, videoMode: string, resolutionLabel?: string }>|null|undefined} leaderChannels
 * @param {Array<{ index: number, videoMode: string, resolutionLabel?: string }>|null|undefined} followerChannels
 */
function compareCasparParity(leaderChannels, followerChannels) {
	/** @type {Array<{ kind: string, message: string, channel?: number, leader?: string, follower?: string, missingCount?: number }>} */
	const mismatches = []
	const leaderCount = leaderChannels?.length || 0
	const followerCount = followerChannels?.length || 0

	if (!leaderCount) {
		mismatches.push({
			kind: 'unavailable',
			message: 'Leader Caspar INFO CONFIG unavailable — is Caspar running on the leader?',
		})
	}
	if (!followerCount) {
		mismatches.push({
			kind: 'unavailable',
			message: 'Backup Caspar INFO CONFIG unavailable — is Caspar running on this box?',
		})
	}
	if (!leaderCount || !followerCount) {
		return {
			ok: false,
			mismatches,
			followerNeedsMoreChannels: false,
			leaderChannelCount: leaderCount,
			followerChannelCount: followerCount,
			missingCount: 0,
			fixHint:
				'Ensure Caspar is running on both boxes, then connect again or use Refresh connection.',
		}
	}

	const followerNeedsMoreChannels = followerCount < leaderCount
	const missingCount = Math.max(0, leaderCount - followerCount)

	if (followerNeedsMoreChannels) {
		mismatches.push({
			kind: 'channel_count',
			message: `Backup needs ${missingCount} more Caspar channel(s) (${followerCount} on backup vs ${leaderCount} on leader). Channels are created from the leader Device View setup — regenerate Caspar on the backup.`,
			missingCount,
		})
	} else if (followerCount > leaderCount) {
		mismatches.push({
			kind: 'channel_count',
			message: `Backup has ${followerCount - leaderCount} extra Caspar channel(s) vs leader (${followerCount} vs ${leaderCount}).`,
			missingCount: 0,
		})
	}

	const n = Math.min(leaderCount, followerCount)
	for (let i = 0; i < n; i++) {
		const l = leaderChannels[i]
		const f = followerChannels[i]
		const lv = String(l?.videoMode || '').trim()
		const fv = String(f?.videoMode || '').trim()
		if (lv && fv && lv !== fv) {
			mismatches.push({
				kind: 'video_mode',
				channel: l.index,
				leader: lv,
				follower: fv,
				message: `Ch ${l.index}: video-mode ${lv} (leader) ≠ ${fv} (backup)`,
			})
		}
	}

	const needsDeviceViewRegen =
		followerNeedsMoreChannels || mismatches.some((m) => m.kind === 'video_mode' || m.kind === 'channel_count')

	return {
		ok: mismatches.length === 0,
		mismatches,
		followerNeedsMoreChannels,
		leaderChannelCount: leaderCount,
		followerChannelCount: followerCount,
		missingCount,
		needsDeviceViewRegen,
		fixHint: needsDeviceViewRegen
			? 'Load the leader show (sync on connect), then regenerate casparcg.config from Device View on the backup — local GPU/DeckLink wiring stays on this box.'
			: null,
	}
}

/**
 * Compare running Caspar INFO CONFIG on this box vs peer.
 * @param {object} ctx
 */
async function validateCasparParityForPair(ctx) {
	const repl = getReplicationConfig(ctx.config)
	const runtime = require('./replication-service').getReplicationRuntime(ctx)
	const role = runtime?.roleState?.getRole() || repl.role || 'standalone'

	if (!repl.enabled || !repl.peer?.host) {
		return {
			ok: true,
			skipped: true,
			mismatches: [],
			followerNeedsMoreChannels: false,
			leaderChannelCount: 0,
			followerChannelCount: 0,
			checkedAt: Date.now(),
		}
	}

	const local = await fetchLocalCasparChannels(ctx)
	let peer = { ok: false, channels: [], channelCount: 0, error: 'peer unreachable' }
	if (repl.peer.token) {
		const peerRes = await peerHttpRequest(repl.peer, '/api/replication/export/caspar-channels', {
			timeoutMs: 12_000,
		})
		if (peerRes.ok && peerRes.json) {
			peer = {
				ok: !!peerRes.json.ok,
				channels: Array.isArray(peerRes.json.channels) ? peerRes.json.channels : [],
				channelCount: peerRes.json.channelCount ?? peerRes.json.channels?.length ?? 0,
				error: peerRes.json.error,
			}
		} else {
			peer.error = peerRes.error || `HTTP ${peerRes.status}`
		}
	}

	/** @type {typeof local.channels} */
	let leaderChannels
	/** @type {typeof local.channels} */
	let followerChannels
	if (role === 'leader') {
		leaderChannels = local.channels
		followerChannels = peer.channels
	} else {
		leaderChannels = peer.channels
		followerChannels = local.channels
	}

	const compared = compareCasparParity(leaderChannels, followerChannels)
	return {
		...compared,
		localCasparOk: local.ok,
		peerCasparOk: peer.ok,
		localChannelCount: local.channelCount,
		peerChannelCount: peer.channelCount,
		localError: local.error || null,
		peerError: peer.error || null,
		checkedAt: Date.now(),
	}
}

/**
 * Follower: after show sync, regenerate Caspar from Device View when running config lags leader.
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {{ forceRegenerate?: boolean }} [opts]
 */
async function ensureFollowerCasparParity(ctx, runtime, opts = {}) {
	const role = runtime?.roleState?.getRole()
	let parity = await validateCasparParityForPair(ctx)
	if (runtime) runtime.lastCasparParity = parity

	if (role !== 'follower') {
		return parity
	}

	const { applyHardwareConfigToCtx } = require('../engine/project-hardware-config')
	const {
		applyLocalMachineProfileToConfig,
		regenerateFollowerCasparFromDeviceView,
	} = require('./follower-machine-profile')
	const { repairFollowerDecklinkGraph, assessFollowerCasparOutputReadiness } = require('./follower-caspar-output')

	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const project = await loadFullProject()
		if (project?.hardwareConfig?.screenDestinations) {
			applyHardwareConfigToCtx(ctx, { screenDestinations: project.hardwareConfig.screenDestinations })
		}
		applyLocalMachineProfileToConfig(ctx)
	} catch {
		try {
			applyLocalMachineProfileToConfig(ctx)
		} catch {
			/* optional */
		}
	}

	const { applyDestinationOutputEdgesToCasparConfig } = require('../api/device-view-apply')
	applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })

	const deckGraph = repairFollowerDecklinkGraph(ctx)
	const outputReady = assessFollowerCasparOutputReadiness(ctx)
	parity = { ...parity, casparOutput: outputReady }

	const shouldRegen =
		opts.forceRegenerate ||
		(parity.needsDeviceViewRegen && !parity.ok) ||
		deckGraph.changed ||
		!outputReady.ok

	if (!shouldRegen) {
		if (runtime) runtime.lastCasparParity = parity
		return parity
	}

	if (typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`[replication] Follower Caspar regen (channels ${parity.followerChannelCount}/${parity.leaderChannelCount}, decklink ready=${outputReady.ok})`,
		)
	}

	const regen = await regenerateFollowerCasparFromDeviceView(ctx)
	parity = {
		...parity,
		regenerateAttempted: true,
		regenerateOk: !!regen.ok,
		regenerateError: regen.ok ? null : regen.body?.error || 'regenerate failed',
	}

	if (regen.ok) {
		try {
			const { waitForAmcpReady } = require('../utils/caspar-restart')
			await waitForAmcpReady(ctx, 25_000)
		} catch {
			await new Promise((r) => setTimeout(r, 3000))
		}
		parity = await validateCasparParityForPair(ctx)
		parity.regenerateAttempted = true
		parity.regenerateOk = true
	}

	if (runtime) runtime.lastCasparParity = parity
	return parity
}

module.exports = {
	fetchLocalCasparChannels,
	compareCasparParity,
	validateCasparParityForPair,
	ensureFollowerCasparParity,
}
