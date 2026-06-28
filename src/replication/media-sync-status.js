'use strict'

const { getReplicationConfig } = require('../config/replication-config')
const { getMediaSyncStatus: getSyncthingMediaSyncStatus } = require('./syncthing-media-status')

/**
 * @param {object} ctx
 */
async function getReplicationMediaSyncStatus(ctx) {
	const repl = getReplicationConfig(ctx?.config || {})
	const transport = repl.mediaTransport || 'rsync'

	if (transport === 'syncthing') {
		const st = await getSyncthingMediaSyncStatus(repl.syncthingMediaFolderId)
		return { ...st, transport: 'syncthing' }
	}

	const runtime = require('./replication-service').getReplicationRuntime(ctx)
	const last = runtime?.lastMediaSync
	if (!last) {
		return {
			available: true,
			transport: 'rsync',
			caughtUp: false,
			state: 'idle',
			percent: 0,
		}
	}

	return {
		available: true,
		transport: 'rsync',
		caughtUp: !!last.caughtUp || !!last.ok,
		state: last.inProgress ? 'syncing' : last.ok ? 'idle' : 'error',
		percent: last.percent ?? (last.ok ? 100 : 0),
		currentPath: last.currentPath || null,
		pathIndex: last.pathIndex ?? null,
		pathTotal: last.pathTotal ?? null,
		error: last.error || null,
		direction: last.direction || null,
		slug: last.slug || null,
		at: last.at || null,
	}
}

module.exports = { getReplicationMediaSyncStatus }
