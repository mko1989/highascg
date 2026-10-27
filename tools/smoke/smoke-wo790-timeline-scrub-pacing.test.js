'use strict'

/**
 * WO-790 — owner 27.10: "the seeking function in timeline still lacks quickness … when i hold mouse button and dragging
 * the video channel needs to reflect that imedietly". Caspar rebuilds the decoder on every CALL SEEK, so a seek per
 * mouse move threw each picture away before it showed: the channel froze for the whole drag. The scrub gate keeps one
 * seek per layer in flight (released by OSC file/time at the target, or MAX_WAIT_MS) and sends only the newest next.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { scrubSeek, cancelScrub, MAX_WAIT_MS } = require('../../src/engine/timeline-scrub-gate')

function fakeEngine() {
	const wire = []
	const file = { elapsed: NaN } // OSC file/time of 2-210
	const engine = {
		self: {
			amcp: { call: (ch, l, cmd, arg) => (wire.push(`CALL ${ch}-${l} ${cmd} ${arg}`), Promise.resolve()) },
			oscState: { _channels: { 2: { layers: { 210: { file } } } } },
		},
	}
	return { engine, wire, file }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const noop = () => {}

test('a drag sends the first target, then only the newest once OSC shows the first', async () => {
	const { engine, wire, file } = fakeEngine()
	for (let f = 1500; f <= 1550; f += 5) scrubSeek(engine, 2, 210, f, 50, noop)
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1500'])
	await wait(20)
	assert.strictEqual(wire.length, 1, 'held while Caspar has not shown 30 s')
	file.elapsed = 30
	await wait(20)
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1500', 'CALL 2-210 SEEK 1550'])
	file.elapsed = 31
	await wait(20)
	assert.strictEqual(wire.length, 2, 'nothing pending → nothing more')
	assert.strictEqual(engine._scrubGate.size, 0)
})

test('without an OSC answer the layer is released after MAX_WAIT_MS', async () => {
	const { engine, wire } = fakeEngine()
	scrubSeek(engine, 2, 210, 1000, 50, noop)
	scrubSeek(engine, 2, 210, 1100, 50, noop)
	await wait(MAX_WAIT_MS + 40)
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1000', 'CALL 2-210 SEEK 1100'])
	cancelScrub(engine, 2, 210)
})

test('a step back is not "shown" until the OSC position moves', async () => {
	const { engine, wire, file } = fakeEngine()
	file.elapsed = 30.04 // already inside the window of a 30.00 target
	scrubSeek(engine, 2, 210, 1500, 50, noop)
	scrubSeek(engine, 2, 210, 1490, 50, noop)
	await wait(30)
	assert.strictEqual(wire.length, 1, 'the old frame does not release the seek')
	file.elapsed = 30
	await wait(20)
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1500', 'CALL 2-210 SEEK 1490'])
	cancelScrub(engine, 2, 210)
})

test('a transport or stop cancels the waiting seek', async () => {
	const { engine, wire, file } = fakeEngine()
	scrubSeek(engine, 2, 210, 1500, 50, noop)
	scrubSeek(engine, 2, 210, 1600, 50, noop)
	cancelScrub(engine, 2, 210)
	file.elapsed = 30
	await wait(30)
	assert.deepStrictEqual(wire, ['CALL 2-210 SEEK 1500'])
})

test('wiring: both scrub branches pace, transports and stop cancel, Caspar gets 4 decoder threads (source pins)', () => {
	const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
	const send = read('src/engine/timeline-playback-amcp-send.js')
	assert.strictEqual((send.match(/scrubSeek\(this, ch, caspLayer, meta\.caspFrame, meta\.chFps,/g) || []).length, 2)
	assert.doesNotMatch(
		send,
		/self\.amcp\.call\(ch, caspLayer, 'SEEK', String\(meta\.caspFrame\)\)\.catch\(_err => \{\n\t+this\._logDebug\(`SEEK \$\{ch\}-\$\{caspLayer\} frame=\$\{meta\.frame\}( \(LOOP scrub\))? failed/
	)
	assert.match(send, /if \(startTransport\) cancelScrub\(this, ch, caspLayer\)/)
	assert.match(
		send,
		/lines\.push\(`STOP \$\{ch\}-\$\{caspLayer\}`\)\n\t+mixerDirty\.add\(ch\)\n\t+cancelScrub\(this, ch, caspLayer\)/
	)
	assert.match(read('src/engine/timeline-playback-runtime.js'), /this\._scrubGate\?\.clear\(\)/)
	assert.match(read('src/engine/timeline-playback-amcp-schedule.js'), /\t\tchFps, \/\/ WO-790/)
	assert.match(read('src/config/config-generator.js'), /<ffmpeg><producer><threads>4<\/threads><\/producer><\/ffmpeg>/)
	const patch = read('caspar/patches/wo790-ffmpeg-skip-bwdif-progressive.patch')
	assert.match(patch, /\+static bool video_is_progressive\(const AVFormatContext\* ic\)/)
	assert.ok(patch.includes('+            case AV_CODEC_ID_NOTCHLC:'))
	assert.ok(patch.includes('+            if (deint != "none" && !video_is_progressive(input.operator->())) {'))
})
