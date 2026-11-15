'use strict'

/**
 * WO-1081 — Stage Skirmish input bounds (sk-sanitize.js, work/notes/skirmish-game-contract.md §7): the frame filter
 * (2 KB, text JSON objects with a known `t`) and the per-type cleaners (strict types, rounding, wrapping, ranges; one bad
 * field drops the whole message), plus the shared spread PRNG the clients draw pellets with.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const requireCore = (id) => require(id.startsWith('src/') ? path.join(ROOT, id) : require.resolve(id, { paths: [ROOT] }))
require('../../modules/toy-skirmish/register')({ requireCore, coreRoot: ROOT, log: () => {} })
const S = require('../../modules/toy-skirmish/server/sk-sanitize')
const R = require('../../modules/toy-skirmish/server/sk-rules')

test('parseMessage: text JSON objects with a known type, ≤ 2 KB', () => {
	for (const t of ['join', 's', 'fire', 'hit', 'boom', 'pick', 'ping', 'video']) assert.deepEqual(S.parseMessage(JSON.stringify({ t })), { t })
	assert.deepEqual(S.parseMessage(Buffer.from('{"t":"ping","c":1}')), { t: 'ping', c: 1 })
	assert.deepEqual(S.parseMessage([Buffer.from('{"t":"pi'), Buffer.from('ng"}')]), { t: 'ping' }, 'fragmented frames')
	for (const bad of ['{oops', '[1]', '"s"', 'null', '{"t":"teleport"}', '{"t":1}', '{}']) assert.equal(S.parseMessage(bad), null, bad)
	assert.equal(S.parseMessage('{"t":"ping"}', true), null, 'binary')
	assert.equal(S.parseMessage(JSON.stringify({ t: 'ping', pad: 'x'.repeat(2100) })), null, 'over 2 KB')
})

test('cleanYaw wraps to (−π, π] in 1 mrad', () => {
	assert.equal(S.cleanYaw(0), 0)
	assert.equal(S.cleanYaw(Math.PI), 3.142)
	assert.equal(S.cleanYaw(-Math.PI), 3.142, '−π → π')
	assert.equal(S.cleanYaw(3 * Math.PI / 2), -1.571)
	assert.equal(S.cleanYaw(4 * Math.PI + 0.5), 0.5)
	assert.equal(Object.is(S.cleanYaw(-0.0001), -0), false, 'no negative zero')
	for (const bad of [NaN, Infinity, '1', null, 1e7]) assert.equal(S.cleanYaw(bad), null)
})

test('cleanMove / cleanFire / cleanHit / cleanBoom / cleanPick', () => {
	assert.deepEqual(S.cleanMove({ p: [1.234567, -2.000049], yaw: 7, mv: 1, w: 'rattler' }), { p: [1.2346, -2], yaw: 0.717, mv: 1, w: 'rattler' })
	assert.deepEqual(S.cleanMove({ p: [0, 0], yaw: 0, mv: 'yes', w: 'bfg' }), { p: [0, 0], yaw: 0, mv: 0, w: null }, 'mv 0/1, unknown weapon → null')
	for (const bad of [{ p: [0], yaw: 0 }, { p: [0, 'x'], yaw: 0 }, { p: [0, 1e5], yaw: 0 }, { p: [0, 0] }, { p: [0, NaN], yaw: 0 }, {}]) assert.equal(S.cleanMove(bad), null, JSON.stringify(bad))
	assert.deepEqual(S.cleanFire({ w: 'pea', n: 0, p: [0, 0], yaw: 1 }), { w: 'pea', n: 0, p: [0, 0], yaw: 1 })
	assert.deepEqual(S.cleanFire({ w: 'thumper', n: 2 ** 31 - 1, p: [1, 1], yaw: -1, extra: 1 }), { w: 'thumper', n: 2 ** 31 - 1, p: [1, 1], yaw: -1 })
	for (const bad of [{ w: 'toString' }, { w: '__proto__' }, { n: 2 ** 31 }, { n: -1 }, { n: 1.5 }, { n: '1' }, { p: null }, { yaw: undefined }]) {
		assert.equal(S.cleanFire({ w: 'pea', n: 1, p: [0, 0], yaw: 0, ...bad }), null, JSON.stringify(bad))
	}
	assert.deepEqual(S.cleanHit({ n: 4, id: 2 }), { n: 4, id: 2, k: 1 }, 'k defaults to 1')
	assert.deepEqual(S.cleanHit({ n: 4, id: 2, k: 8 }), { n: 4, id: 2, k: 8 })
	for (const bad of [{ k: 0 }, { k: 9 }, { k: 1.5 }, { id: 0 }, { id: '2' }, { n: -1 }]) assert.equal(S.cleanHit({ n: 4, id: 2, ...bad }), null, JSON.stringify(bad))
	assert.deepEqual(S.cleanBoom({ n: 3, p: [0.123456, 2] }), { n: 3, p: [0.1235, 2] })
	assert.equal(S.cleanBoom({ n: 3 }), null)
	assert.deepEqual(S.cleanPick({ id: 0 }), { id: 0 })
	assert.deepEqual(S.cleanPick({ id: 63 }), { id: 63 })
	for (const bad of [-1, 64, 1.5, '1', null]) assert.equal(S.cleanPick({ id: bad }), null)
})

test('the spread PRNG: mulberry32 as the clients draw it; pellets within ± spread / 2', () => {
	const r = R.mulberry32(12345)
	const seq = [r(), r(), r()]
	assert.deepEqual(seq, [R.mulberry32(12345)(), ...(() => {
		const q = R.mulberry32(12345)
		q()
		return [q(), q()]
	})()], 'deterministic')
	assert.ok(seq.every((v) => v >= 0 && v < 1))
	const yaws = R.pelletYaws('scatter', 1, 777)
	assert.equal(yaws.length, 8)
	assert.ok(yaws.every((y) => Math.abs(y - 1) <= (14 * Math.PI) / 360 + 1e-12))
	assert.deepEqual(R.pelletYaws('scatter', 1, 777), yaws)
	assert.deepEqual(R.pelletYaws('longshot', 0.5, 9), [0.5], 'no spread')
	const [dx, dz] = R.dirOf(0)
	assert.deepEqual([Math.round(dx * 1e9) / 1e9 + 0, dz], [0, -1], 'yaw 0 faces −Z')
	assert.ok(Math.abs(R.yawTo(0, 0, -1, 0) - Math.PI / 2) < 1e-12, 'yaw π/2 faces −X')
})
