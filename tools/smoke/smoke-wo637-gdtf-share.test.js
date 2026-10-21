'use strict'

/**
 * WO-637 — MVR placeholders resolved from GDTF Share: the matcher on entries shaped like the live list (2026-10-21:
 * re-uploads under other makers, a one-mode factory file, an exact-name user file missing a mode, Robe's 4-of-5),
 * mode pairing by footprint, and POST /api/fixtures/share/resolve against a fake GDTF Share (login cookie, list cache,
 * download → stored type + alias; no account → nothing fetched). Fixture: tools/fixtures/gdtf/test-spot.xml.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { zipStored } = require('./lib/zip-stored')
const store = require('../../src/fixtures/gdtf-store')
const { rank, pairModes, makerAgrees, nameRank } = require('../../src/fixtures/gdtf-share-match')
const { RouteRegistry } = require('../../src/api/route-registry')

process.env.HIGHASCG_GDTF_SHARE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-gdtf-share-'))
const share = require('../../src/fixtures/gdtf-share')

const REAL = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const ch = (n) => `<DMXChannel DMXBreak="1" Geometry="Base" Offset="${n}"><LogicalChannel Attribute="Dimmer${n}"><ChannelFunction ` +
	`Attribute="Dimmer${n}" DMXFrom="0/1" Name=""/></LogicalChannel></DMXChannel>`
const mode = (name, n) => `<DMXMode Name="${name}" Geometry="Base"><DMXChannels>${Array.from({ length: n }, (_, i) => ch(i + 1)).join('')}` +
	'</DMXChannels></DMXMode>'
/** Capture's stub of the test spot: 7 and 4 channel modes under Capture's names. */
const STUB = zipStored({ 'description.xml': '<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Test Spot" ' +
	'Manufacturer="HighAsCG" FixtureTypeID="00000000-0000-4000-8000-000000000637"><AttributeDefinitions><Attributes>' +
	Array.from({ length: 7 }, (_, i) => `<Attribute Name="Dimmer${i + 1}"/>`).join('') + '</Attributes></AttributeDefinitions>' +
	'<Models><Model Name="Base"/></Models><Geometries><Geometry Model="Base" Name="Base" Position="{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}"/>' +
	`</Geometries><DMXModes>${mode('7 Channel', 7)}${mode('4 Channel Pixels', 4)}</DMXModes></FixtureType></GDTF>` })

const e = (rid, manufacturer, fixture, uploader, fps, extra = {}) => ({ rid, manufacturer, fixture, uploader, rating: '0',
	lastModified: rid, modes: fps.map((n, i) => ({ name: `m${i}`, dmxfootprint: n })), ...extra })
const modes = (...fps) => fps.map((n) => ({ name: `${n} Channel`, footprint: n }))

test('match: maker agrees, channel counts first, then name, then a manufacturer upload', () => {
	assert.ok(makerAgrees('Robe', 'Robe Lighting') && makerAgrees('ADJ', 'American DJ') && !makerAgrees('ACME', 'TIITEE'))
	assert.strictEqual(nameRank('Robin 600 LEDWash+', 'Robin 600 LEDWash', 'Robe Lighting'), 0)
	assert.strictEqual(nameRank('Pixel Line IP', 'ACME PIXEL LINE IP (STROBE 3 IP)', 'ACME'), 1)
	assert.strictEqual(nameRank('Sharpy', 'Mythos', 'Clay Paky'), 2)
	const acme = { manufacturer: 'Acme', name: 'Pixel Line IP', modes: modes(7, 15, 21, 39) }
	const list = [
		e(1, 'ACME', 'Pixel Line IP', 'User', [7, 15, 21]), // exact name, a mode short
		e(2, 'ACME', 'ACME Pixel Line IP (STROBE 3 IP) Mode 11', 'Manuf.', [70]), // one-mode factory file
		e(3, 'TIITEE', 'PIXEL LINE IP', 'Manuf.', [7, 15, 21, 39]), // another maker's re-upload
		e(4, 'ACME', 'ACME PIXEL LINE IP (STROBE 3 IP)', 'User', [7, 15, 21, 39, 125]),
		e(5, 'ACME', 'PIXEL LINE IP (STROBE 3 IP)', 'Manuf.', [7, 15, 21, 39, 125]),
		e(6, 'ACME', 'Dotline', 'Manuf.', [7, 15, 21, 39]),
	]
	const r = rank(acme, list)
	assert.deepStrictEqual([r.sure, r.candidates.map((c) => c.rid)], [true, [5, 4, 1, 2]])
	const robin = rank({ manufacturer: 'Robe', name: 'Robin 600 LEDWash+', modes: modes(10, 15, 21, 24, 37) },
		[e(7, 'Robe Lighting', 'Robin 600 LEDWash', 'Manuf.', [10, 15, 21, 25, 37]), e(8, 'Robe Lighting', 'Robin 600 LEDWash SW', 'Manuf.', [10, 12, 16, 24])])
	assert.deepStrictEqual([robin.best.rid, robin.sure], [7, true], '4 of 5 channel counts is enough')
	const weak = rank({ manufacturer: 'X', name: 'Y', modes: modes(1, 2, 3) }, [e(9, 'X', 'Y', 'Manuf.', [1])])
	assert.deepStrictEqual([weak.best.rid, weak.sure], [9, false], '1 of 3 → offered, not taken')
	assert.strictEqual(rank(acme, []).best, null)
})

