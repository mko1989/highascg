'use strict'

/**
 * WO-611 #1–#3 (found inventorying the web client for the Godot port): the global-border autosave event went
 * to `window` while app.js listens on `document`; deferred catalog requests were JSON-encoded before
 * `WsClient.send` encoded them again (the server drops frames that start with `"`, so every catalog waited
 * 120 s for the HTTP fallback); `window.showToast` was called in 21 places and never defined.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

test('deferred catalog sends plain objects through WsClient.send (one JSON encoding)', async () => {
	const { loadDeferredCatalogOverWs } = await import('../../client/lib/deferred-catalog-ws.js')
	const handlers = new Map()
	const sent = []
	const ws = {
		on(ev, fn) {
			handlers.set(ev, fn)
			return () => handlers.delete(ev)
		},
		send(obj) {
			sent.push(obj)
			assert.equal(typeof obj, 'object', 'WsClient.send stringifies itself')
			const chunk = obj.type === 'catalog_request'
				? { slice: 'templates', requestId: obj.id, offset: 0, total: 1, items: [{ id: 't' }], done: true }
				: { slice: 'media', requestId: obj.id, offset: 0, total: 1, items: [{ id: 'm' }], done: true }
			setImmediate(() => handlers.get('catalog_chunk')?.(chunk))
		},
	}
	const applied = {}
	const store = { applyChange: (k, v) => (applied[k] = v), getState: () => applied }
	await loadDeferredCatalogOverWs(ws, store, () => {})
	assert.deepEqual(sent.map((m) => m.type), ['catalog_request', 'catalog_subscribe'])
	assert.deepEqual(applied.media, [{ id: 'm' }])
	assert.equal(applied.catalogDeferred, false)
})

test('global-border save event is dispatched where app.js listens', () => {
	assert.match(read('client/app.js'), /document\.addEventListener\('highascg-global-border-config-save'/)
	assert.match(read('client/components/inspector-global-border-events.js'), /document\.dispatchEvent\(new CustomEvent\('highascg-global-border-config-save'\)\)/)
})

test('no caller relies on the undefined window.showToast', () => {
	const hits = []
	const walk = (d) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name)
			if (e.isDirectory()) walk(p)
			else if (e.name.endsWith('.js') && /window\.showToast\b/.test(fs.readFileSync(p, 'utf8'))) hits.push(p)
		}
	}
	walk(path.join(__dirname, '../../client/components'))
	walk(path.join(__dirname, '../../client/lib'))
	assert.deepEqual(hits, [])
})
