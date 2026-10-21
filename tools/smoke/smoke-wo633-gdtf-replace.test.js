'use strict'

/**
 * WO-633 — a placeholder GDTF (Capture stub: description.xml only, empty "Base", DimmerN channels) replaced by the real
 * type: placeholder flag, POST/DELETE /api/fixtures/types/<id>/replace (validation), the alias found for another revision
 * of the same stub (maker + name) but never for a real type of that maker + name, and the MVR patch resolving it — paired
 * modes on the real type, an unpaired mode stays on the stub. Fixtures: tools/fixtures/gdtf/test-spot.xml (synthetic).
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { zipStored } = require('./lib/zip-stored')
const store = require('../../src/fixtures/gdtf-store')
const { isPlaceholder } = require('../../src/fixtures/gdtf-aliases')
const { parseGdtf } = require('../../src/fixtures/gdtf-parse')
const mvrStore = require('../../src/stage/mvr-store')
const { RouteRegistry } = require('../../src/api/route-registry')

const REAL = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')

const ch = (n) => `<DMXChannel DMXBreak="1" Geometry="Base" Offset="${n}"><LogicalChannel Attribute="Dimmer${n}"><ChannelFunction ` +
	`Attribute="Dimmer${n}" DMXFrom="0/1" Name=""/></LogicalChannel></DMXChannel>`
const mode = (name, n) => `<DMXMode Name="${name}" Geometry="Base"><DMXChannels>${Array.from({ length: n }, (_, i) => ch(i + 1)).join('')}` +
	'</DMXChannels></DMXMode>'
/** Capture's stub of the same fixture (same maker + name as the real test file); `rev` changes the bytes only. */
const stub = (rev = '') => zipStored({ 'description.xml': `<?xml version="1.0"?><GDTF DataVersion="1.1"><FixtureType Name="Test Spot" ` +
	`Manufacturer="HighAsCG" FixtureTypeID="00000000-0000-4000-8000-00000000000${rev ? 2 : 1}"><AttributeDefinitions><Attributes>` +
	'<Attribute Name="Dimmer1"/><Attribute Name="Dimmer2"/><Attribute Name="Dimmer3"/></Attributes></AttributeDefinitions>' +
	'<Models><Model Name="Base"/></Models><Geometries><Geometry Model="Base" Name="Base" Position="{1,0,0,0}{0,1,0,0}{0,0,1,0}{0,0,0,1}"/>' +
	`</Geometries><DMXModes>${mode('2 Channel', 2)}${mode('3 Channel', 3)}</DMXModes></FixtureType></GDTF>${rev}` })

function routes() {
	const r = new RouteRegistry()
	require('../../src/api/routes-fixture-types').register(r)
	require('../../src/api/routes-stage-mvr').register(r)
	const call = async (method, p, body) => {
		const res = await r.dispatch(method, p, body === undefined ? undefined : JSON.stringify(body), {}, null, {})
		return { status: res.status, body: JSON.parse(res.body) }
	}
	return call
}

test('placeholder flag: Capture stub and "Dummy -" yes, a real type no', async () => {
	assert.strictEqual(isPlaceholder(await parseGdtf(stub())), true)
	assert.strictEqual(isPlaceholder(await parseGdtf(zipStored({ 'description.xml': REAL }))), false)
	assert.strictEqual(isPlaceholder({ name: 'Dummy - Robin 600 LEDWash Plus', models: { b: { file: '', size: [0.3, 0.3, 0.1] } },
		geometry: [{ type: 'Geometry', children: [{ type: 'Axis', children: [] }] }] }), true, 'MVR 1.5 exporters: drawable but named Dummy')
})

test('replace route + MVR patch use the real type; unpaired modes keep the stub', async () => {
	const call = routes()
	const s = await store.importGdtf(stub(), 'HighAsCG@Test Spot@r3009.gdtf')
	const real = await store.importGdtf(zipStored({ 'description.xml': REAL }), 'HighAsCG@Test_Spot@Release.gdtf')
	assert.strictEqual(s.placeholder, true)
	assert.strictEqual(real.placeholder, undefined)
	assert.strictEqual((await call('POST', `/api/fixtures/types/${s.id}/replace`, { to: '0123456789ab' })).status, 400)
	assert.strictEqual((await call('POST', `/api/fixtures/types/${s.id}/replace`, { to: s.id })).status, 400, 'not itself')
	assert.match((await call('POST', `/api/fixtures/types/${s.id}/replace`, { to: real.id, modes: { '2 Channel': 'Nope' } })).body.error, /Nope/)
	assert.match((await call('POST', `/api/fixtures/types/${s.id}/replace`, { to: real.id, modes: { Bogus: 'Standard' } })).body.error, /Bogus/)
	const ok = await call('POST', `/api/fixtures/types/${s.id}/replace`, { to: real.id, modes: { '2 Channel': 'Standard', '3 Channel': '' } })
	assert.strictEqual(ok.status, 200)
	assert.deepStrictEqual(ok.body.replacedBy, { to: real.id, modes: { '2 Channel': 'Standard' } })
	assert.strictEqual(store.info(real.id).replacedBy, undefined, 'the real type of the same maker + name is not a stand-in')
	const rev = await store.importGdtf(stub(' '), 'HighAsCG@Test Spot@r3010.gdtf')
	assert.notStrictEqual(rev.id, s.id)
	assert.strictEqual(rev.replacedBy?.to, real.id, 'another revision of the stub finds the alias by maker + name')

	const xml = `<?xml version="1.0"?><GeneralSceneDescription verMajor="1" verMinor="4"><Scene><Layers><Layer name="L" uuid="L1"><ChildList>
		<Fixture uuid="A1" name="Spot"><GDTFSpec>HighAsCG@Test Spot@r3009.gdtf</GDTFSpec><GDTFMode>2 Channel</GDTFMode>
			<Addresses><Address break="0">1</Address></Addresses><FixtureID>1</FixtureID></Fixture>
		<Fixture uuid="A2" name="Spot"><GDTFSpec>HighAsCG@Test Spot@r3009.gdtf</GDTFSpec><GDTFMode>3 Channel</GDTFMode>
			<Addresses><Address break="0">40</Address></Addresses><FixtureID>2</FixtureID></Fixture>
	</ChildList></Layer></Layers></Scene></GeneralSceneDescription>`
	const rec = await mvrStore.importMvr(zipStored({ 'GeneralSceneDescription.xml': xml, 'HighAsCG@Test Spot@r3009.gdtf': stub() }), 'Rig.mvr')
	const p = await call('POST', `/api/stage/mvr/${rec.id}/patch`, { protocol: 'artnet' })
	assert.deepStrictEqual(p.body.fixtures.map((f) => [f.name, f.typeId, f.mode]), [['Spot 1', real.id, 'Standard'], ['Spot 2', s.id, '3 Channel']])
	assert.deepStrictEqual(p.body.types.map((t) => [t.id, t.fixtures]).sort(), [[real.id, 1], [s.id, 1]].sort())

	assert.strictEqual((await call('DELETE', `/api/fixtures/types/${s.id}/replace`)).status, 200)
	assert.strictEqual((await call('DELETE', `/api/fixtures/types/${s.id}/replace`)).status, 404)
	assert.strictEqual(store.info(s.id).replacedBy, undefined)
	const back = await call('POST', `/api/stage/mvr/${rec.id}/patch`, { protocol: 'artnet' })
	assert.deepStrictEqual(back.body.fixtures.map((f) => f.typeId), [s.id, s.id], 'alias gone → the stub again')
})
