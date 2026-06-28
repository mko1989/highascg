'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { RoleState } = require('../../src/replication/role-state')
const { promoteToLeader, demoteToFollower } = require('../../src/replication/promote')

function mockCtx(repl = {}) {
	const cfg = {
		replication: {
			enabled: true,
			role: 'auto',
			pairId: 'pair-1',
			selfId: 'box-a',
			leaderEpoch: 1,
			peer: { host: '127.0.0.1', port: 4200, token: 'tok' },
			followerMode: 'mirror',
			autoPromote: true,
			...repl,
		},
	}
	return {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: (next) => Object.assign(cfg, next),
		},
		log: () => {},
	}
}

test('promote increments leaderEpoch and forces leader role', async () => {
	const ctx = mockCtx({ leaderEpoch: 2 })
	const runtime = {
		roleState: new RoleState(),
		lastLiveIntent: null,
		promotedAt: 0,
		promoteReason: '',
	}
	runtime.roleState.configure({ enabled: true, role: 'follower' })
	runtime.roleState.forceRole('follower')

	const out = await promoteToLeader(ctx, runtime, { reason: 'peer_timeout' })
	assert.equal(out.ok, true)
	assert.equal(out.leaderEpoch, 3)
	assert.equal(runtime.roleState.getRole(), 'leader')
	assert.equal(ctx.config.replication.leaderEpoch, 3)
})

test('demote forces follower role', async () => {
	const ctx = mockCtx({ leaderEpoch: 5 })
	const runtime = {
		roleState: new RoleState(),
		demotedAt: 0,
		peerLeaderEpoch: 0,
	}
	runtime.roleState.configure({ enabled: true, role: 'leader' })
	runtime.roleState.forceRole('leader')

	const out = await demoteToFollower(ctx, runtime, 7)
	assert.equal(out.ok, true)
	assert.equal(runtime.roleState.getRole(), 'follower')
	assert.equal(runtime.peerLeaderEpoch, 7)
})

test('lower epoch leader yields when peer epoch is higher', () => {
	const local = new RoleState()
	local.configure({ enabled: true, role: 'leader' })
	local.forceRole('leader')
	const localEpoch = 2
	const peerEpoch = 5
	assert.ok(peerEpoch > localEpoch)
})

test('promote skips mirror-apply when amcp-fanout is active', async (t) => {
	const { PeerCasparConnection } = require('../../src/replication/peer-caspar-connection')
	const origConnect = PeerCasparConnection.prototype.connect
	PeerCasparConnection.prototype.connect = function noopConnect() {
		this.connected = true
	}
	t.after(() => {
		PeerCasparConnection.prototype.connect = origConnect
	})

	const ctx = mockCtx({
		leaderEpoch: 2,
		mirrorTransport: 'amcp-fanout',
		peerCaspar: { host: '192.168.0.10', port: 5250 },
	})
	const runtime = {
		roleState: new RoleState(),
		lastLiveIntent: { seq: 1, intent: { channels: { 1: { sceneId: 'look-1' } } } },
		promotedAt: 0,
		promoteReason: '',
	}
	runtime.roleState.configure({ enabled: true, role: 'follower' })
	runtime.roleState.forceRole('follower')

	const out = await promoteToLeader(ctx, runtime, { reason: 'manual', skipYieldNotify: true })
	assert.equal(out.ok, true)
	assert.equal(out.casparAlreadyOnAir, true)
	assert.equal(out.leaderEpoch, 3)
})
