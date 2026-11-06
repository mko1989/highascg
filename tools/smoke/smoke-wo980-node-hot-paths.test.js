'use strict'

/**
 * WO-980 (node hot-path sweep): three behaviour-preserving cuts on the polled request paths.
 * 1. isVolumeMountedSync reads /proc/self/mountinfo instead of spawning `findmnt -T` (3 spawnSyncs per project read).
 * 2. media dedupe sorts with one cached Intl.Collator — same order as localeCompare(…, undefined, { sensitivity: 'base' }).
 * 3. the follow self-loop guard resolves the Art-Net input patch ONCE per poll (it was two full project reads).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('isVolumeMountedSync: mountinfo lookup, octal escapes decoded, no findmnt spawn', (t) => {
	const vs = require('../../src/engine/project-volume-sync')
	const src = read('src/engine/project-volume-sync.js')
	assert.doesNotMatch(src, /execFileSync\(['"]findmnt/)
	assert.match(src, /readFileSync\('\/proc\/self\/mountinfo', 'utf8'\)/)
	if (process.platform !== 'linux') return t.skip('linux only')
	assert.equal(vs.isVolumeMountedSync('/'), true)
	assert.equal(vs.isVolumeMountedSync('/definitely/not/a/mount/wo980'), false)
	assert.equal(vs.isVolumeMountedSync(''), false)
	const table = [
		'22 1 259:2 / / rw,relatime shared:1 - ext4 /dev/nvme0n1p2 rw',
		'117 34 259:6 / /home/u/my\\040stick rw,relatime shared:160 - exfat /dev/sda3 rw',
		'118 34 259:7 / /media/x\\134y rw - vfat /dev/sdb1 rw',
		'',
	].join('\n')
	const orig = fs.readFileSync
	fs.readFileSync = (p, ...rest) => (p === '/proc/self/mountinfo' ? table : orig(p, ...rest))
	try {
		assert.equal(vs.isVolumeMountedSync('/home/u/my stick'), true)
		assert.equal(vs.isVolumeMountedSync('/home/u/my stick/'), true) // path.resolve drops the trailing slash
		assert.equal(vs.isVolumeMountedSync('/media/x\\y'), true)
		assert.equal(vs.isVolumeMountedSync('/home/u/my\\040stick'), false) // escaped form is not the path
		assert.equal(vs.isVolumeMountedSync('/home/u'), false) // a parent of a mount is not a mount point
		assert.equal(vs.isVolumeMountedSync('/home/u/my stick/projects'), false) // nor is a dir inside one
	} finally {
		fs.readFileSync = orig
	}
	fs.readFileSync = () => {
		throw new Error('no proc')
	}
	try {
		assert.equal(vs.isVolumeMountedSync('/'), false)
	} finally {
		fs.readFileSync = orig
	}
})

test('dedupeMediaList: Collator order is identical to the old localeCompare order', () => {
	const { dedupeMediaList } = require('../../src/utils/media-browser-dedupe')
	const src = read('src/utils/media-browser-dedupe.js')
	assert.match(src, /const ID_COLLATOR = new Intl\.Collator\(undefined, \{ sensitivity: 'base' \}\)/)
	assert.doesNotMatch(src, /\.localeCompare\(String\(b\.id\)/)
	const ids = [
		'Tła na diodę/b.mov', 'tła na diodę/A.mov', 'BUMPERY/WSS-10s.mp4', 'bumpery/wss-10s', 'Ąbc.png', 'abc.png', 'Zeta',
		'zeta.mp4', '4. TŁO 4 - DELIKATNE FALE', '4. Tło 4 - delikatne fale.mp4', '10 clip.mp4', '2 clip.mp4', 'Éclair.mov',
		'eclair2.mov', 'ß.png', 'ss.png', '_x.mp4', '-y.mp4', 'exfat/TALK2.mp4', 'bridge/TALK2.mp4', 'a/b/c.mp4',
	]
	const rows = ids.map((id, i) => ({ id, label: id, ...(i % 3 === 0 ? { resolution: '1920x1080' } : {}) }))
	const out = dedupeMediaList(rows).map((r) => r.id)
	const expected = [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
	assert.deepEqual(out, expected)
	assert.ok(out.length > 10 && out.length < ids.length, 'some rows merged, most kept')
})

test('follow guard: one resolveArtnetPatch per guard key, same values as inputPortAddress', () => {
	const src = read('src/fixtures/follow-service.js')
	assert.match(src, /const guardKey = \(\) => JSON\.stringify\(\[\.\.\.inputPatchPair\(ctx\), \[\.\.\.localTargets\(\)\]\.sort\(\)\]\)/)
	const m = src.match(/function inputPatchPair\(ctx\) \{[\s\S]*?\n\}\n/)
	assert.ok(m, 'inputPatchPair present')
	const slot = require('../../src/artnet/artnet-slot-config')
	const { inputPortAddress } = require('../../src/fixtures/follow-service')
	const orig = slot.resolveArtnetPatch
	let calls = 0
	let patch = { net: 3, subnet: 7, universe: 21 }
	slot.resolveArtnetPatch = () => {
		calls++
		if (!patch) throw new Error('boom')
		return patch
	}
	try {
		const inputPatchPair = new Function('require', `${m[0]}; return inputPatchPair`)((p) =>
			require(path.join(ROOT, 'src', 'fixtures', p)),
		)
		const ctx = { config: { dmx: {} } }
		calls = 0
		const pair = inputPatchPair(ctx)
		assert.equal(calls, 1)
		assert.deepEqual(pair, [inputPortAddress(ctx), 21 & 0x0f])
		assert.deepEqual(inputPatchPair({ config: { dmx: { artnetInputEnabled: false } } }), [null, null])
		assert.equal(inputPortAddress({ config: { dmx: { artnetInputEnabled: false } } }), null)
		patch = null
		assert.deepEqual(inputPatchPair(ctx), [0, 0])
		assert.equal(inputPortAddress(ctx), 0)
	} finally {
		slot.resolveArtnetPatch = orig
	}
})
