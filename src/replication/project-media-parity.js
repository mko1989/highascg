'use strict'

const crypto = require('crypto')
const path = require('path')
const { buildProjectMediaManifest } = require('../media/project-media-root')
const { getReplicationConfig } = require('../config/replication-config')

/**
 * @param {Array<{ path: string, size: number, mtime?: number }>} entries
 * @returns {string}
 */
function manifestSignature(entries) {
	const lines = (entries || [])
		.map((e) => `${e.path}:${e.size}:${Math.round(e.mtime || 0)}`)
		.sort((a, b) => a.localeCompare(b))
	return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16)
}

/**
 * @param {Array<{ path: string, size: number }>} local
 * @param {Array<{ path: string, size: number }>} peer
 */
function compareProjectMediaManifests(local, peer) {
	const localMap = new Map((local || []).map((e) => [e.path, e]))
	const peerMap = new Map((peer || []).map((e) => [e.path, e]))
	/** @type {string[]} */
	const localOnly = []
	/** @type {string[]} */
	const peerOnly = []
	/** @type {Array<{ path: string, localSize: number, peerSize: number }>} */
	const mismatched = []

	for (const [relPath, le] of localMap) {
		const pe = peerMap.get(relPath)
		if (!pe) localOnly.push(relPath)
		else if (le.size !== pe.size) {
			mismatched.push({ path: relPath, localSize: le.size, peerSize: pe.size })
		}
	}
	for (const relPath of peerMap.keys()) {
		if (!localMap.has(relPath)) peerOnly.push(relPath)
	}

	localOnly.sort()
	peerOnly.sort()
	mismatched.sort((a, b) => a.path.localeCompare(b.path))

	return {
		inSync: localOnly.length === 0 && peerOnly.length === 0 && mismatched.length === 0,
		localOnly,
		peerOnly,
		mismatched,
		localCount: localMap.size,
		peerCount: peerMap.size,
	}
}

/**
 * @param {object} ctx
 */
async function getLocalProjectMediaManifest(ctx) {
	const { loadFullProject } = require('../engine/project-scenes')
	let project = null
	try {
		project = await loadFullProject()
	} catch {
		/* project store unavailable — stays null */
	}
	const config = ctx?.config || {}
	const store = ctx?.persistence
	const { getActiveProjectSlug } = require('../media/project-media-root')
	const slug = getActiveProjectSlug(store, project)
	const entries = buildProjectMediaManifest(config, store, project)
	return {
		slug,
		entries,
		signature: manifestSignature(entries),
		fileCount: entries.length,
		generatedAt: Date.now(),
	}
}

/** @type {WeakMap<object, { at: number, summary: object }>} */
const _pingMediaCache = new WeakMap()
const PING_MEDIA_CACHE_MS = 4000

/**
 * Lightweight summary for replication ping (cached briefly).
 * @param {object} ctx
 */
async function getProjectMediaPingSummary(ctx) {
	const now = Date.now()
	const cached = _pingMediaCache.get(ctx)
	if (cached && now - cached.at < PING_MEDIA_CACHE_MS) return cached.summary
	const manifest = await getLocalProjectMediaManifest(ctx)
	const summary = {
		slug: manifest.slug,
		signature: manifest.signature,
		fileCount: manifest.fileCount,
	}
	_pingMediaCache.set(ctx, { at: now, summary })
	return summary
}

function invalidateProjectMediaPingCache(ctx) {
	_pingMediaCache.delete(ctx)
}

/**
 * @param {object} ctx
 * @param {object} [pingJson]
 */
async function fetchPeerProjectMediaManifest(ctx, pingJson) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) {
		return { ok: false, error: 'replication not paired' }
	}
	const { peerHttpRequest } = require('./peer-client')

	const tryManifest = async () =>
		peerHttpRequest(repl.peer, '/api/replication/project-media-manifest')

	let res = await tryManifest()

	if (res.status === 401) {
		const { realignPairTokenFromPeer, pushPairTokenToPeer } = require('./replication-pair-token')
		const rt = require('./replication-service').getReplicationRuntime(ctx)
		const role = rt?.roleState?.getRole() || getReplicationConfig(ctx.config).role
		const fixed =
			role === 'leader' ? await pushPairTokenToPeer(ctx) : await realignPairTokenFromPeer(ctx)
		if (fixed.ok && fixed.updated) {
			res = await tryManifest()
		}
	}

	if (res.ok && res.json) {
		return { ok: true, manifest: res.json, source: 'manifest' }
	}

	const peerMedia = pingJson?.projectMedia || null
	if ((res.status === 404 || res.status === 401) && peerMedia?.signature) {
		return {
			ok: true,
			manifest: {
				slug: peerMedia.slug || '',
				signature: peerMedia.signature,
				fileCount: peerMedia.fileCount ?? 0,
				entries: [],
			},
			source: 'ping',
			signatureOnly: true,
		}
	}

	if (res.status === 401) {
		return {
			ok: false,
			error:
				'peer rejected replication token (401) — Disconnect and Connect hot backup again on both boxes',
			tokenMismatch: true,
			httpStatus: 401,
		}
	}

	if (res.status === 404) {
		return {
			ok: false,
			error:
				'peer missing project media API (404) — deploy this HighAsCG build to both boxes and restart highascg on each',
			peerNeedsUpdate: true,
			httpStatus: 404,
		}
	}

	return { ok: false, error: res.error || `peer manifest HTTP ${res.status}`, httpStatus: res.status || 0 }
}

