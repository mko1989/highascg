'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeReplicationConfig } = require('../../src/config/replication-config')
const {
	shouldFanOutCommand,
	isAmcpFanoutMirrorActive,
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
