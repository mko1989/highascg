'use strict'

const fs = require('fs')
const path = require('path')
const { stripDeviceLocalFromProject } = require('../config/config-classify')
const projectStore = require('../engine/project-store')
const { getReplicationConfig } = require('../config/replication-config')
const { peerPost } = require('./peer-client')

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 * @param {object} project
 */
async function pushProjectToPeer(ctx, runtime, project) {
	if (runtime.roleState.getRole() !== 'leader') return { ok: false, skipped: true }
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled || !repl.peer.host) return { ok: false, skipped: true }

	const slug = projectStore.getActiveSlug(ctx.persistence || require('../utils/persistence'))
	const payload = {
		pairId: repl.pairId,
		slug,
		project: stripDeviceLocalFromProject(project),
	}

	const res = await peerPost(repl.peer, '/api/replication/project', payload)
	if (res.ok) runtime.projectsPushed += 1
	return { ok: res.ok, status: res.status, error: res.error }
}

/**
 * @param {object} ctx
 * @param {object} body — { pairId, slug, project }
 */
async function receiveProjectFromPeer(ctx, body) {
	const repl = getReplicationConfig(ctx.config)
	if (!repl.enabled) return { ok: false, error: 'replication disabled' }
	if (body.pairId !== repl.pairId) return { ok: false, error: 'pairId mismatch' }

	const slug = String(body.slug || projectStore.getActiveSlug(ctx.persistence || require('../utils/persistence')) || 'default').trim()
	const project = body.project
	if (!project || typeof project !== 'object') return { ok: false, error: 'missing project' }

	const filePath = projectStore.projectFilePath(slug)
	fs.mkdirSync(path.dirname(filePath), { recursive: true })
	fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8')

	if (typeof ctx.log === 'function') {
		ctx.log('info', `[replication] received project slug=${slug}`)
	}
	return { ok: true, slug }
}

/**
 * @param {object} ctx
 * @param {import('./replication-service').ReplicationRuntime} runtime
 */
async function reconcileProjectsToPeer(ctx, runtime) {
	if (runtime.roleState.getRole() !== 'leader') return
	try {
		const { loadFullProject } = require('../engine/project-scenes')
		const project = await loadFullProject()
		await pushProjectToPeer(ctx, runtime, project)
	} catch (e) {
		if (typeof ctx.log === 'function') {
			ctx.log('warn', '[replication] reconcile projects: ' + (e?.message || e))
		}
	}
}

module.exports = { pushProjectToPeer, receiveProjectFromPeer, reconcileProjectsToPeer }
