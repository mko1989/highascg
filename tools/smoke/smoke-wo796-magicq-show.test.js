'use strict'

/** WO-796 — program the HighAsCG stage from MagicQ on this box: the scene's MVR into MagicQ's show folder, and a
 * local desk socket (127.0.0.2:6454) the visualiser reads that MagicQ's own :6454 socket cannot take over. */

const test = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('dgram')
const fs = require('fs')
const os = require('os')
const path = require('path')
const unzipper = require('unzipper')
const { stageMvrForMagicq, rewriteScene, absAddress, fileName } = require('../../src/vr/magicq-mvr')
const { buildZipStore } = require('../../src/support/zip-store')
const { ConsoleFrames, LOCAL_DESK_HOST } = require('../../src/fixtures/follow-through')
const { ARTNET_PORT } = require('../../src/fixtures/artdmx')

const A = 'b4eee245-5607-4c72-8fa2-d29c8ab1a7c9'
const B = '0c1d2e3f-0000-4000-8000-000000000002'
const fixture = (uuid, spec) =>
	`<Fixture name="x" uuid="${uuid}"><GDTFSpec>${spec}</GDTFSpec><GDTFMode>27CH</GDTFMode>` +
	'<Addresses><Address break="0">1</Address></Addresses><FixtureID>1</FixtureID></Fixture>'

test('Art-Net port-address U is MVR universe U + 1; sACN keeps its number', () => {
	assert.equal(absAddress({ protocol: 'artnet', universe: 4, address: 1 }), 2049)
	assert.equal(absAddress({ protocol: 'sacn', universe: 1, address: 10 }), 10)
	assert.equal(absAddress({ protocol: 'artnet', universe: 0, address: 513 }), 0)
	assert.equal(absAddress({ protocol: 'sacn', universe: 0, address: 1 }), 0)
})

test('the scene keeps its fixtures but takes HighAsCG type, mode and address from the patch', () => {
	const xml = `<Scene>${fixture(A, 'Martin@MAC Quantum 27CH')}${fixture(B, 'Other@Thing')}</Scene>`
	const patch = [
		{ id: `mvr-${A.toUpperCase()}`, protocol: 'artnet', universe: 4, address: 1, typeId: 'c24ac67a2350', mode: 'Extended' },
		{ id: `mvr-${B}`, protocol: 'artnet', universe: 0, address: 1, typeId: 'x', mode: 'm', enabled: false },
	]
	const r = rewriteScene(xml, patch, (id) => `Martin@MAC Quantum Profile@hacg-${id}.gdtf`)
	assert.equal(r.patched, 1)
	assert.equal(r.kept, 1, 'a disabled entry leaves the scene fixture as it was')
	assert.deepEqual([...r.types], ['c24ac67a2350'])
	assert.ok(r.xml.includes('<GDTFSpec>Martin@MAC Quantum Profile@hacg-c24ac67a2350.gdtf</GDTFSpec>'))
	assert.ok(r.xml.includes('<GDTFMode>Extended</GDTFMode>'))
	assert.ok(r.xml.includes('<Addresses><Address break="0">2049</Address></Addresses><FixtureID>1</FixtureID>'))
	assert.ok(r.xml.includes(fixture(B, 'Other@Thing')), 'untouched byte for byte')
})

