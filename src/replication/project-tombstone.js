'use strict'

const projectStore = require('../engine/project-store')
const { getReplicationConfig } = require('../config/replication-config')
const { peerPost, SYNC_REQUEST_TIMEOUT_MS } = require('./peer-client')
const { getReplicationRuntime } = require('./replication-service')

/**
 * Leader → follower: retire a project slug so peers do not resurrect deleted/renamed files.
 * @param {object} ctx
 * @param {{ slug: string, reason?: string, replacementSlug?: string | null }} opts
 */
async function pushProjectTombstoneToPeer(ctx, opts = {}) {
	const rt = getReplicationRuntime(ctx)
	if (!rt || rt.roleState.getRole() !== 'leader') return { ok: false, skipped: true }
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer?.host) return { ok: false, skipped: true }

	const slug = String(opts.slug || '').trim()
	if (!slug) return { ok: false, skipped: true }

	const payload = {
		pairId: repl.pairId,
		slug,
		reason: String(opts.reason || 'delete').trim() || 'delete',
		replacementSlug: opts.replacementSlug ? String(opts.replacementSlug).trim() : null,
	}

	const res = await peerPost(repl.peer, '/api/replication/project-tombstone', payload, {
		timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
	})
	if (res.ok) {
		if (typeof ctx.log === 'function') {
			ctx.log('info', `[replication] project tombstone ok slug=${slug} reason=${payload.reason}`)
		}
	} else if (typeof ctx.log === 'function') {
		ctx.log(
			'warn',
			`[replication] project tombstone failed slug=${slug}: ${res.error || res.status || 'unknown'}`,
		)
	}
	return { ok: res.ok, status: res.status, error: res.error }
}

/**
 * Follower accepts tombstone from leader.
 * @param {object} ctx
 * @param {object} body
 */
async function receiveProjectTombstoneFromPeer(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return { ok: false, error: 'replication disabled' }
	if (body.pairId !== repl.pairId) return { ok: false, error: 'pairId mismatch' }

	const slug = String(body.slug || '').trim()
	if (!slug) return { ok: false, error: 'missing slug' }

	const persistence = ctx.persistence || require('../utils/persistence')
	const activeSlug = projectStore.getActiveSlug(persistence)
	if (activeSlug === slug) {
		return { ok: false, error: 'cannot tombstone active project' }
	}

	const moved = projectStore.retireProjectSlug(slug)
	if (typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`[replication] project tombstone received slug=${slug} reason=${body.reason || 'delete'} trashed=${moved}`,
		)
	}
	return {
		ok: true,
		slug,
		trashed: moved,
		reason: body.reason || 'delete',
		replacementSlug: body.replacementSlug || null,
	}
}

/**
 * Fire-and-forget tombstone push after local slug retirement (WO-106).
 * @param {object} ctx
 * @param {{ slug: string, reason?: string, replacementSlug?: string | null }} opts
 */
function notifyProjectSlugRetired(ctx, opts = {}) {
	if (!ctx || !opts.slug) return
	void pushProjectTombstoneToPeer(ctx, opts).catch((e) => {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] project tombstone push: ' + (e?.message || e))
		}
	})
}

module.exports = {
	pushProjectTombstoneToPeer,
	receiveProjectTombstoneFromPeer,
	notifyProjectSlugRetired,
}
