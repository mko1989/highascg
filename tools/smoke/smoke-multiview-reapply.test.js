/**
 * WO-156 — multiview re-apply after Caspar restart/reconnect.
 * Verifies the re-apply engine iterates ALL persisted multiviewers (n>1 and HTTP-applied
 * layouts), retries with backoff instead of swallowing errors, and that the state-source
 * mismatch (singular vs plural layout map) is fixed at the write sites.
 */

'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
	collectPersistedMultiviewLayouts,
	reapplyAllMultiviewLayouts,
} = require('../../src/engine/multiview-reapply')

const layoutBody = (tag) => ({ layout: [{ id: tag, x: 0, y: 0, w: 1, h: 1 }], showOverlay: false })

test('collect: merges persistence keys with in-memory HTTP-applied layouts (memory wins)', () => {
	const ctx = {
		persistence: {
			getAll: () => ({
				multiviewLayout: layoutBody('persisted-1'),
				multiviewLayout_2: layoutBody('persisted-2'),
				multiviewLayout_bogus: layoutBody('ignored'),
				unrelated: 42,
			}),
		},
		_multiviewLayout: layoutBody('legacy-singular'),
		_multiviewLayouts: { 1: layoutBody('http-1') },
	}
	const out = collectPersistedMultiviewLayouts(ctx)
	assert.deepEqual(Object.keys(out).sort(), ['1', '2'])
	assert.equal(out[1].layout[0].id, 'http-1', 'HTTP-applied layout must beat stale persisted/boot layout')
	assert.equal(out[2].layout[0].id, 'persisted-2')
})

test('collect: legacy singular used for n=1 when nothing else exists; empty layouts dropped', () => {
	const ctx = {
		persistence: { getAll: () => ({ multiviewLayout_3: { layout: [] } }) },
		_multiviewLayout: layoutBody('legacy'),
	}
	const out = collectPersistedMultiviewLayouts(ctx)
	assert.deepEqual(Object.keys(out), ['1'])
	assert.equal(out[1].layout[0].id, 'legacy')
})

test('reapply: applies every multiviewer incl. n>1 and stamps n on the body', async () => {
	const applied = []
	const ctx = {
		persistence: { getAll: () => ({ multiviewLayout: layoutBody('one') }) },
		_multiviewLayouts: { 2: layoutBody('two') },
		log: () => {},
	}
	const res = await reapplyAllMultiviewLayouts(ctx, {
		attempts: 1,
		backoffMs: 0,
		applyFn: async (body) => applied.push({ n: body.n, id: body.layout[0].id }),
	})
	assert.deepEqual(res.applied, [1, 2])
	assert.deepEqual(res.failed, [])
	assert.deepEqual(applied, [
		{ n: 1, id: 'one' },
		{ n: 2, id: 'two' },
	])
})

test('reapply: retries with logged warnings, succeeds on a later attempt (channel not ready)', async () => {
	let tries = 0
	const logs = []
	const ctx = {
		persistence: { getAll: () => ({ multiviewLayout: layoutBody('one') }) },
		log: (level, msg) => logs.push([level, msg]),
	}
	const res = await reapplyAllMultiviewLayouts(ctx, {
		attempts: 3,
		backoffMs: 1,
		applyFn: async () => {
			tries++
			if (tries < 3) throw new Error('404 CHANNEL ERROR')
		},
	})
	assert.equal(tries, 3)
	assert.deepEqual(res.applied, [1])
	assert.equal(logs.filter(([l, m]) => l === 'warn' && /attempt \d\/3/.test(m)).length, 2, 'each failed attempt logged')
})

test('reapply: exhausted retries reported as failure (no swallowed catch)', async () => {
	const logs = []
	const ctx = {
		persistence: { getAll: () => ({ multiviewLayout_2: layoutBody('two') }) },
		log: (level, msg) => logs.push([level, msg]),
	}
	const res = await reapplyAllMultiviewLayouts(ctx, {
		attempts: 2,
		backoffMs: 1,
		applyFn: async () => {
			throw new Error('CasparCG is not connected')
		},
	})
	assert.deepEqual(res.applied, [])
	assert.equal(res.failed.length, 1)
	assert.equal(res.failed[0].n, 2)
	assert.ok(logs.some(([l, m]) => l === 'warn' && /FAILED for multiviewer\(s\) 2/.test(m)))
})

test('reapply: layouts for no-longer-configured multiviewers are skipped, not retried', async () => {
	let tries = 0
	const ctx = {
		persistence: { getAll: () => ({ multiviewLayout_4: layoutBody('gone') }) },
		log: () => {},
	}
	const res = await reapplyAllMultiviewLayouts(ctx, {
		attempts: 3,
		backoffMs: 1,
		applyFn: async () => {
			tries++
			throw new Error('Multiviewer 4 not enabled')
		},
	})
	assert.equal(tries, 1)
	assert.deepEqual(res.skipped, [4])
	assert.deepEqual(res.failed, [])
})

test('wiring: state-source mismatch fixed and reconnect path uses the re-apply engine', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8')
	// POST /api/multiview/apply keeps the legacy singular in sync (was: plural only → stale reconnect).
	assert.match(read('src/api/routes-multiview.js'), /ctx\._multiviewLayout = b/)
	// Boot + reconnect (setupAllRouting) iterate ALL persisted multiviewers with retries.
	assert.match(read('src/config/routing-setup.js'), /reapplyAllMultiviewLayouts/)
	assert.doesNotMatch(read('src/config/routing-setup.js'), /catch \{\}\s*\n\s*\}\s*\n\tconst \{ setupHostLiveSources/)
	// WS sync path updates the plural map too.
	assert.match(read('src/server/ws-server.js'), /_multiviewLayouts\[/)
})