test('the loaded MVR lands in the show folder with HighAsCG GDTFs, rewritten only when it changed', async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo796-'))
	const show = path.join(tmp, 'show')
	fs.mkdirSync(show)
	const src = path.join(tmp, 'ba5546d8a901.mvr')
	const scene = `<GeneralSceneDescription>${fixture(A, 'Martin@MAC Quantum 27CH')}</GeneralSceneDescription>`
	fs.writeFileSync(src, buildZipStore({
		'GeneralSceneDescription.xml': scene,
		'Martin@MAC Quantum 27CH.gdtf': 'placeholder',
		'truss.3ds': 'mesh',
	}))
	fs.writeFileSync(path.join(tmp, 'c24ac67a2350.gdtf'), 'store-gdtf')
	const patch = [{ id: `mvr-${A}`, protocol: 'artnet', universe: 4, address: 1, typeId: 'c24ac67a2350', mode: 'Extended' }]
	let project = { previs: { mvr: { id: 'ba5546d8a901', name: 'MHP Patch Final' } }, fixtures: { patch } }
	const deps = {
		showDir: show,
		loadProject: () => project,
		mvrFile: (id) => path.join(tmp, `${id}.mvr`),
		gdtfFile: (id) => path.join(tmp, `${id}.gdtf`),
		gdtfInfo: () => ({ manufacturer: 'Martin', name: 'MAC Quantum Profile' }),
	}
	const a = await stageMvrForMagicq(deps)
	const dest = path.join(show, 'MHP Patch Final.mvr')
	assert.deepEqual(a, { name: 'MHP Patch Final.mvr', path: dest, written: true, patched: 1, kept: 0 })
	const files = {}
	for (const e of (await unzipper.Open.file(dest)).files) files[e.path] = (await e.buffer()).toString()
	assert.deepEqual(Object.keys(files).sort(), [
		'GeneralSceneDescription.xml',
		'Martin@MAC Quantum Profile@hacg-c24ac67a2350.gdtf',
		'truss.3ds',
	], 'the replaced placeholder GDTF is dropped, geometry kept')
	assert.equal(files['Martin@MAC Quantum Profile@hacg-c24ac67a2350.gdtf'], 'store-gdtf')
	assert.equal(files['truss.3ds'], 'mesh')
	assert.match(files['GeneralSceneDescription.xml'], /<Address break="0">2049<\/Address>/)
	assert.equal((await stageMvrForMagicq(deps)).written, false, 'same bytes: left alone')
	patch[0].address = 28
	assert.equal((await stageMvrForMagicq(deps)).written, true, 'a repatch rewrites it')
	project = { previs: {} }
	assert.equal(await stageMvrForMagicq(deps), null, 'no scene loaded')
	project = { previs: { mvr: { id: 'gone', name: 'x' } } }
	assert.equal(await stageMvrForMagicq(deps), null, 'scene file missing')
	project = { previs: { mvr: { id: 'ba5546d8a901', name: 'x' } } }
	assert.equal(await stageMvrForMagicq({ ...deps, showDir: path.join(tmp, 'nope') }), null, 'MagicQ never ran')
	assert.equal(fileName('a/b: "c"'), 'a b c.mvr')
	assert.equal(fileName(''), 'HighAsCG scene.mvr')
	fs.rmSync(tmp, { recursive: true, force: true })
})

function artDmx(portAddress, level) {
	const b = Buffer.alloc(18 + 512)
	b.write('Art-Net\0', 0, 'ascii')
	b.writeUInt16LE(0x5000, 8)
	b.writeUInt16BE(14, 10)
	b.writeUInt16LE(portAddress, 14)
	b.writeUInt16BE(512, 16)
	b[18] = level
	return b
}

test('a desk on this box unicasting to 127.0.0.2 reaches the visualiser, even with another :6454 socket open', async () => {
	assert.equal(LOCAL_DESK_HOST, '127.0.0.2')
	// MagicQ binds 0.0.0.0:6454 after us: a datagram to 127.0.0.1 would go to it, one to 127.0.0.2 comes to us
	const cf = new ConsoleFrames()
	cf.start()
	const desk = dgram.createSocket({ type: 'udp4', reuseAddr: true })
	await new Promise((r) => desk.bind(ARTNET_PORT, '0.0.0.0', r))
	try {
		assert.equal(cf.status().local_desk, '127.0.0.2')
		for (let i = 0; i < 20 && !cf.frame(4); i++) {
			desk.send(artDmx(4, 200), ARTNET_PORT, LOCAL_DESK_HOST)
			await new Promise((r) => setTimeout(r, 25))
		}
		assert.equal(cf.frame(4)?.[0], 200, 'universe 4 from the local desk')
		assert.equal(cf.status().universes.find((u) => u.universe === 4).from, '127.0.0.1')
	} finally {
		desk.close()
		cf.stop()
	}
	assert.equal(cf.status().local_desk, null)
})
