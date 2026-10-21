'use strict'

/**
 * WO-615 T1/T2 — GDTF fixture types: description.xml → modes / channels (16-bit offsets, DMX value scaling, mode
 * master branches, channel sets, virtual channels, GeometryReference pixel instancing, a duplicate-offset warning),
 * geometry tree (Axis / Beam, wiring dropped), wheels, the store (projects/_gdtf, test-isolated) and the
 * /api/fixtures/types routes with a real multipart upload. The fixture is synthetic: tools/fixtures/gdtf/test-spot.xml.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { Readable } = require('stream')
const { zipStored } = require('./lib/zip-stored')
const { dmxValue, atRes } = require('../../src/fixtures/gdtf-dmx')
const { parseGdtf, parseDescription } = require('../../src/fixtures/gdtf-parse')
const store = require('../../src/fixtures/gdtf-store')
const { RouteRegistry } = require('../../src/api/route-registry')
const { register } = require('../../src/api/routes-fixture-types')

const XML = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
const sampleGdtf = () =>
	zipStored({ 'description.xml': XML, 'wheels/gobo1.png': PNG, 'models/gltf/base.glb': Buffer.from('glTF') })

test('DMX values scale by whole bytes; all-ones stays all-ones', () => {
	assert.deepStrictEqual(dmxValue('32768/2'), { v: 32768, n: 2 })
	assert.strictEqual(dmxValue('None'), null)
	assert.strictEqual(atRes(dmxValue('128/1'), 2), 32768)
	assert.strictEqual(atRes(dmxValue('255/1'), 2), 65535)
	assert.strictEqual(atRes(dmxValue('32768/2'), 1), 128)
	assert.strictEqual(atRes(dmxValue('0/1'), 2), 0)
})

test('standard mode: offsets, resolution, defaults, mode-master branches, sets, virtual channel', async () => {
	const t = await parseDescription(XML)
	assert.strictEqual(t.name, 'Test Spot')
	assert.strictEqual(t.manufacturer, 'HighAsCG')
	assert.strictEqual(t.dataVersion, '1.2')
	const m = t.modes.find((x) => x.name === 'Standard')
	assert.strictEqual(m.footprint, 7)
	assert.deepStrictEqual(m.breaks, [1])
	const pan = m.channels[0]
	assert.deepStrictEqual(pan.offsets, [1, 2])
	assert.strictEqual(pan.res, 2)
	assert.strictEqual(pan.attribute, 'Pan')
	assert.strictEqual(pan.default, 32768)
	// Pan and Pan 360 sit on different PanMode branches → both span the full range.
	assert.deepStrictEqual(
		pan.functions.map((f) => [f.name, f.from, f.to, f.modeFrom]),
		[
			['Pan', 0, 65535, 0],
			['Pan 360', 0, 65535, 1],
		]
	)
	assert.deepStrictEqual([pan.functions[0].physFrom, pan.functions[0].physTo], [-270, 270])
	const tilt = m.channels[1]
	assert.strictEqual(tilt.default, 32768, '128/1 at 16 bit')
	const dim = m.channels[3]
	assert.strictEqual(dim.highlight, 255)
	const wheel = m.channels[4]
	assert.deepStrictEqual(
		wheel.functions.map((f) => [f.name, f.from, f.to]),
		[
			['Wheel', 0, 127],
			['Spin', 128, 255],
		]
	)
	assert.deepStrictEqual(
		wheel.functions[0].sets.map((s) => [s.name, s.from, s.to, s.slot]),
		[
			['Open', 0, 9, 1],
			['Red', 10, 19, 2],
			['Gobo', 20, 127, 3],
		]
	)
	assert.strictEqual(wheel.functions[0].wheel, 'Color1')
	const virt = m.channels[5]
	assert.deepStrictEqual(virt.offsets, [])
	assert.strictEqual(virt.default, 255)
	assert.deepStrictEqual(store.modeWarnings(m), ['channels share offset 7 (as written in the file)'])
})

test('pixel mode: a template geometry is instanced per GeometryReference at its break offset', async () => {
	const t = await parseDescription(XML)
	const m = t.modes.find((x) => x.name === 'Pixels')
	assert.deepStrictEqual(
		m.channels.map((c) => [c.geometry, c.offsets[0], c.attribute]),
		[
			['Bar', 1, 'Dimmer'],
			['Pixel 1', 2, 'ColorAdd_R'],
			['Pixel 2', 3, 'ColorAdd_R'],
			['Pixel 3', 4, 'ColorAdd_R'],
		]
	)
	assert.strictEqual(m.footprint, 4)
	assert.deepStrictEqual(store.modeWarnings(m), [])
})

test('geometry tree keeps Axis / Beam, drops wiring; wheels and models', async () => {
	const t = await parseGdtf(sampleGdtf())
	const base = t.geometry[0]
	assert.deepStrictEqual(
		base.children.map((c) => c.type),
		['Axis'],
		'WiringObject dropped'
	)
	const head = base.children[0].children[0]
	assert.strictEqual(head.name, 'Head')
	const beam = head.children[0]
	assert.strictEqual(beam.type, 'Beam')
	assert.strictEqual(beam.beam.beamAngle, 18)
	assert.strictEqual(beam.beam.fieldAngle, 24)
	assert.strictEqual(beam.beam.cct, 6500)
	const bar = t.geometry.find((g) => g.name === 'Bar')
	assert.deepStrictEqual(
		bar.children.map((c) => [c.type, c.ref.geometry, c.ref.breaks[1]]),
		[
			['GeometryReference', 'Cell', 2],
			['GeometryReference', 'Cell', 3],
			['GeometryReference', 'Cell', 4],
		]
	)
	assert.deepStrictEqual(
		t.wheels.Color1.map((s) => s.name),
		['Open', 'Red', 'Gobo']
	)
	assert.deepStrictEqual(t.wheels.Color1[1].color, [0.64, 0.33, 21.26])
	assert.strictEqual(t.wheels.Color1[2].media, 'gobo1')
	assert.deepStrictEqual(t.models.Base, { file: 'base', type: 'Undefined', size: [0.4, 0.3, 0.2] })
	assert.ok(t.files.includes('wheels/gobo1.png'))
	await assert.rejects(parseGdtf(Buffer.from('not a zip')), /not a ZIP/)
	await assert.rejects(parseGdtf(zipStored({ 'x.txt': 'x' })), /no description\.xml/)
})

test('store: import is content-addressed; list / describe / mode / member / remove', async () => {
	const s = await store.importGdtf(sampleGdtf(), 'Test@Spot.gdtf')
	assert.match(s.id, /^[0-9a-f]{12}$/)
	assert.strictEqual((await store.importGdtf(sampleGdtf(), 'again.gdtf')).id, s.id, 'same bytes → same id')
	assert.deepStrictEqual(
		s.modes.map((m) => [m.name, m.footprint, m.channels]),
		[
			['Standard', 7, 7],
			['Pixels', 4, 4],
		]
	)
	assert.strictEqual(store.list().filter((x) => x.id === s.id).length, 1)
	const d = store.describe(s.id)
	assert.ok(d.geometry && d.wheels && d.attributes.Pan)
	assert.strictEqual(d.modes[0].channels, 7, 'describe carries counts, not channel lists')
	assert.strictEqual(store.mode(s.id, 'Pixels').channels.length, 4)
	assert.strictEqual(store.mode(s.id, 'Nope'), null)
	assert.deepStrictEqual(await store.member(s.id, 'wheels/gobo1.png'), PNG)
	assert.strictEqual(await store.member(s.id, 'missing.png'), null)
	assert.strictEqual(store.record('../../etc'), null, 'ids are hashes only')
	assert.ok(store.remove(s.id))
	assert.strictEqual(store.describe(s.id), null)
	assert.strictEqual(store.remove(s.id), false)
})

test('routes: multipart upload, list, describe, mode, file, delete, bad upload', async () => {
	const routes = new RouteRegistry()
	register(routes)
	const call = (method, p, extra = {}) => routes.dispatch(method, p, '', {}, extra.req, extra.query || {})
	const upload = (buf, name) => {
		const boundary = 'xGDTFx'
		const body = Buffer.concat([
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
					'Content-Type: application/octet-stream\r\n\r\n'
			),
			buf,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		])
		const req = Readable.from([body])
		req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }
		return call('POST', '/api/fixtures/types', { req })
	}
	const up = await upload(sampleGdtf(), 'Test@Spot.gdtf')
	assert.strictEqual(up.status, 200)
	const { id } = JSON.parse(up.body)
	const listed = JSON.parse((await call('GET', '/api/fixtures/types')).body).types
	assert.ok(listed.some((t) => t.id === id && t.file === 'Test@Spot.gdtf'))
	assert.strictEqual(JSON.parse((await call('GET', `/api/fixtures/types/${id}`)).body).name, 'Test Spot')
	const mode = await call('GET', `/api/fixtures/types/${id}/mode`, { query: { name: 'Standard' } })
	assert.strictEqual(JSON.parse(mode.body).channels.length, 7)
	assert.deepStrictEqual(JSON.parse(mode.body).warnings, ['channels share offset 7 (as written in the file)'])
	const file = await call('GET', `/api/fixtures/types/${id}/file`, { query: { path: 'wheels/gobo1.png' } })
	assert.strictEqual(file.status, 200)
	assert.strictEqual(file.headers['Content-Type'], 'image/png')
	assert.deepStrictEqual(file.body, PNG)
	assert.strictEqual((await call('GET', `/api/fixtures/types/${id}/mode`, { query: { name: 'x' } })).status, 404)
	assert.strictEqual((await call('GET', '/api/fixtures/types/zzz')).status, 404)
	const bad = await upload(Buffer.from('nope'), 'bad.gdtf')
	assert.strictEqual(bad.status, 400)
	assert.match(JSON.parse(bad.body).error, /GDTF import failed/)
	assert.strictEqual((await call('DELETE', `/api/fixtures/types/${id}`)).status, 200)
	assert.strictEqual((await call('DELETE', `/api/fixtures/types/${id}`)).status, 404)
})
