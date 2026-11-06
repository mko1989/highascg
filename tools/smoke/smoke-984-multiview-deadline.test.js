'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

// Execute the real route with isolated dependencies: no Caspar, persistence or sockets.
function harness(apply) {
	const timers = new Set()
	const writes = []
	const module = { exports: {} }
	const deps = {
		'./response': { JSON_HEADERS: {}, jsonBody: JSON.stringify, parseBody: JSON.parse },
		'../config/routing': { getChannelMap: () => ({}) },
		'../utils/persistence': { set: (...args) => writes.push(args) },
		'../engine/multiview-apply': {
			resolveMultiviewChannel: () => 3,
			fetchMultiviewInfoXml: async () => ({ infoXml: '<channel />' }),
			applyMultiviewLayout: apply,
		},
		'../state/live-scene-state': {},
	}
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/api/routes-multiview.js'), 'utf8'), {
		module,
		require: (id) => {
			assert.ok(Object.hasOwn(deps, id), id)
			return deps[id]
		},
		setTimeout: (fn, ms) => {
			assert.equal(ms, 25000)
			const timer = { fn }
			timers.add(timer)
			return timer
		},
		clearTimeout: (timer) => timers.delete(timer),
	})
	return { route: module.exports.handleMultiviewApply, timers, writes }
}

const body = JSON.stringify({ layout: [], n: 1 })

test('100 completed applies release every deadline and preserve response/persistence', async () => {
	const h = harness(async () => ({ debug: { applied: true } }))
	const ctx = { config: {}, log() {} }
	for (let i = 0; i < 100; i++) {
		const response = await h.route(body, ctx)
		assert.equal(response.status, 200)
		assert.deepEqual(JSON.parse(response.body), { ok: true, debug: { applied: true } })
		assert.equal(h.timers.size, 0)
	}
	assert.equal(h.writes.length, 100)
	assert.equal(h.writes[0][0], 'multiviewLayout')
	assert.equal(ctx._multiviewLayout, ctx._multiviewLayouts[1])
})

for (const [message, status] of [['not connected', 503], ['apply failed', 502]]) {
	test(`rejected apply (${status}) releases its deadline`, async () => {
		const h = harness(async () => { throw new Error(message) })
		const response = await h.route(body, { config: {}, log() {} })
		assert.equal(response.status, status)
		assert.equal(JSON.parse(response.body).error, message)
		assert.equal(h.timers.size, 0)
		assert.equal(h.writes.length, 0)
	})
}

test('deadline still returns 504 without persisting a pending apply', async () => {
	const h = harness(() => new Promise(() => {}))
	const pending = h.route(body, { config: {}, log() {} })
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(h.timers.size, 1)
	for (const timer of [...h.timers]) {
		h.timers.delete(timer)
		timer.fn()
	}
	assert.equal((await pending).status, 504)
	assert.equal(h.timers.size, 0)
	assert.equal(h.writes.length, 0)
})
