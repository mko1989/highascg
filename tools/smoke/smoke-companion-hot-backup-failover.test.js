'use strict'

/**
 * Three-machine hot-backup smoke: Companion (module) + leader box + follower box.
 * Mocks leader/follower HighAsCG /api/companion/control-status endpoints and
 * drives companion-module ConnectionRouter failover (backup_host).
 *
 * Run: node --test tools/smoke/smoke-companion-hot-backup-failover.test.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const path = require('path')

let _nextPort = 15000
function allocPort() {
	_nextPort += 1
	return _nextPort
}

const COMPANION_ROUTER_URL = path.resolve(
	__dirname,
	'../../../companion-module-dev/companion-module-highpass-highascg/src/connection-router.js',
)

/** @typedef {'leader_air'|'follower_standby'|'standalone'|'down'} BoxMode */

/**
 * @param {Record<string, BoxMode>} modes host:port -> mode
 * @returns {Promise<{ servers: http.Server[], close: () => Promise<void>, setMode: (key: string, mode: BoxMode) => void }>}
 */
function startMockHighAsCGBoxes(modes) {
	/** @type {Map<string, BoxMode>} */
	const live = new Map(Object.entries(modes))
	/** @type {http.Server[]} */
	const servers = []

	for (const [key, initialMode] of Object.entries(modes)) {
		const [host, portStr] = key.split(':')
		const port = parseInt(portStr, 10)
		live.set(key, initialMode)

		const server = http.createServer((req, res) => {
			const mode = live.get(key) || 'down'
			if (req.method !== 'GET' || req.url !== '/api/companion/control-status') {
				res.writeHead(404)
				res.end('not found')
				return
			}
			if (mode === 'down') {
				res.destroy()
				return
			}
			/** @type {object} */
			let body
			if (mode === 'leader_air') {
				body = {
					ok: true,
					acceptsCompanionControl: true,
					controlPlaneReason: 'leader_air',
					suggestedCompanionTarget: 'self',
					airLeader: true,
					role: 'leader',
				}
			} else if (mode === 'follower_standby') {
				body = {
					ok: true,
					acceptsCompanionControl: false,
					controlPlaneReason: 'follower_standby',
					suggestedCompanionTarget: 'peer',
					airLeader: false,
					role: 'follower',
				}
			} else {
				body = {
					ok: true,
					acceptsCompanionControl: true,
					controlPlaneReason: 'standalone',
					suggestedCompanionTarget: 'self',
					airLeader: false,
					role: 'standalone',
				}
			}
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(body))
		})

		awaitListen(server, host, port)
		servers.push(server)
	}

	return {
		servers,
		setMode(key, mode) {
			live.set(key, mode)
		},
		async close() {
			await Promise.all(servers.map((s) => closeServer(s)))
		},
	}
}

function awaitListen(server, host, port) {
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, host, () => resolve(undefined))
	})
}

function closeServer(server) {
	return new Promise((resolve) => {
		server.close(() => resolve(undefined))
	})
}

/**
 * @param {object} opts
 * @param {string} opts.mainHost
 * @param {string} opts.backupHost
 * @param {number} opts.port
 */
function createMockCompanionInstance(opts) {
	/** @type {Record<string, string>} */
	let vars = {}
	let reconnectCount = 0
	const config = {
		hot_backup_enabled: true,
		box_host: opts.mainHost,
		backup_host: opts.backupHost,
		highascg_port: opts.port,
		highascg_enabled: true,
	}
	const instance = {
		config,
		tcp: { connected: false },
		log() {},
		setVariableValues(v) {
			vars = { ...vars, ...v }
		},
		checkFeedbacks() {},
		reconnectAll() {
			reconnectCount += 1
		},
		getConnectionTarget() {
			return router?.getTarget?.() || 'main'
		},
	}
	/** @type {import('../../../companion-module-dev/companion-module-highpass-highascg/src/connection-router.js').ConnectionRouter|null} */
	let router = null
	return {
		instance,
		get vars() {
			return vars
		},
		get reconnectCount() {
			return reconnectCount
		},
		setRouter(r) {
			router = r
		},
	}
}