/**
 * @param {object} ctx
 * @param {{ forcePing?: boolean }} [opts]
 */
async function compareProjectMediaWithPeer(ctx, opts = {}) {
	const local = await getLocalProjectMediaManifest(ctx)
	const runtime = require('./replication-service').getReplicationRuntime(ctx)
	const role = runtime?.roleState?.getRole() || getReplicationConfig(ctx.config).role

	/** @type {object|null} */
	let pingJson = runtime?.lastPeerPing || null
	if (opts.forcePing && runtime) {
		const { forcePeerPing } = require('./replication-refresh')
		const ping = await forcePeerPing(ctx, runtime)
		if (!ping.ok) {
			return {
				ok: false,
				error: ping.error || 'peer unreachable',
				peerReachable: false,
				role,
				local,
			}
		}
		pingJson = ping.ping || runtime.lastPeerPing
	}

	const peerRes = await fetchPeerProjectMediaManifest(ctx, pingJson)
	if (!peerRes.ok) {
		if (role === 'leader' && local.fileCount > 0) {
			const last = runtime?.lastMediaSync
			const spreadCurrent =
				!!last?.ok &&
				!!last?.caughtUp &&
				last.direction === 'push' &&
				!!last.localSignature &&
				last.localSignature === local.signature
			return {
				ok: true,
				peerManifestUnavailable: true,
				inSync: spreadCurrent,
				signaturesMatch: spreadCurrent,
				slug: local.slug || '',
				role,
				localOnly: [],
				peerOnly: [],
				mismatched: [],
				localCount: local.fileCount,
				peerCount: 0,
				leaderShouldPush: !spreadCurrent,
				followerShouldPull: false,
				local,
				peer: null,
				compareSource: 'degraded',
			}
		}
		return {
			ok: false,
			error: peerRes.error,
			peerNeedsUpdate: !!peerRes.peerNeedsUpdate,
			peerReachable: !!runtime?.peerReachable,
			role,
			local,
		}
	}

	const peer = peerRes.manifest
	if (local.slug && peer.slug && local.slug !== peer.slug) {
		return {
			ok: true,
			inSync: false,
			differentProjects: true,
			localSlug: local.slug,
			peerSlug: peer.slug,
			role,
			leaderShouldPush: role === 'leader',
			followerShouldPull: role === 'follower',
			local,
			peer,
			compareSource: peerRes.source,
		}
	}

	const peerEntries = Array.isArray(peer.entries) ? peer.entries : []
	const peerSignature = peer.signature || manifestSignature(peerEntries)
	const signaturesMatch = local.signature === peerSignature

	if (peerRes.signatureOnly) {
		const inSync = signaturesMatch
		return {
			ok: true,
			inSync,
			signaturesMatch,
			signatureOnly: true,
			localSignature: local.signature,
			peerSignature,
			slug: local.slug || peer.slug || '',
			role,
			localOnly: [],
			peerOnly: [],
			mismatched: [],
			localCount: local.fileCount,
			peerCount: peer.fileCount ?? 0,
			leaderShouldPush: role === 'leader' && !inSync,
			followerShouldPull: role === 'follower' && !inSync,
			local,
			peer,
			compareSource: 'ping',
		}
	}

	const cmp = compareProjectMediaManifests(local.entries, peerEntries)

	return {
		ok: true,
		...cmp,
		signaturesMatch,
		localSignature: local.signature,
		peerSignature,
		slug: local.slug || peer.slug || '',
		role,
		leaderShouldPush:
			role === 'leader' &&
			(!cmp.inSync || !signaturesMatch) &&
			(cmp.localOnly.length > 0 || cmp.peerOnly.length > 0 || cmp.mismatched.length > 0),
		followerShouldPull:
			role === 'follower' &&
			(!cmp.inSync || !signaturesMatch) &&
			(cmp.peerOnly.length > 0 || cmp.mismatched.length > 0 || cmp.localOnly.length > 0),
		local,
		peer,
		compareSource: peerRes.source || 'manifest',
	}
}

module.exports = {
	manifestSignature,
	compareProjectMediaManifests,
	getLocalProjectMediaManifest,
	getProjectMediaPingSummary,
	invalidateProjectMediaPingCache,
	fetchPeerProjectMediaManifest,
	compareProjectMediaWithPeer,
}
