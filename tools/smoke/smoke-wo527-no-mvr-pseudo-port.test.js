'use strict'

/**
 * WO-527 — the "SDI (MVR)" pseudo-port must never exist.
 *
 * Owner 14.08: *"the mvr sdi should not ever appear. user can send mvr channel to sdi port but it
 * still stays an sdi port # not mvr sdi."*
 *
 * `device-graph-suggest.js` invented `dlsdi_99` labelled "SDI (MVR)" whenever a multiview DeckLink
 * device was configured. 99 is not a port — the real card sat in `externalRef` — so every slot-based
 * rule reasoned about a port that cannot exist (WO-513 patched the symptom by resolving the sentinel
 * to its device). And because the suggester only ever ADDS, the entry outlived the setting that
 * created it and sat in the saved graph as a fossil.
 *
 * A multiview output is now an ordinary SDI port, labelled by its port number, and the pseudo-port
 * is stripped from saved graphs on normalize so existing boxes are cleaned on load.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8')
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const { normalizeDeviceGraph, MVR_PSEUDO_CONNECTOR_ID } = require('../../src/config/device-graph-core.js')

test('WO-527: an existing dlsdi_99 is stripped from a saved graph', () => {
	const g = normalizeDeviceGraph({
		devices: [{ id: 'host', role: 'caspar_host', label: 'Host' }],
		connectors: [
			{ id: 'dlsdi_2', deviceId: 'host', kind: 'decklink_io', externalRef: '2', label: 'SDI 2' },
			{ id: 'dlsdi_99', deviceId: 'host', kind: 'decklink_io', externalRef: '2', label: 'SDI (MVR)' },
		],
		edges: [],
	})
	const ids = (g.connectors || []).map((c) => c.id)
	assert.ok(!ids.includes('dlsdi_99'), `THE FOSSIL: ${JSON.stringify(ids)}`)
	assert.ok(ids.includes('dlsdi_2'), 'the real port must survive')
})

test('WO-527: a graph with no pseudo-port is untouched', () => {
	const g = normalizeDeviceGraph({
		devices: [{ id: 'host', role: 'caspar_host', label: 'Host' }],
		connectors: [{ id: 'dlsdi_1', deviceId: 'host', kind: 'decklink_io', externalRef: '1', label: 'SDI 1' }],
		edges: [],
	})
	assert.deepEqual((g.connectors || []).map((c) => c.id), ['dlsdi_1'])
})

test('WO-527: the constant is exported so nothing re-hardcodes the id', () => {
	assert.equal(MVR_PSEUDO_CONNECTOR_ID, 'dlsdi_99')
})

test('WO-527: the suggester no longer invents slot 99 or an "SDI (MVR)" label', () => {
	const src = code(read('src/config/device-graph-suggest.js'))
	assert.doesNotMatch(src, /addDecklinkPort\(99,/, 'a pseudo-slot must never be added')
	assert.doesNotMatch(src, /SDI \(MVR\)/, 'and the label must be gone')
})

test('WO-527: a multiview output is suggested on its REAL port number', () => {
	const src = code(read('src/config/device-graph-suggest.js'))
	// Both the live path and the config-fallback path.
	assert.match(src, /addDecklinkPort\(mvd, mvd, 'decklink_io', `SDI \$\{mvd\}`/, 'live path')
	assert.match(src, /addDecklinkPort\(cfgMvd, cfgMvd, 'decklink_io', `SDI \$\{cfgMvd\}`/, 'config fallback')
})

test('WO-527: the multiview binding is still carried, just on a real port', () => {
	const src = code(read('src/config/device-graph-suggest.js'))
	const hits = [...src.matchAll(/addDecklinkPort\((?:mvd|cfgMvd), [\s\S]{0,160}?\}\)/g)].map((m) => m[0])
	assert.equal(hits.length, 2, `expected both multiview call sites, got ${hits.length}`)
	for (const h of hits) {
		assert.match(h, /ioDirection: 'out'/, 'still an output')
		assert.match(h, /bus: 'multiview'/, 'still the multiview bus — only the PORT identity changed')
	}
})