test('companion stays on main when leader accepts control', async () => {
	const { ConnectionRouter } = await import(`file://${COMPANION_ROUTER_URL}`)
	const port = allocPort()
	const mocks = await startMockHighAsCGBoxes({
		[`127.0.0.1:${port}`]: 'leader_air',
		[`127.0.0.2:${port}`]: 'follower_standby',
	})
	const mock = createMockCompanionInstance({
		mainHost: '127.0.0.1',
		backupHost: '127.0.0.2',
		port,
	})
	const router = new ConnectionRouter(mock.instance)
	mock.setRouter(router)

	await router._healthCheck()
	assert.equal(router.getTarget(), 'main')
	assert.equal(router.getActiveHost(), '127.0.0.1')
	assert.equal(mock.vars.highascg_accepts_control, 'true')
	assert.equal(mock.vars.highascg_control_plane_reason, 'leader_air')

	await mocks.close()
})

test('companion fails over to backup after main unreachable once backup accepts control', async () => {
	const { ConnectionRouter } = await import(`file://${COMPANION_ROUTER_URL}`)
	const port = allocPort()
	const mainKey = `127.0.0.1:${port}`
	const backupKey = `127.0.0.2:${port}`
	const mocks = await startMockHighAsCGBoxes({
		[mainKey]: 'leader_air',
		[backupKey]: 'follower_standby',
	})
	const mock = createMockCompanionInstance({
		mainHost: '127.0.0.1',
		backupHost: '127.0.0.2',
		port,
	})
	const router = new ConnectionRouter(mock.instance)
	mock.setRouter(router)

	await router._healthCheck()
	assert.equal(router.getTarget(), 'main')

	mocks.setMode(mainKey, 'down')
	await router._healthCheck()
	await router._healthCheck()
	assert.equal(
		router.getTarget(),
		'main',
		'still on main while backup is follower_standby (does not accept control)',
	)

	mocks.setMode(backupKey, 'standalone')
	await router._healthCheck()
	assert.equal(router.getTarget(), 'backup', 'switches after follower goes standalone (~peer_lost)')
	assert.equal(router.getActiveHost(), '127.0.0.2')
	assert.equal(mock.reconnectCount, 1)
	assert.equal(mock.vars.highascg_connection_target, 'backup')

	await mocks.close()
})

test('companion uses backup when follower went standalone after peer_lost', async () => {
	const { ConnectionRouter } = await import(`file://${COMPANION_ROUTER_URL}`)
	const port = allocPort()
	const mocks = await startMockHighAsCGBoxes({
		[`127.0.0.1:${port}`]: 'down',
		[`127.0.0.2:${port}`]: 'standalone',
	})
	const mock = createMockCompanionInstance({
		mainHost: '127.0.0.1',
		backupHost: '127.0.0.2',
		port,
	})
	const router = new ConnectionRouter(mock.instance)
	mock.setRouter(router)

	await router._healthCheck()
	await router._healthCheck()
	assert.equal(router.getTarget(), 'backup')
	assert.equal(mock.vars.highascg_accepts_control, 'true')
	assert.equal(mock.vars.highascg_control_plane_reason, 'standalone')

	await mocks.close()
})

test('companion switches back to main when leader returns', async () => {
	const { ConnectionRouter } = await import(`file://${COMPANION_ROUTER_URL}`)
	const port = allocPort()
	const mainKey = `127.0.0.1:${port}`
	const mocks = await startMockHighAsCGBoxes({
		[mainKey]: 'down',
		[`127.0.0.2:${port}`]: 'standalone',
	})
	const mock = createMockCompanionInstance({
		mainHost: '127.0.0.1',
		backupHost: '127.0.0.2',
		port,
	})
	const router = new ConnectionRouter(mock.instance)
	mock.setRouter(router)

	await router._healthCheck()
	await router._healthCheck()
	assert.equal(router.getTarget(), 'backup')

	mocks.setMode(mainKey, 'leader_air')
	await router._healthCheck()
	assert.equal(router.getTarget(), 'main')
	assert.equal(mock.reconnectCount, 2)

	await mocks.close()
})

