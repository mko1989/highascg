'use strict'

/**
 * WO-842 — sweep 29.10 replication findings: boot reload no-op (4e), leaderYield / demote role not persisted (4e),
 * timeline id traversal, connectToLeader leaving a half-paired follower, OSC playhead export fps.
 *
 * Nothing here reaches the box: the SSH / identity / syncthing / network helpers are replaced on their module
 * objects BEFORE the modules that destructure them are loaded, and fs writes of the traversal case are spied.
 */

process.env.HIGHASCG_SANDBOX = '1'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')

// ── neutralise every outward-facing helper before the replication modules destructure them ──
const peerClientMod = require('../../src/replication/peer-client')
const peerWsMod = require('../../src/replication/peer-ws-client')
const spies = { peerStart: 0, peerStop: 0, wsStart: 0, wsStop: 0 }
peerClientMod.startPeerClient = () => ({
	start() {
		spies.peerStart++
	},
	stop() {
		spies.peerStop++
	},
})
peerWsMod.startPeerWsClient = () => ({
	start() {
		spies.wsStart++
	},
	stop() {
		spies.wsStop++
	},
	connect() {
		spies.wsStart++
		return true
	},
})
const sshMod = require('../../src/replication/replication-ssh-setup')
const identMod = require('../../src/replication/replication-local-identity')
const refreshMod = require('../../src/replication/replication-refresh')
const syncthingMod = require('../../src/replication/syncthing-client')
const handshakeMod = require('../../src/replication/replication-handshake')
const reconcileMod = require('../../src/replication/replication-reconcile')

sshMod.ensureReplicationSshKey = () => ({ publicKeyLine: 'ssh-ed25519 TEST' })
sshMod.ensurePeerAuthorizedKeyFromConfig = () => {}
sshMod.prepareReplicationSshForPairing = () => {}
sshMod.testReplicationSshToPeer = () => {}
identMod.ensureLocalReplicationSelfId = () => 'box-test'
refreshMod.forcePeerPing = async () => ({ ok: false })
syncthingMod.getLocalSyncthingDeviceId = async () => ''
handshakeMod.buildRegisterHandshakeExtras = () => ({ handshake: { nonce: 'n' } })
handshakeMod.verifyLeaderRegisterResponse = () => ({ ok: true })
handshakeMod.persistPeerDevicePublicKey = () => {}
reconcileMod.reconcileFromLeader = async () => ({ ok: true })
reconcileMod.reconcileAllToPeer = async () => {}

const { startReplicationService, stopReplicationService } = require('../../src/replication/replication-service')
const { reloadReplicationFromConfig } = require('../../src/replication/replication-reload')
const { leaderYield, demoteToFollower } = require('../../src/replication/promote')
const { getReplicationConfig } = require('../../src/config/replication-config')

function mkCtx(repl = {}) {
	const cfg = {
		replication: {
			enabled: true,
			role: 'leader',
			pairId: 'pair-842',
			selfId: 'box-test',
			leaderEpoch: 1,
			peer: { host: '127.0.0.1', port: 1, token: 'tok' }, // refused fast, never the live API
			followerMode: 'mirror',
			...repl,
		},
	}
	return {
		config: cfg,
		configManager: { get: () => cfg, save: (next) => Object.assign(cfg, next) },
		log: () => {},
	}
}

test('4e boot: the peer client is started by the boot reload (runtime is published before it)', () => {
	spies.peerStart = 0
	const ctx = mkCtx()
	const runtime = startReplicationService(ctx, {})
	try {
		assert.equal(ctx._replication, runtime)
		assert.equal(spies.peerStart, 1, 'peerClient.start() ran at boot — the reload used to return "runtime not started"')
		assert.equal(runtime.roleState.getRole(), 'leader')
	} finally {
		stopReplicationService(ctx)
	}
})

test('4e leaderYield persists role follower, so a reload / restart does not resurrect the old leader', async () => {
	const ctx = mkCtx({ leaderEpoch: 1 })
	const runtime = startReplicationService(ctx, {})
	try {
		const out = await leaderYield(ctx, { leaderEpoch: 2, reason: 'test' })
		assert.equal(out.ok, true)
		const persisted = getReplicationConfig(ctx.config)
		assert.equal(persisted.role, 'follower', 'persisted role')
		assert.equal(persisted.leaderEpoch, 2)
		assert.equal(runtime.roleState.getRole(), 'follower')
		reloadReplicationFromConfig(ctx)
		assert.equal(runtime.roleState.getRole(), 'follower', 'role survives reloadReplicationFromConfig')
	} finally {
		stopReplicationService(ctx)
	}
})

