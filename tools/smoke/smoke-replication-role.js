'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { RoleState } = require('../../src/replication/role-state')

test('auto role: leader when operator WS connected', () => {
	const rs = new RoleState()
	rs.configure({ enabled: true, role: 'auto' })
	assert.equal(rs.getRole(), 'follower')
	rs.setOperatorWsClientCount(1)
	assert.equal(rs.getRole(), 'leader')
	rs.setOperatorWsClientCount(0)
	assert.equal(rs.getRole(), 'follower')
})

test('standalone when replication disabled', () => {
	const rs = new RoleState()
	rs.configure({ enabled: false, role: 'auto' })
	rs.setOperatorWsClientCount(3)
	assert.equal(rs.getRole(), 'standalone')
})

test('fixed leader role override', () => {
	const rs = new RoleState()
	rs.configure({ enabled: true, role: 'leader' })
	assert.equal(rs.getRole(), 'leader')
	rs.setOperatorWsClientCount(0)
	assert.equal(rs.getRole(), 'leader')
})

test('forced follower overrides configured leader', () => {
	const rs = new RoleState()
	rs.configure({ enabled: true, role: 'leader' })
	rs.forceRole('follower')
	assert.equal(rs.getRole(), 'follower')
})