test('pairModes: by footprint, words break ties, unpaired left out', () => {
	assert.deepStrictEqual(pairModes([{ name: '4 Channel RGBW', footprint: 4 }, { name: '4 Channel Strobe', footprint: 4 },
		{ name: '60 Channel', footprint: 60 }], [{ name: '4Ch-Strobe', footprint: 4 }, { name: '4Ch-RGBW', footprint: 4 }]),
	{ '4 Channel RGBW': '4Ch-RGBW', '4 Channel Strobe': '4Ch-Strobe' })
})

test('POST /api/fixtures/share/resolve: login, list cached, download → type + alias', async () => {
	for (const t of store.list()) store.remove(t.id)
	const routes = new RouteRegistry()
	require('../../src/api/routes-gdtf-share').register(routes)
	const reloads = []
	const ctx = { fixtureService: { reload: () => reloads.push(1) } }
	const call = async (method, p, body) => {
		const r = await routes.dispatch(method, p, body === undefined ? undefined : JSON.stringify(body), ctx, null, {})
		return { status: r.status, body: JSON.parse(r.body) }
	}
	const stub = await store.importGdtf(STUB, 'HighAsCG@Test Spot@r3009.gdtf')
	assert.strictEqual(stub.placeholder, true)
	assert.deepStrictEqual((await call('POST', '/api/fixtures/share/resolve', {})).body, { results: [], error: 'no GDTF Share account set' })
	assert.deepStrictEqual((await call('GET', '/api/fixtures/share/account')).body, { user: '', set: false })
	assert.strictEqual((await call('POST', '/api/fixtures/share/account', { user: 'x' })).status, 400)
	assert.deepStrictEqual((await call('POST', '/api/fixtures/share/account', { user: 'highascg', password: 'pw' })).body, { user: 'highascg', set: true })
	assert.strictEqual(fs.statSync(path.join(process.env.HIGHASCG_GDTF_SHARE_DIR, 'gdtf-share.json')).mode & 0o777, 0o600)
	assert.ok(!JSON.stringify((await call('GET', '/api/fixtures/share/account')).body).includes('pw'), 'the password stays put')

	const seen = []
	const fake = async (url, opt = {}) => {
		const u = String(url)
		seen.push(u.split('/').pop())
		const res = (status, body, headers = {}) => new Response(body, { status, headers })
		if (u.endsWith('/login.php')) {
			const b = JSON.parse(opt.body)
			return b.user === 'highascg' && b.password === 'pw' ? res(200, '{"result":true}', { 'set-cookie': 'PHPSESSID=abc; path=/' })
				: res(401, '{"result":false}')
		}
		if (opt.headers?.Cookie !== 'PHPSESSID=abc') return res(401, '{"result":false,"error":"Unauthorized."}')
		if (u.endsWith('/getList.php')) {
			return res(200, JSON.stringify({ result: true, list: [e(42, 'HighAsCG', 'Test Spot', 'Manuf.', [7, 4]),
				e(43, 'Someone', 'Test Spot', 'Manuf.', [7, 4])] }))
		}
		if (u.includes('downloadFile.php?rid=42')) return res(200, zipStored({ 'description.xml': REAL }))
		return res(404, '')
	}
	share._reset()
	const out = await share.resolve([], { fetch: fake })
	assert.deepStrictEqual(seen, ['login.php', 'getList.php', 'downloadFile.php?rid=42'])
	const r = out.results[0]
	assert.deepStrictEqual([out.results.length, r.id, r.status, r.rid, r.modes], [1, stub.id, 'replaced', 42,
		{ '7 Channel': 'Standard', '4 Channel Pixels': 'Pixels' }])
	assert.strictEqual(store.info(stub.id).replacedBy.to, r.to, 'aliased: the MVR patch uses the real type')
	assert.strictEqual(store.info(r.to).placeholder, undefined)
	assert.deepStrictEqual((await share.resolve([], { fetch: fake })).results, [], 'aliased → nothing left to resolve')

	seen.length = 0
	const offline = async () => {
		throw new Error('offline')
	}
	const listed = await share.list(offline, Date.now() + 2 * 24 * 3600 * 1000)
	assert.deepStrictEqual([listed.fresh, listed.list.length, /offline/.test(listed.error)], [false, 2, true], 'a stale list is used offline')
	assert.strictEqual((await share.list(offline)).fresh, true, 'a fresh cache is not refetched')
})