test('4e demoteToFollower persists the demotion and adopts the peer epoch', async () => {
	const ctx = mkCtx({ leaderEpoch: 3 })
	const runtime = startReplicationService(ctx, {})
	try {
		await demoteToFollower(ctx, runtime, 7)
		const persisted = getReplicationConfig(ctx.config)
		assert.equal(persisted.role, 'follower')
		assert.equal(persisted.leaderEpoch, 7)
		reloadReplicationFromConfig(ctx)
		assert.equal(runtime.roleState.getRole(), 'follower')
	} finally {
		stopReplicationService(ctx)
	}
})

test('timeline replication: ids that are paths are refused before any file is touched', async () => {
	const { receiveTimelineFromPeer, TIMELINE_ID_RE } = require('../../src/replication/replicate-timelines')
	const ctx = mkCtx()
	const writes = []
	const origWrite = fs.writeFileSync
	const origUnlink = fs.unlinkSync
	const origMkdir = fs.mkdirSync
	fs.writeFileSync = (...a) => writes.push(['write', String(a[0])])
	fs.unlinkSync = (...a) => writes.push(['unlink', String(a[0])])
	fs.mkdirSync = () => {}
	try {
		for (const id of ['../config/victim', '..', 'a/b', 'a\\b', '/etc/x', 'x\u0000y', '']) {
			const w = await receiveTimelineFromPeer(ctx, { pairId: 'pair-842', timelineId: id, timeline: { id } })
			const d = await receiveTimelineFromPeer(ctx, { pairId: 'pair-842', timelineId: id, deleted: true })
			assert.equal(w.ok, false, `write refused for ${JSON.stringify(id)}`)
			assert.equal(d.ok, false, `delete refused for ${JSON.stringify(id)}`)
		}
	} finally {
		fs.writeFileSync = origWrite
		fs.unlinkSync = origUnlink
		fs.mkdirSync = origMkdir
	}
	assert.deepEqual(writes, [], 'no file operation happened')
	// ids the engine mints (tl + base36) still pass
	assert.ok(TIMELINE_ID_RE.test('tlmgx5k2ab12'))
	assert.ok(TIMELINE_ID_RE.test('my_timeline-1'))
})

test('connectToLeader: a failed register restores the previous replication config and role', async () => {
	// replace the HTTP helper BEFORE connect-pair destructures it
	peerClientMod.peerHttpRequest = async (_peer, route) => {
		if (route === '/api/replication/ping') return { ok: true, status: 200, json: { leaderAvailable: true, pairId: 'pair-x' } }
		return { ok: false, status: 0, error: 'timeout' }
	}
	delete require.cache[require.resolve('../../src/replication/connect-pair')]
	const { connectToLeader } = require('../../src/replication/connect-pair')

	const ctx = mkCtx({ enabled: false, role: 'auto', peer: { host: '', port: 4200, token: '' } })
	const before = JSON.stringify(ctx.config.replication)
	const runtime = startReplicationService(ctx, {})
	try {
		const out = await connectToLeader(ctx, runtime, { leaderHost: '10.9.9.9', leaderPort: 4200 })
		assert.equal(out.ok, false)
		assert.equal(JSON.stringify(ctx.config.replication), before, 'replication slice back to what it was')
		assert.equal(runtime.roleState.getRole(), 'standalone', 'no follower role left behind (it blocks local PGM takes)')
	} finally {
		stopReplicationService(ctx)
	}
})

test('OSC playhead export derives the fps from the channel format, not a hard-coded 50', () => {
	const { exportLayersFromOsc, oscChannelFps } = require('../../src/replication/playhead-export')
	assert.equal(oscChannelFps({ format: '1080p2500' }), 25)
	assert.equal(oscChannelFps({ format: '1080p5000' }), 50)
	assert.equal(oscChannelFps({ format: '720p5994' }), 59.94)
	assert.equal(oscChannelFps({ format: '1080i5000' }), 25, 'interlaced names the field rate')
	assert.equal(oscChannelFps({ format: null }), 50, 'unknown keeps the old fallback')
	const ctx = {
		oscState: {
			getSnapshot: () => ({
				channels: { 1: { format: '1080p2500', layers: { 10: { type: 'foreground', file: { name: 'clip', elapsed: 40 } } } } },
			}),
		},
	}
	const out = exportLayersFromOsc(ctx, 1)
	assert.equal(out.framerate, '25')
	assert.equal(out.layers['10'].fps, 25)
	assert.equal(out.layers['10'].frame, 1000, '40 s @ 25 fps = frame 1000 (was 2000)')
})
