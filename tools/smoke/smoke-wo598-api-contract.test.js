'use strict'

/**
 * WO-598 A — docs/wiki/api/contract/{http,ws}.md are generated from src/ by tools/dev/gen-api-contract.js and must
 * be current: a new route or WS type fails here until the generator is re-run. The runtime RouteRegistry is the
 * cross-check — every route it holds after router.js loads must be in http.md.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { render } = require('../dev/gen-api-contract')

const DOCS = path.join(__dirname, '../../docs/wiki/api/contract')
const out = render()

test('committed contract docs equal the generator output (re-run tools/dev/gen-api-contract.js)', () => {
	for (const name of ['http.md', 'ws.md']) {
		assert.equal(fs.readFileSync(path.join(DOCS, name), 'utf8'), out[name], `${name} is stale`)
	}
})

test('every route on the runtime registry is in http.md', () => {
	const { routes } = require('../../src/api/router')
	assert.ok(routes.routes.length > 200, 'registry looks empty')
	const missing = routes.routes.filter((r) => !out['http.md'].includes(`| ${r.method} | \`${r.path}\` | registry |`))
	assert.deepEqual(
		missing.map((r) => `${r.method} ${r.path}`),
		[]
	)
})

test('both directions are covered, including handler-literal routes and register()-module WS types', () => {
	const h = out['http.md']
	const w = out['ws.md']
	assert.match(h, /\| GET \| `\/api\/contract\/constants` \| registry \|/)
	assert.match(h, /\| \S+ \| `\/api\/[^`]+` \| handler \|/)
	assert.match(w, /\| server → clients \| `client_prefs` \|/)
	assert.match(w, /\| server → clients \| `state` \|/)
	assert.match(w, /\| client → server \| `tracking:marker` \|/)
	assert.doesNotMatch(w, /`string`/, 'typeof checks are not message types')
})
