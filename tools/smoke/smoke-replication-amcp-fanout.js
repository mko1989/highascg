'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeReplicationConfig } = require('../../src/config/replication-config')
const {
	shouldFanOutCommand,
	isAmcpFanoutMirrorActive,
	shouldSkipSemanticLiveMirror,
	bindAmcpFanout,
	unbindAmcpFanout,
} = require('../../src/replication/amcp-fanout')
const { RoleState } = require('../../src/replication/role-state')

test('normalizeReplicationConfig accepts amcp-fanout mirrorTransport', () => {
	const repl = normalizeReplicationConfig({
		enabled: true,
		mirrorTransport: 'amcp-fanout',
		peerCaspar: { host: '192.168.0.10', port: 5250 },
	})
	assert.equal(repl.mirrorTransport, 'amcp-fanout')
	assert.equal(repl.peerCaspar.host, '192.168.0.10')
	assert.equal(repl.peerCaspar.port, 5250)
	assert.equal(repl.amcpFanout.enabled, true)
})

test('shouldFanOutCommand allowlists playout commands only', () => {
	assert.equal(shouldFanOutCommand('PLAY 1-10'), true)
	assert.equal(shouldFanOutCommand('MIXER 1-10 OPACITY 1 0'), true)
	assert.equal(shouldFanOutCommand('INFO 1'), false)
	assert.equal(shouldFanOutCommand('ADD 1 STREAM'), false)
	assert.equal(shouldFanOutCommand('VERSION'), false)
})

test('isAmcpFanoutMirrorActive when leader paired with peerCaspar', () => {
	const roleState = new RoleState()
	roleState.configure({ enabled: true, role: 'leader' })
	roleState.forceRole('leader')
	const runtime = { roleState, peerCasparConnection: { isConnected: true } }
	const ctx = {
		config: {
			replication: normalizeReplicationConfig({
				enabled: true,
				role: 'leader',
				pairId: 'p1',
				selfId: 'leader',
				peer: { host: '192.168.0.10', port: 4200, token: 'tok' },
				mirrorTransport: 'amcp-fanout',
				peerCaspar: { host: '192.168.0.10', port: 5250 },
			}),
		},
	}
	bindAmcpFanout(ctx, runtime)
	assert.equal(isAmcpFanoutMirrorActive(ctx.config), true)
	unbindAmcpFanout()
})

test('shouldSkipSemanticLiveMirror on follower when amcp-fanout configured', () => {
	const roleState = new RoleState()
	roleState.configure({ enabled: true, role: 'follower' })
	roleState.forceRole('follower')
	const runtime = { roleState, peerCasparConnection: { isConnected: true } }
	const ctx = {
		config: {
			replication: normalizeReplicationConfig({
				enabled: true,
				role: 'follower',
				pairId: 'p1',
				selfId: 'follower',
				peer: { host: '192.168.0.10', port: 4200, token: 'tok' },
				mirrorTransport: 'amcp-fanout',
				peerCaspar: { host: '192.168.0.10', port: 5250 },
			}),
		},
	}
	bindAmcpFanout(ctx, runtime)
	assert.equal(isAmcpFanoutMirrorActive(ctx.config), false)
	assert.equal(shouldSkipSemanticLiveMirror(ctx.config), true)
	unbindAmcpFanout()
})

test('shouldSkipSemanticLiveMirror on follower with empty peerCaspar.host', () => {
	const ctx = {
		config: {
			replication: normalizeReplicationConfig({
				enabled: true,
				role: 'follower',
				pairId: 'p1',
				selfId: 'follower',
				peer: { host: '192.168.0.20', port: 4200, token: 'tok' },
				mirrorTransport: 'amcp-fanout',
				peerCaspar: { host: '', port: 5250 },
			}),
		},
	}
	const { shouldSkipSemanticLiveMirror, isAmcpFanoutReceiveBox, shouldBlockLocalPgmAmcpCommand } =
		require('../../src/replication/amcp-fanout')
	assert.equal(shouldSkipSemanticLiveMirror(ctx.config), true)
	assert.equal(isAmcpFanoutReceiveBox(ctx), true)
	assert.equal(shouldBlockLocalPgmAmcpCommand(ctx, 'PLAY 1-10'), true)
})

test('isAmcpFanoutReceiveBox when peerCaspar targets this machine (misconfigured leader json on backup)', () => {
	const roleState = new RoleState()
	roleState.configure({ enabled: true, role: 'leader' })
	roleState.forceRole('leader')
	const runtime = { roleState, peerCasparConnection: { isConnected: true } }
	const ctx = {
		config: {
			caspar: { host: '127.0.0.1', port: 5250 },
			replication: normalizeReplicationConfig({
				enabled: true,
				role: 'leader',
				pairId: 'p1',
				selfId: 'backup-box',
				peer: { host: '192.168.0.25', port: 4200, token: 'tok' },
				mirrorTransport: 'amcp-fanout',
				peerCaspar: { host: '127.0.0.1', port: 5250 },
			}),
		},
		_replication: runtime,
	}
	bindAmcpFanout(ctx, runtime)
	const { isAmcpFanoutReceiveBox, shouldBlockLocalPgmAmcpCommand } = require('../../src/replication/amcp-fanout')
	assert.equal(isAmcpFanoutMirrorActive(ctx.config), true, 'misconfigured as leader')
	assert.equal(isAmcpFanoutReceiveBox(ctx), true, 'peerCaspar points at local Caspar — receive box')
	assert.equal(shouldBlockLocalPgmAmcpCommand(ctx, 'LOADBG 1-10 clip MIX 25 linear'), true)
	assert.equal(shouldBlockLocalPgmAmcpCommand(ctx, 'LOADBG 3-10 clip MIX 25 linear'), false)
	unbindAmcpFanout()
})
