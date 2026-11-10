'use strict'

/**
 * WO-1029 apply — the "program look on bank A / bank B comes back once" scenario body, split from
 * smoke-wo1029-virtual-apply.test.js (500-line limit). See README-virtual-boxes.md "Look banks".
 */

const assert = require('node:assert/strict')
const { assertOneCopy } = require('./virtual-boxes-checks')

const modDist = (a, b, len) => Math.min(Math.abs(a - b) % len, len - (Math.abs(a - b) % len))

/** Save two-layer looks (10 + 11) beside the seeded one-layer ones; ids look_led_2a / look_led_2b. */
async function seedTwoLayerLooks(bed) {
	const led = bed.looks.find((l) => l.id === bed.look('led', 'a'))
	const two = (v, c1, c2) => ({ ...led, id: `look_led_2${v}`, name: `LED two ${v}`, layers: [led.layers[0], { ...led.layers[0], layerNumber: 11 }].map((l, i) => ({ ...l, source: { type: 'file', value: i ? c2 : c1, label: i ? c2 : c1 } })) })
	const show = { version: 1, name: 'Virtual show', scenes: { scenes: [...bed.looks, two('a', 'LOOK_A', 'LOOK_C'), two('b', 'LOOK_B', 'E2E_STILL')] }, timelines: { timelines: [], activeId: null } }
	assert.equal((await bed.box('vb-a').node.post('/api/project/save', { project: show })).status, 200)
}

const bankOf = async (bed, ch) => (await bed.box('vb-a').node.get('/api/state')).data?.scene?.programLayerBankByChannel?.[String(ch)]
const lookLayers = (a, ch) => a.caspar.visible(ch).filter((l) => l.layer < 200).map((l) => l.layer)

/**
 * `seq` = looks taken one after another (each through the node's real take route; the last is the one under test),
 * `clips` = the clips of the last look by layer number (10, 11), `prev` = a clip of the look before it. The previous
 * look is still on the other bank at snapshot time (a fading outgoing look; a cut clears it, so it is put back by hand).
 */
async function bankScenario(bed, { LED, take, raw, dirtify, POS_TOL_S }, seq, clips, prev, wantBank) {
	const a = bed.box('vb-a')
	const ch = a.ch(LED)
	// earlier scenarios left the pointer anywhere: one extra take (the look before the last) makes the parity right
	const flips = seq.length + ((await bankOf(bed, ch)) === 'b' ? 1 : 0)
	if ((flips % 2 === 1) !== (wantBank === 'b')) seq = [seq[seq.length - 2], ...seq]
	for (const id of seq) assert.equal((await take(bed, 'vb-a', id)).status, 200, `take ${id}`)
	assert.equal(await bankOf(bed, ch), wantBank, 'the node pointer is where the takes left it')
	const base = wantBank === 'b' ? 100 : 0
	const other = wantBank === 'b' ? 0 : 100
	assert.equal((await raw(bed, 'vb-a', `PLAY ${ch}-${10 + other} ${prev}`)).status, 200)
	await bed.settle()
	const want = Object.entries(clips).map(([ln, clip]) => [Number(ln) + base, clip])
	assert.deepEqual(lookLayers(a, ch).sort((x, y) => x - y), [...want.map(([l]) => l), 10 + other].sort((x, y) => x - y), 'before: the look on its bank plus the previous look\'s leftover')
	await dirtify(bed, 'vb-a')
	const t0 = Date.now()
	const before = Object.fromEntries(want.map(([l]) => [l, a.caspar.clip(ch, l).position]))
	const r = await bed.apply('vb-a')
	assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 400))
	const row = r.data.results.find((x) => x.self)
	assert.ok(row?.applied && row.ok, JSON.stringify(row)?.slice(0, 400))
	await bed.refreshChannels('vb-a')
	assert.equal(a.ch(LED), ch)
	await bed.waitRestored('vb-a', (s) => want.every(([l]) => s[LED].pgm.some((x) => x.layer === l)) && s, 'the look is back', 20000)
	await bed.settle()
	const elapsed = (Date.now() - t0) / 1000
	// exactly ONE copy of each clip of the look on the channel, on the bank it was on, nothing on the other bank
	for (const [l, clip] of want) {
		assertOneCopy(a, ch, clip)
		assertOneCopy(a, ch, clip, { layers: [l] })
		const pos = a.caspar.clip(ch, l)
		const wantPos = before[l] + elapsed
		const len = pos.length
		assert.ok(modDist(pos.position, wantPos % len, len) <= POS_TOL_S, `${clip} on ${l} at ${pos.position.toFixed(2)} s, wanted ~${wantPos.toFixed(2)} (+-${POS_TOL_S})`)
		assert.equal(pos.playing, true)
	}
	assert.deepEqual(lookLayers(a, ch).sort((x, y) => x - y), want.map(([l]) => l).sort((x, y) => x - y), 'after: only the look\'s own layers (leftover not resurrected)')
	const clipsBack = (row.restored.clips || []).filter((x) => x.channel === ch)
	for (const [l] of want) assert.equal(clipsBack.find((x) => x.layer === l)?.via, 'look', `restored.clips layer ${l} via look: ${JSON.stringify(clipsBack)}`)
	assert.ok((row.restored.skipped || []).some((x) => x.what.includes(`layer ${10 + other}`)), `leftover on layer ${10 + other} listed in restored.skipped: ${JSON.stringify(row.restored.skipped)}`)
	assert.equal(await bankOf(bed, ch), wantBank, 'the node pointer equals the bank on Caspar')
	// a further take is normal: incoming on the other bank, the outgoing look cleared
	const next = seq[seq.length - 2]
	assert.equal((await take(bed, 'vb-a', next)).status, 200)
	await bed.settle()
	const flip = wantBank === 'b' ? 'a' : 'b'
	assert.equal(await bankOf(bed, ch), flip)
	const L = lookLayers(a, ch)
	assert.ok(L.length > 0 && L.every((l) => (flip === 'b') === (l >= 110)), `after the next take only the ${flip} bank shows: ${L}`)
	for (const clip of Object.values(clips)) assertOneCopy(a, ch, clip, { n: 0 }) // the outgoing look is gone, not parked on a bank
}

module.exports = { seedTwoLayerLooks, bankScenario }
