'use strict'

/**
 * WO-753 — tools/e2e/project-matrix.js: every screen-destination setup a project carries goes through a sandbox server
 * (load with its hardware → channel map + generated casparcg.config checked against the destinations), and on a box
 * with Caspar through the real binary too. Here: the rules on hand-made maps, the headless config rewrite, and a real
 * sandbox run on synthetic setups (no Caspar in CI).
 */

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { runMatrix, checkSetup, parseConfig, headless, setupKey } = require('../e2e/project-matrix')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo753-matrix-test-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const cfgOf = (...modes) => ({ channels: modes.map((mode, i) => ({ index: i + 1, mode, consumers: [] })), modes: { '5760x1728': { width: 5760, height: 1728 } } })
const WIDE = { mode: 'pgm_prv', videoMode: 'custom', width: 5760, height: 1728 }
const MV = { mode: 'multiview', videoMode: '1080p5000', width: 1920, height: 1080 }

test('a matching map and config pass; a stream sharing the PGM is not a duplicate', () => {
	const map = { programChannels: [1], previewChannels: [2], multiviewChannels: [3], streamingCh: 1 }
	assert.deepEqual(checkSetup([WIDE, MV], map, cfgOf('5760x1728', '5760x1728', '1080p5000')), [])
})

test('missing channels, a channel used twice, a stream past the end, an undefined mode, a wrong PGM size', () => {
	const cfg = cfgOf('5760x1728', '5760x1728', '1080p5000')
	assert.match(checkSetup([WIDE, MV], { programChannels: [1], previewChannels: [2] }, cfg).join(), /0 multiview channels for 1/)
	assert.match(checkSetup([WIDE, MV], { programChannels: [1], previewChannels: [1], multiviewChannels: [3] }, cfg).join(), /channel 1 used twice/)
	assert.match(checkSetup([WIDE], { programChannels: [1], previewChannels: [2], streamingCh: 4 }, cfg).join(), /channel 4 is not in casparcg.config/)
	assert.match(checkSetup([MV], { multiviewChannels: [1] }, cfgOf('3000x1000')).join(), /video mode 3000x1000 is neither standard nor defined/)
	assert.match(checkSetup([WIDE], { programChannels: [3], previewChannels: [2] }, cfg).join(), /PGM sizes 1920x1080 ≠ destinations 5760x1728/)
})

test('setups are told apart by modes and sizes', () => {
	const p = (d) => ({ hardwareConfig: { screenDestinations: { destinations: d } } })
	assert.equal(setupKey(p([MV, WIDE])), setupKey(p([WIDE, MV])))
	assert.notEqual(setupKey(p([WIDE])), setupKey(p([{ ...WIDE, width: 3840 }])))
	assert.equal(setupKey({}), '(none)')
})

test('the headless rewrite keeps only renamed shm consumers, its own ports and paths, no OSC clients or system audio', async () => {
	const xml = `<configuration><paths><media-path>media/</media-path></paths><system-audio><device-name/></system-audio>
<channels><channel><video-mode>1080p5000</video-mode><consumers><screen><device>1</device></screen><shm><name>opgui</name></shm><decklink><device>1</device></decklink></consumers></channel></channels>
<controllers><tcp><port>5250</port><protocol>AMCP</protocol></tcp></controllers>
<osc><default-port>6250</default-port><predefined-clients><predefined-client><address>127.0.0.1</address><port>6251</port></predefined-client></predefined-clients></osc>
<ndi><auto-load>true</auto-load></ndi><html><remote-debugging-port>9222</remote-debugging-port></html></configuration>`
	const out = headless(xml, { dir: '/x', amcp: 7001, osc: 7002, debug: 7003, tag: 't' })
	const cfg = await parseConfig(out)
	assert.deepEqual(cfg.channels[0].consumers, ['shm'])
	assert.match(out, /<shm><name>t-0<\/name><\/shm>/)
	assert.match(out, /<port>7001<\/port>/)
	assert.match(out, /<remote-debugging-port>7003<\/remote-debugging-port>/)
	assert.match(out, /<media-path>\/x\/media\/<\/media-path>/)
	assert.ok(!/predefined-client|system-audio|6251|5250|<auto-load>true/.test(out), out)
})

test('a sandbox loads each synthetic setup with its hardware and the server agrees with it', { timeout: 120000 }, async () => {
	const dir = path.join(tmp, 'projects')
	fs.mkdirSync(dir)
	const write = (slug, destinations) =>
		fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ version: 1, name: slug, slug, scenes: [], hardwareConfig: { version: 2, screenDestinations: { version: 1, destinations } } }))
	write('wo753_wide', [{ id: 'a', label: 'LED', mainScreenIndex: 0, ...WIDE }])
	write('wo753_mv', [
		{ id: 'a', label: 'PGM', mode: 'pgm_only', videoMode: '1080p5000', width: 1920, height: 1080, mainScreenIndex: 0 },
		{ id: 'b', label: 'PGM 2', mode: 'pgm_only', videoMode: '2160p5000', width: 3840, height: 2160, mainScreenIndex: 1 },
		{ id: 'm', label: 'MV', ...MV },
	])
	write('wo753_gui', [{ id: 'g', label: 'GUI', mode: 'operator_gui', videoMode: '1080p5000', width: 1920, height: 1080 }])
	const results = await runMatrix({ projectsDir: dir, all: true })
	const by = Object.fromEntries(results.map((r) => [r.slug, r]))
	for (const r of results) assert.equal(r.status, 'pass', `${r.slug}: ${r.errors.join('; ')}`)
	assert.deepEqual(by.wo753_wide.channels, ['1:5760x1728', '2:5760x1728'])
	assert.deepEqual(by.wo753_mv.channels, ['1:1080p5000', '2:2160p5000', '3:1080p5000'])
	assert.deepEqual(by.wo753_gui.channels, ['1:1080p5000'])
})