test('main defers to peer — companion fails over to backup', async () => {
	const { ConnectionRouter } = await import(`file://${COMPANION_ROUTER_URL}`)
	const port = allocPort()
	const mocks = await startMockHighAsCGBoxes({
		[`127.0.0.1:${port}`]: 'follower_standby',
		[`127.0.0.2:${port}`]: 'standalone',
	})
	const mock = createMockCompanionInstance({
		mainHost: '127.0.0.1',
		backupHost: '127.0.0.2',
		port,
	})
	const router = new ConnectionRouter(mock.instance)
	mock.setRouter(router)

	await router._healthCheck()
	await router._healthCheck()
	assert.equal(router.getTarget(), 'backup', 'main defers → failover to backup')

	await mocks.close()
})

test('highascg follower disconnectToStandalone after peer_lost (default replication)', async () => {
	const { RoleState } = require('../../src/replication/role-state')
	const { disconnectToStandalone } = require('../../src/replication/connect-pair')

	const cfg = {
		replication: {
			enabled: true,
			role: 'follower',
			pairId: 'pair-smoke',
			selfId: 'follower-box',
			leaderEpoch: 3,
			autoPromote: false,
			disconnectPolicy: 'standalone',
			peer: { host: '192.168.1.20', port: 4200, token: 'tok' },
			followerMode: 'mirror',
			mirrorTransport: 'amcp-fanout',
		},
	}
	const ctx = {
		config: cfg,
		configManager: {
			get: () => cfg,
			save: (next) => Object.assign(cfg, next),
		},
		log: () => {},
	}
	const runtime = {
		roleState: new RoleState(),
		peerReachable: false,
		lastPeerPingAt: Date.now() - 6000,
	}
	runtime.roleState.configure({ enabled: true, role: 'follower' })
	runtime.roleState.forceRole('follower')

	const out = await disconnectToStandalone(ctx, runtime, { reason: 'peer_lost' })
	assert.equal(out.ok, true)
	assert.equal(cfg.replication.enabled, false)
	assert.equal(cfg.replication.peer.host, '')
	assert.equal(runtime.roleState.getRole(), 'standalone')

	const { computeCompanionControlStatus } = require('../../src/api/companion-control-status')
	const companion = computeCompanionControlStatus({
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
		mirrorTransport: 'amcp-fanout',
		hostname: 'follower-box',
		boxHost: '192.168.1.25',
	})
	assert.equal(companion.acceptsCompanionControl, true)
	assert.equal(companion.controlPlaneReason, 'standalone')
})

test('end-to-end story: leader dies → follower standalone → companion on backup_host', async () => {
	const { ConnectionRouter } = await import(`file://${COMPANION_ROUTER_URL}`)
	const { computeCompanionControlStatus } = require('../../src/api/companion-control-status')
	const port = allocPort()
	const mainKey = `127.0.0.1:${port}`
	const backupKey = `127.0.0.2:${port}`

	const mocks = await startMockHighAsCGBoxes({
		[mainKey]: 'leader_air',
		[backupKey]: 'follower_standby',
	})
	const mock = createMockCompanionInstance({
		mainHost: '127.0.0.1',
		backupHost: '127.0.0.2',
		port,
	})
	const router = new ConnectionRouter(mock.instance)
	mock.setRouter(router)

	await router._healthCheck()
	assert.equal(router.getTarget(), 'main')

	mocks.setMode(mainKey, 'down')
	mocks.setMode(backupKey, 'standalone')
	await router._healthCheck()
	await router._healthCheck()

	assert.equal(router.getTarget(), 'backup')
	assert.equal(router.getActiveHost(), '127.0.0.2')

	const followerStatus = computeCompanionControlStatus({
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
		mirrorTransport: 'amcp-fanout',
		hostname: 'follower',
		boxHost: '127.0.0.2',
	})
	assert.equal(followerStatus.acceptsCompanionControl, true)

	await mocks.close()
})
