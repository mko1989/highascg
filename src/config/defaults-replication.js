'use strict'

/** @returns {import('./replication-config').ReplicationConfig} */
function replicationDefaults() {
	return {
		enabled: false,
		role: 'auto',
		pairId: '',
		selfId: '',
		leaderEpoch: 0,
		leaderAvailable: false,
		peer: { host: '', port: 4200, token: '' },
		followerMode: 'mirror',
		autoPromote: false,
		disconnectPolicy: 'standalone',
		scheduledApply: true,
		scheduledApplyLeadMs: 250,
		syncClock: 'ct-ss',
		syncthingMediaFolderId: 'highascg-project-media',
		mediaTransport: 'rsync',
		mirrorTransport: 'live-state',
		peerCaspar: { host: '', port: 5250, connectTimeoutMs: 5000 },
		amcpFanout: {
			enabled: true,
			confirmLooks: false,
			maxUnconfirmed: 3,
		},
		playheadSync: {
			enabled: false,
			softThresholdMs: 150,
			hardThresholdMs: 2000,
			sampleIntervalMs: 5000,
			minCorrectionIntervalMs: 2000,
			maxCorrectionsPerMinute: 6,
		},
	}
}

module.exports = { replicationDefaults }
