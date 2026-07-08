'use strict'

/**
 * WO-147 T147.3 — combined parity gate (Caspar INFO CONFIG + channel plan) and
 * the POST /api/replication/validate-parity endpoint. No live Caspar, no peers:
 * unpaired configs short-circuit and paired configs without a token never dial out.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { combineParityGate, validateReplicationParity } = require('../../src/replication/parity-gate')
const { compareCasparParity } = require('../../src/replication/caspar-parity')
const { RoleState } = require('../../src/replication/role-state')

function makeRuntime(role = 'leader') {
	const roleState = new RoleState()
	roleState.configure({ enabled: true, role })
	return { roleState, peerReachable: false, lastPeerPing: null }
}

test('combineParityGate: both sides ok → gate ok', () => {
	const gate = combineParityGate(
		{ ok: true, mismatches: [] },
		{ ok: true, mismatches: [], peerAvailable: true },
	)
	assert.equal(gate.ok, true)
	assert.equal(gate.skipped, false)
	assert.equal(gate.mismatchCount, 0)
	assert.ok(gate.checkedAt > 0)
})

test('combineParityGate: caspar mismatch fails the gate with counted mismatches', () => {
	const caspar = compareCasparParity(
		[
			{ index: 1, videoMode: '1080p5000' },
			{ index: 2, videoMode: '1080p5000' },
		],
		[{ index: 1, videoMode: '1080p6000' }],
	)
	const gate = combineParityGate(caspar, { ok: true, mismatches: [], peerAvailable: true })
	assert.equal(gate.ok, false)
	assert.ok(gate.mismatchCount >= 2, 'channel_count + video_mode mismatches counted')
	assert.equal(gate.caspar.followerNeedsMoreChannels, true)
})

test('combineParityGate: channel-plan mismatch alone fails the gate', () => {
	const gate = combineParityGate(
		{ ok: true, mismatches: [] },
		{ ok: false, mismatches: [{ kind: 'program', label: 'PGM screen 1', local: 'ch 1', peer: 'ch 2' }], peerAvailable: true },
	)
	assert.equal(gate.ok, false)
	assert.equal(gate.mismatchCount, 1)
})

test('combineParityGate: skipped caspar check (unpaired) does not fail the gate', () => {
	const gate = combineParityGate({ ok: true, skipped: true, mismatches: [] }, { ok: true, mismatches: [], peerAvailable: false })
	assert.equal(gate.ok, true)
	assert.equal(gate.skipped, true)
})

test('validateReplicationParity: unpaired box → ok + skipped, cached on runtime', async () => {
	const runtime = makeRuntime('leader')
	const ctx = { config: { replication: { enabled: false } }, _replication: runtime, log: () => {} }
	const gate = await validateReplicationParity(ctx, { runtime })
	assert.equal(gate.ok, true)
	assert.equal(gate.skipped, true)
	assert.equal(gate.role, 'leader')
	assert.equal(runtime.lastParityGate, gate, 'gate cached for status payload')
	assert.ok(runtime.lastCasparParity, 'caspar slice cached for existing casparParity status field')
})

test('validateReplicationParity: paired but Caspar down on both → gate fails with actionable mismatches', async () => {
	const runtime = makeRuntime('leader')
	// peer.token intentionally empty — validateCasparParityForPair never dials the peer.
	const ctx = {
		config: {
			replication: {
				enabled: true,
				role: 'leader',
				pairId: 'p1',
				selfId: 'leader-box',
				peer: { host: '192.0.2.1', port: 4200, token: '' },
			},
		},
		_replication: runtime,
		log: () => {},
	}
	const gate = await validateReplicationParity(ctx, { runtime })
	assert.equal(gate.ok, false)
	assert.equal(gate.skipped, false)
	assert.ok(gate.caspar.mismatches.some((m) => m.kind === 'unavailable'))
	assert.equal(runtime.lastParityGate, gate)
})

test('POST /api/replication/validate-parity follows routes-replication patterns', async () => {
	const { handlePost } = require('../../src/api/routes-replication-post')

	// Without a replication runtime → 503 like the sibling endpoints.
	const down = await handlePost('/api/replication/validate-parity', {}, { config: {} }, {})
	assert.equal(down.status, 503)

	const runtime = makeRuntime('leader')
	const ctx = { config: { replication: { enabled: false } }, _replication: runtime, log: () => {} }
	const res = await handlePost('/api/replication/validate-parity', {}, ctx, {})
	assert.equal(res.status, 200)
	const body = JSON.parse(res.body)
	assert.equal(body.ok, true)
	assert.equal(body.skipped, true)
	assert.ok(body.checkedAt > 0)
	assert.equal(runtime.lastParityGate.checkedAt, body.checkedAt, 'endpoint result surfaced to status payload cache')
})
