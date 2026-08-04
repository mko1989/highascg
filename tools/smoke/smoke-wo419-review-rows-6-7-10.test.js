'use strict'

/**
 * WO-419 smoke — review 2026-08-03 "fix first" rows 6, 7, 10:
 *  6. autosave latches: project_gone exit wired, resync gate un-inverted, fresh-server
 *     seeding branch reachable (client ESM → source pins, the house pattern)
 *  7. USB-ingest API prefix mismatch: router registers /api/usb/* and passes the parsed
 *     query (the dispatcher strips query strings before matching)
 * 10. logs modal toggle-close runs the full close() teardown, not a bare remove()
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { RouteRegistry } = require('../../src/api/route-registry')
const routesUsbIngest = require('../../src/api/routes-usb-ingest')

test('WO-419.7: /api/usb/* routes reach the USB-ingest handler', async () => {
	// The handler's own route table: matched paths return a response, unmatched return null.
	const res = await routesUsbIngest.handle('GET', '/api/usb/import-status', {}, '', {}, null)
	assert.ok(res && typeof res.status === 'number', 'matched path returns a response')
	const dead = await routesUsbIngest.handle('GET', '/api/usb-ingest/drives', {}, '', {}, null)
	assert.equal(dead, null, 'old usb-ingest prefix stays unmatched')

	// The registry semantics the registration relies on: '/api/usb/*' matches subpaths and
	// hands the handler the parsed query object.
	const reg = new RouteRegistry()
	let seen = null
	reg.get('/api/usb/*', ({ path: p, query }) => { seen = { p, query }; return { status: 200 } })
	const hit = await reg.dispatch('GET', '/api/usb/browse', '', {}, null, { driveId: 'sda1' })
	assert.ok(hit, 'wildcard matched')
	assert.equal(seen.p, '/api/usb/browse')
	assert.equal(seen.query.driveId, 'sda1', 'query object reaches the handler')

	// router.js registers the prefix the client + handler agree on, passing query through.
	const router = read('src/api/router.js')
	assert.match(router, /routes\.get\('\/api\/usb\/\*'.*query.*routesUsbIngest\.handle\(method, path, query/, 'GET registration')
	assert.match(router, /routes\.post\('\/api\/usb\/\*'.*query.*routesUsbIngest\.handle\(method, path, query/, 'POST registration')
	assert.ok(!router.includes("'/api/usb-ingest"), 'dead usb-ingest registrations removed')
})

test('WO-419.6: autosave latch exits are wired (source pins)', () => {
	const sync = read('client/lib/server-project-sync.js')

	// 6a. markServerProjectSynced is the exit from the WO-311 project_gone latch.
	const markFn = sync.slice(sync.indexOf('export function markServerProjectSynced'))
	assert.match(markFn.slice(0, markFn.indexOf('}')), /projectGone = false/, 'sync mark clears project_gone')
	assert.ok(!sync.includes('clearProjectGoneOnServer'), 'dead never-called exit removed')

	// 6b. resync gate: NOT-synced must resync (the old gate returned synced && age — inverted).
	const gateFn = sync.slice(sync.indexOf('export function shouldResyncOnWsConnect'))
	const gateBody = gateFn.slice(0, gateFn.indexOf('\n}'))
	assert.match(gateBody, /if \(!synced\) return true/, 'failed bootstrap retries on reconnect')
	assert.match(gateBody, /bootstrapInFlight\) return false/, 'no resync while bootstrap runs')
	assert.match(sync, /bootstrapInFlight = true/, 'bootstrap sets in-flight')
	assert.match(sync, /bootstrapInFlight = false/, 'bootstrap clears in-flight')

	// 6c. fresh-server: GET /api/project 200 {} must return, not fall through to the 404 POST.
	const load = read('client/lib/project-load.js')
	const getBlock = load.slice(load.indexOf("api.get('/api/project')"), load.indexOf("api.post('/api/project/load'"))
	assert.match(getBlock, /!Object\.keys\(getRes\)\.length/, 'empty-object fresh marker detected')
	assert.match(getBlock, /return getRes/, 'fresh marker returned before POST fallback')
})

test('WO-419.10: logs modal toggle-close takes the clean close() path', () => {
	const src = read('client/components/logs-modal.js')
	const toggle = src.slice(src.indexOf('export function showLogsModal'), src.indexOf('let highOn'))
	assert.match(toggle, /if \(activeModalClose\) activeModalClose\(\)/, 'toggle calls stored close()')
	assert.match(src, /activeModalClose = close/, 'per-open close stored')
	const closeFn = src.slice(src.indexOf('\tfunction close()'))
	const closeBody = closeFn.slice(0, closeFn.indexOf('\n\t}'))
	assert.match(closeBody, /stopPoll\(\)/, 'close stops the 2 s poll')
	assert.match(closeBody, /teardownWsLivePush\(\)/, 'close removes the log_line WS listener')
	assert.match(closeBody, /activeModalClose = null/, 'stored close cleared on close')
})
