'use strict'

/* WO-483. Openbox ships Smart placement with `<center>yes</center>` and no `<applications>` rule
 * for casparcg, so it places new screen-consumer windows itself and discards the position the
 * config asked for. Measured on two boxes: a 1920x1080 consumer that belongs at 6144,0 sat at
 * 4032,228 — dead centre of the 9984x1536 canvas — with its monitor blank while Caspar's log read
 * `Initialized.`
 *
 * Only the operator-GUI consumer was ever placed (WO-279). PGM1 landed correctly by luck (Smart
 * cannot usefully centre a window wider than half the canvas, so it falls back to top-left); PGM2,
 * an ordinary 1080p consumer, did not.
 *
 * Rects come from the generated casparcg.config — that file IS what Caspar was told, so the
 * placement pass and the generator cannot drift apart. */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
	parseScreenConsumerRects,
	consumerTitlePattern,
	placeScreenConsumers,
} = require('../../src/system/screen-consumer-placement')

/** The box's real shape: ch1 spans two heads, ch3 and ch4 sit to the right of it. */
const XML = `<configuration><channels>
  <channel><video-mode>6144x1536</video-mode><consumers><screen>
    <device>1</device><x>0</x><y>0</y><width>6144</width><height>1536</height>
  </screen></consumers></channel>
  <channel><video-mode>6144x1536</video-mode><consumers></consumers></channel>
  <channel><video-mode>1080p5000</video-mode><consumers><screen>
    <device>2</device><x>6144</x><y>0</y><width>1920</width><height>1080</height>
  </screen></consumers></channel>
  <channel><video-mode>1080p5000</video-mode><consumers><screen>
    <device>1</device><x>8064</x><y>0</y><width>1920</width><height>1080</height>
  </screen></consumers></channel>
</channels></configuration>`

test('WO-483: rects are read per channel, skipping channels with no screen consumer', () => {
	assert.deepEqual(parseScreenConsumerRects(XML), [
		{ channel: 1, x: 0, y: 0, width: 6144, height: 1536 },
		{ channel: 3, x: 6144, y: 0, width: 1920, height: 1080 },
		{ channel: 4, x: 8064, y: 0, width: 1920, height: 1080 },
	])
	assert.deepEqual(parseScreenConsumerRects(''), [])
	assert.deepEqual(parseScreenConsumerRects('<configuration/>'), [])
})

test('WO-483: the search pattern escapes the regex metacharacters in the window title', () => {
	const p = consumerTitlePattern(3)
	assert.equal(p, 'Screen consumer \\[3\\|')
	/* An unescaped `|` would make this an alternation matching every window — a diagnostic written
	 * earlier in this session did exactly that and measured the root window instead. */
	assert.ok(new RegExp(p).test('Screen consumer [3|1080p5000]'))
	assert.ok(!new RegExp(p).test('Screen consumer [1|6144x1536]'))
})

test('WO-483: only a misplaced consumer is moved', async () => {
	const tmp = path.join(process.env.TMPDIR || '/tmp', `sc-place-${process.pid}.config`)
	fs.writeFileSync(tmp, XML)
	const calls = []
	/** ch1 correct, ch3 centre-canvas, ch4 correct. */
	const geometry = { w1: [0, 0], w3: [4032, 228], w4: [8064, 0] }
	const execFileImpl = async (bin, args) => {
		calls.push(args.join(' '))
		if (args[0] === 'search') {
			const ch = args[2].match(/\\\[(\d+)\\\|/)[1]
			return { stdout: `w${ch}\n` }
		}
		if (args[0] === 'getwindowgeometry') {
			const [x, y] = geometry[args[2]]
			return { stdout: `WINDOW=1\nX=${x}\nY=${y}\nWIDTH=1920\nHEIGHT=1080\n` }
		}
		return { stdout: '' }
	}
	const res = await placeScreenConsumers({ configPath: tmp, execFileImpl })
	fs.unlinkSync(tmp)
	assert.deepEqual(res, { moved: 1, alreadyCorrect: 2, missing: 0 })
	const moves = calls.filter((c) => c.startsWith('windowmove'))
	assert.deepEqual(moves, ['windowmove w3 6144 0'], 'only the misplaced one is touched')
})

test('WO-483: a channel whose window does not exist yet is reported, not fatal', async () => {
	const tmp = path.join(process.env.TMPDIR || '/tmp', `sc-place-none-${process.pid}.config`)
	fs.writeFileSync(tmp, XML)
	const res = await placeScreenConsumers({
		configPath: tmp,
		execFileImpl: async (bin, args) => (args[0] === 'search' ? { stdout: '' } : { stdout: '' }),
	})
	fs.unlinkSync(tmp)
	assert.deepEqual(res, { moved: 0, alreadyCorrect: 0, missing: 3 }, 'the caller retries on missing windows')
})

test('WO-483: a missing config file is survivable', async () => {
	const res = await placeScreenConsumers({ configPath: '/nonexistent/casparcg.config' })
	assert.deepEqual(res, { moved: 0, alreadyCorrect: 0, missing: 0 })
})

test('WO-483: the pass runs on the caspar-connect path', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/bootstrap/caspar-info-ready.js'), 'utf8')
	assert.match(src, /placeScreenConsumers/, 'wired into caspar-info-ready')
	assert.match(src, /for \(const waitMs of \[1500, 4000\]\)/, 'retried — windows appear after AMCP does')
})
