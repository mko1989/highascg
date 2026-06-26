'use strict'

/** @returns {import('./replication-config').ReplicationConfig} */
function replicationDefaults() {
	return {
		enabled: false,
		role: 'auto',
		pairId: '',
		selfId: '',
		leaderEpoch: 0,
		peer: { host: '', port: 4200, token: '' },
		followerMode: 'mirror',
		autoPromote: true,
		scheduledApply: false,
		scheduledApplyLeadMs: 1500,
		syncthingMediaFolderId: 'highascg-media',
	}
}

module.exports = { replicationDefaults }
