'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
	verifyRegisterFollowerRequest,
	buildLeaderRegisterHandshakeResponse,
	verifyLeaderRegisterResponse,
	verifyReplicationRepairRequest,
} = require('../../src/replication/replication-handshake')
const { ensureDeviceIdentity } = require('../../src/system/device-identity')
const pkg = require('../../package.json')

test('register-follower handshake signs and verifies', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-hs-'))
	const identityPath = path.join(tmp, 'config', 'device-identity.json')
	fs.mkdirSync(path.dirname(identityPath), { recursive: true })
	const follower = ensureDeviceIdentity()
	fs.writeFileSync(identityPath, JSON.stringify(follower, null, 2))

	const pairId = crypto.randomUUID()
	const nonce = crypto.randomBytes(8).toString('hex')
	const body = {
		appId: 'highascg',
		appVersion: pkg.version,
		hardwareId: '1234',
		pairId,
		devicePublicKey: follower.publicKeyPem,
		followerHost: '192.168.0.28',
		handshake: {
			nonce,
			pairId,
			hardwareId: '1234',
			role: 'follower',
			signature: require('../../src/replication/replication-handshake').signHandshakeFields({
				nonce,
				pairId,
				hardwareId: '1234',
				role: 'follower',
			}),
		},
	}
	const auth = verifyRegisterFollowerRequest(body)
	assert.equal(auth.ok, true)

	const leaderCtx = {
		config: { network: {} },
	}
	const response = buildLeaderRegisterHandshakeResponse(leaderCtx, { pairId, nonce })
	const leaderVerify = verifyLeaderRegisterResponse(response, { pairId, nonce })
	assert.equal(leaderVerify.ok, true)
})

test('register-follower rejects unknown appId', () => {
	const out = verifyRegisterFollowerRequest({ appId: 'other-app', pairId: 'x' })
	assert.equal(out.ok, false)
	assert.equal(out.status, 403)
})

test('repair handshake accepts signed request from stored peer key', () => {
	ensureDeviceIdentity()
	const leader = crypto.generateKeyPairSync('ed25519')
	const leaderPublic = leader.publicKey.export({ type: 'spki', format: 'pem' }).toString()
	const pairId = 'pair-test'
	const nonce = 'abc123'
	// Re-sign with leader key manually for test
	const leaderPrivate = leader.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
	const msg = require('../../src/replication/replication-handshake').canonicalHandshakeMessage({
		nonce,
		pairId,
		hardwareId: '9999',
		role: 'leader',
	})
	const signature = (() => {
		const key = crypto.createPrivateKey(leaderPrivate)
		return crypto.sign(null, Buffer.from(msg, 'utf8'), key).toString('base64')
	})()

	const ctx = {
		config: {
			replication: {
				enabled: true,
				pairId,
				peer: { host: '192.168.0.20', port: 4200, token: 'tok' },
				peerDevicePublicKey: leaderPublic,
			},
		},
	}
	const repair = verifyReplicationRepairRequest(
		ctx,
		{
			pairId,
			appId: 'highascg',
			devicePublicKey: leaderPublic,
			handshake: { nonce, pairId, hardwareId: '9999', role: 'leader', signature },
		},
		{ socket: { remoteAddress: '192.168.0.99' } },
		{ expectedRole: 'leader' },
	)
	assert.equal(repair.ok, true)
	assert.equal(repair.method, 'handshake')
})
