'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { computeCompanionControlStatus } = require('../src/api/companion-control-status')

/** @param {Partial<import('../src/api/companion-control-status').CompanionControlSnapshot>} overrides */
function snap(overrides) {
	return {
		replicationEnabled: false,
		paired: false,
		role: 'standalone',
		configuredRole: 'auto',
		peerReachable: false,
		peerHost: '',
		casparLocalConnected: true,
		channelParityOk: true,
		amcpFanoutActive: false,
		peerCasparConnected: false,
		promotedAt: null,
		promoteReason: null,
		mirrorTransport: 'live-state',
		hostname: 'test-box',
		boxHost: '192.168.1.20',
		...overrides,
	}
}

test('standalone accepts control', () => {
	const out = computeCompanionControlStatus(snap({ replicationEnabled: false }))
	assert.equal(out.acceptsCompanionControl, true)
	assert.equal(out.controlPlaneReason, 'standalone')
	assert.equal(out.suggestedCompanionTarget, 'self')
})

test('leader paired accepts control', () => {
	const out = computeCompanionControlStatus(
		snap({
			replicationEnabled: true,
			paired: true,
			role: 'leader',
			configuredRole: 'leader',
			peerReachable: true,
			peerHost: '192.168.1.25',
		}),
	)
	assert.equal(out.acceptsCompanionControl, true)
	assert.equal(out.controlPlaneReason, 'leader_air')
	assert.equal(out.suggestedCompanionTarget, 'self')
	assert.equal(out.airLeader, true)
})

test('follower with reachable leader defers to peer', () => {
	const out = computeCompanionControlStatus(
		snap({
			replicationEnabled: true,
			paired: true,
			role: 'follower',
			configuredRole: 'follower',
			peerReachable: true,
			peerHost: '192.168.1.20',
		}),
	)
	assert.equal(out.acceptsCompanionControl, false)
	assert.equal(out.controlPlaneReason, 'follower_standby')
	assert.equal(out.suggestedCompanionTarget, 'peer')
	assert.equal(out.airLeader, false)
})

test('follower promoted to leader accepts control', () => {
	const out = computeCompanionControlStatus(
		snap({
			replicationEnabled: true,
			paired: true,
			role: 'leader',
			configuredRole: 'follower',
			peerReachable: false,
			promotedAt: Date.now(),
			promoteReason: 'peer_timeout',
		}),
	)
	assert.equal(out.acceptsCompanionControl, true)
	assert.equal(out.controlPlaneReason, 'follower_promoted_backup')
	assert.equal(out.suggestedCompanionTarget, 'self')
})

test('caspar down blocks control', () => {
	const out = computeCompanionControlStatus(snap({ casparLocalConnected: false }))
	assert.equal(out.acceptsCompanionControl, false)
	assert.equal(out.controlPlaneReason, 'degraded_no_caspar')
	assert.equal(out.suggestedCompanionTarget, 'none')
})

test('channel parity mismatch adds warning without blocking control', () => {
	const out = computeCompanionControlStatus(
		snap({
			replicationEnabled: true,
			paired: true,
			role: 'leader',
			configuredRole: 'leader',
			channelParityOk: false,
		}),
	)
	assert.equal(out.acceptsCompanionControl, true)
	assert.deepEqual(out.warnings, ['channel_parity_mismatch'])
})

test('replication enabled but not paired', () => {
	const out = computeCompanionControlStatus(snap({ replicationEnabled: true, paired: false }))
	assert.equal(out.controlPlaneReason, 'not_paired')
	assert.equal(out.acceptsCompanionControl, true)
})
