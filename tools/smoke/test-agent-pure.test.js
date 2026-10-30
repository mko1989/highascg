'use strict'

/**
 * WO-836 Part 3c — hermetic tests of the pure parts of tools/test-agent: argv parsing, key names, the `ui list`
 * formatter, PNG decode / crop / stats / encode, AMCP reply parsing, INFO → clip names, and `caspar print` end to end
 * against a fake AMCP server + a temp media folder (no Caspar, no node, no network beyond 127.0.0.1).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const TA = path.resolve(__dirname, '../test-agent')
const { parseArgs, parseCrop, parseChannelLayer } = require(path.join(TA, 'lib/cmdline'))
const { normalizeKey } = require(path.join(TA, 'lib/keys'))
const { line, formatList } = require(path.join(TA, 'lib/format'))
const png = require(path.join(TA, 'lib/png'))
const { parseReply } = require(path.join(TA, 'lib/amcp'))
const { parseInfo } = require(path.join(TA, 'lib/info'))

test('parseArgs: flags, values, -- and unknown flags', () => {
	const a = parseArgs(['Take', '--double', '--under', 'Live', 'x'], { bool: ['double'], val: ['under'] })
	assert.deepEqual(a.pos, ['Take', 'x'])
	assert.equal(a.flags.double, true)
	assert.equal(a.flags.under, 'Live')
	assert.deepEqual(parseArgs(['--under=Live'], { val: ['under'] }).flags, { under: 'Live' })
	assert.deepEqual(parseArgs(['--', '--weird label'], { bool: [] }).pos, ['--weird label'])
	assert.throws(() => parseArgs(['--dubble'], { bool: ['double'] }), /unknown flag --dubble/)
	assert.throws(() => parseArgs(['--under'], { val: ['under'] }), /needs a value/)
})

test('parseCrop / parseChannelLayer', () => {
	assert.deepEqual(parseCrop('10,20,30,40'), { x: 10, y: 20, w: 30, h: 40 })
	assert.throws(() => parseCrop('10,20,30'), /x,y,w,h/)
	assert.throws(() => parseCrop('1,2,0,4'), /at least 1/)
	assert.deepEqual(parseChannelLayer('3-10'), { channel: 3, layer: 10 })
	assert.deepEqual(parseChannelLayer('2'), { channel: 2, layer: null })
	assert.throws(() => parseChannelLayer('x'), /channel must look like/)
})

test('normalizeKey: names an agent writes → xdotool keysyms', () => {
	assert.equal(normalizeKey('ctrl+z'), 'ctrl+z')
	assert.equal(normalizeKey('Ctrl+Shift+Z'), 'ctrl+shift+z')
	assert.equal(normalizeKey('space'), 'space')
	assert.equal(normalizeKey('delete'), 'Delete')
	assert.equal(normalizeKey('enter'), 'Return')
	assert.equal(normalizeKey('esc'), 'Escape')
	assert.equal(normalizeKey('pagedown'), 'Next')
	assert.equal(normalizeKey('f5'), 'F5')
	assert.equal(normalizeKey('ctrl++'), 'ctrl+plus')
	assert.equal(normalizeKey('a'), 'a')
	assert.throws(() => normalizeKey('ctrl+banana'), /unknown key 'banana'/)
	assert.throws(() => normalizeKey(''), /empty key spec/)
})

test('ui list formatter: one compact line per control', () => {
	const l = line({ kind: 'button', label: 'TAKE', tip: 'Take the look on PRV to PGM', enabled: false, cx: 10, cy: 20, x: 1, y: 2, w: 30, h: 40 })
	assert.match(l, /^\[button\] "TAKE" tip="Take the look on PRV to PGM" DISABLED at 10,20 rect 1,2,30x40$/)
	const f = line({ kind: 'field', label: 'Filter…', placeholder: 'Filter…', caption: '', text: '', enabled: true, cx: 1, cy: 2, x: 0, y: 0, w: 5, h: 5 })
	assert.match(f, /^\[field\] "Filter…" value="" at 1,2/)
	assert.match(formatList({ count: 300, shown: 250, entries: [] }), /250 of 300 shown/)
})

function solid(w, h, rgba) {
	const data = Buffer.alloc(w * h * 4)
	for (let i = 0; i < w * h; i++) rgba.forEach((v, k) => (data[i * 4 + k] = v))
	return { width: w, height: h, channels: 4, data }
}

test('png: encode → decode round trip, stats incl. alpha plane', () => {
	const img = solid(8, 4, [200, 100, 50, 255])
	const back = png.decodePng(png.encodePng(img))
	assert.equal(back.width, 8)
	assert.deepEqual([...back.data.subarray(0, 4)], [200, 100, 50, 255])
	const s = png.stats(back)
	assert.deepEqual(s.mean_rgb, [200, 100, 50])
	assert.equal(s.nonblack_fraction, 1)
	assert.equal(s.mean_alpha, 255)
	assert.ok(Math.abs(s.mean_luma - (0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50)) < 0.01)
	const clear = png.stats(solid(4, 4, [200, 200, 200, 0]))
	assert.equal(clear.mean_alpha, 0)
	assert.match(clear.alpha_note, /ALL ZERO/)
	assert.equal(png.stats(solid(4, 4, [0, 0, 0, 255])).nonblack_fraction, 0)
})

test('png: crop picks the right pixels and refuses a box past the frame (no ffmpeg-style clamping)', () => {
	const img = solid(10, 10, [0, 0, 0, 255])
	for (let y = 0; y < 5; y++) for (let x = 5; x < 10; x++) img.data.set([255, 0, 0, 255], (y * 10 + x) * 4) // red top-right quadrant
	assert.equal(png.stats(png.cropImage(img, { x: 5, y: 0, w: 5, h: 5 })).mean_rgb[0], 255)
	assert.equal(png.stats(png.cropImage(img, { x: 0, y: 0, w: 5, h: 5 })).mean_rgb[0], 0)
	assert.throws(() => png.cropImage(img, { x: 8, y: 0, w: 5, h: 5 }), /exceeds the 10x10 frame/)
})

test('png: every row filter decodes (sub/up/average/paeth)', () => {
	const zlib = require('zlib')
	const w = 4
	const h = 4
	const rows = []
	const prev = Buffer.alloc(w * 3)
	const truth = []
	for (let y = 0; y < h; y++) {
		const px = Buffer.from(Array.from({ length: w * 3 }, (_, i) => (y * 37 + i * 11) & 255))
		truth.push(px)
		const f = y + 1 // filters 1..4
		const out = Buffer.alloc(w * 3 + 1)
		out[0] = f
		for (let i = 0; i < w * 3; i++) {
			const a = i >= 3 ? px[i - 3] : 0
			const b = y > 0 ? truth[y - 1][i] : 0
			const c = y > 0 && i >= 3 ? truth[y - 1][i - 3] : 0
			const p = a + b - c
			const pa = Math.abs(p - a)
			const pb = Math.abs(p - b)
			const pc = Math.abs(p - c)
			const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c
			out[i + 1] = (px[i] - pred) & 255
		}
		rows.push(out)
	}
	void prev
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(w, 0)
	ihdr.writeUInt32BE(h, 4)
	ihdr[8] = 8
	ihdr[9] = 2
	const enc = png.encodePng({ width: w, height: h, channels: 3, data: Buffer.alloc(w * h * 3) })
	// swap in our IDAT: rebuild the file from the encoder's own chunks
	const sig = enc.subarray(0, 8)
	const chunk = (t, b) => {
		const len = Buffer.alloc(4)
		len.writeUInt32BE(b.length)
		const crc = Buffer.alloc(4)
		crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(t), b])) >>> 0)
		return Buffer.concat([len, Buffer.from(t), b, crc])
	}
	const file = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
	const dec = png.decodePng(file)
	assert.deepEqual([...dec.data], [...Buffer.concat(truth)])
})

test('amcp: reply parsing for 200 / 201 / 202 / error and partial data', () => {
	assert.deepEqual(parseReply('202 PRINT OK\r\n'), { done: true, code: 202, status: '202 PRINT OK', data: '' })
	assert.equal(parseReply('201 INFO OK\r\n<channel/>\r\n').data, '<channel/>')
	assert.equal(parseReply('201 INFO OK\r\n<channel/>').done, false)
	assert.equal(parseReply('200 CLS OK\r\nA\r\nB\r\n\r\n').data, 'A\r\nB')
	assert.equal(parseReply('200 CLS OK\r\nA\r\n').done, false)
	assert.equal(parseReply('404 PRINT FAILED\r\n').code, 404)
	assert.equal(parseReply('202 PRI').done, false)
})

const INFO_XML = `<?xml version="1.0" encoding="utf-8"?><channel><format>1080p5000</format><framerate>50</framerate><stage><layer>
<layer_10><foreground><producer>ffmpeg</producer><paused>false</paused><file><name>clips/e2e_bars.mp4</name><path>clips/e2e_bars.mp4</path><time>1.5</time><time>4</time></file></foreground><background/></layer_10>
<layer_20><foreground><producer>image</producer><paused>true</paused><file><name>logo.png</name></file></foreground></layer_20>
</layer></stage></channel>`

test('info: INFO channel XML → clip name / state / time per layer; layer filter', async () => {
	const all = await parseInfo(INFO_XML)
	assert.equal(all.framerate, '50')
	const l10 = all.layers.find((l) => l.layer === 10)
	assert.equal(l10.clip, 'clips/e2e_bars.mp4')
	assert.equal(l10.state, 'playing')
	assert.equal(l10.time_s, '1.50')
	assert.equal(l10.duration_s, '4.00')
	assert.equal(all.layers.find((l) => l.layer === 20).state, 'paused')
	const one = await parseInfo(INFO_XML, 20)
	assert.deepEqual(one.layers.map((l) => l.layer), [20])
	await assert.rejects(parseInfo('nope'), /did not return channel XML/)
})

/** Fake Caspar: answers PRINT by writing a PNG into `dir`, INFO with INFO_XML, anything else 404. */
function fakeCaspar(dir, frame) {
	return new Promise((resolve) => {
		const srv = net.createServer((sock) => {
			let buf = ''
			sock.on('data', (d) => {
				buf += d
				if (!buf.includes('\r\n')) return
				const cmd = buf.split('\r\n')[0]
				buf = ''
				if (cmd.startsWith('PRINT')) {
					fs.writeFileSync(path.join(dir, '20260101T000000.png'), png.encodePng(frame))
					sock.write('202 PRINT OK\r\n')
				} else if (cmd.startsWith('INFO')) sock.write(`201 INFO OK\r\n${INFO_XML.replace(/\n/g, '')}\r\n`)
				else sock.write('404 ERROR\r\n')
			})
		})
		srv.listen(0, '127.0.0.1', () => resolve(srv))
	})
}

function runCli(bin, args, env) {
	return new Promise((resolve) => {
		const c = spawn(process.execPath, [path.join(TA, bin), ...args], { env: { ...process.env, ...env } })
		let out = ''
		c.stdout.on('data', (d) => (out += d))
		c.on('close', (code) => resolve({ code, json: JSON.parse(out.trim().split('\n').pop()) }))
	})
}

test('caspar print / info end to end against a fake Caspar (live mode, temp media folder)', async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-print-'))
	const media = path.join(tmp, 'media')
	fs.mkdirSync(media)
	const frame = solid(32, 16, [0, 0, 0, 255])
	for (let y = 0; y < 16; y++) for (let x = 16; x < 32; x++) frame.data.set([255, 255, 255, 255], (y * 32 + x) * 4) // right half white
	const srv = await fakeCaspar(media, frame)
	const env = {
		HIGHASCG_TEST_STATE: path.join(tmp, 'none.json'), // no driver: live defaults
		HIGHASCG_TEST_TARGET: 'live',
		CASPAR_HOST: '127.0.0.1',
		CASPAR_PORT: String(srv.address().port),
		HIGHASCG_PRINT_DIR: media,
	}
	try {
		const r = await runCli('caspar', ['print', '1'], env)
		assert.equal(r.json.ok, true, JSON.stringify(r.json))
		assert.equal(r.json.result.frame, '32x16')
		assert.equal(r.json.result.nonblack_fraction, 0.5)
		assert.equal(fs.readdirSync(media).length, 0, 'the scratch PRINT png is removed from the media folder')
		const c = await runCli('caspar', ['print', '1', '--crop', '16,0,16,16'], env)
		assert.equal(c.json.result.nonblack_fraction, 0.5, 'a crop never replaces the full-channel numbers (owner rule 30.10)')
		assert.equal(c.json.result.frame, '32x16')
		assert.equal(c.json.result.crop.nonblack_fraction, 1)
		assert.ok(fs.existsSync(c.json.result.crop.png))
		const bad = await runCli('caspar', ['print', '1', '--crop', '30,0,16,16'], env)
		assert.equal(bad.code, 1)
		assert.match(bad.json.error, /exceeds the 32x16 frame/)
		const i = await runCli('caspar', ['info', '1-10'], env)
		assert.deepEqual(i.json.result.layers.map((l) => l.clip), ['clips/e2e_bars.mp4'])
		assert.deepEqual(i.json.result.playing, ['10: clips/e2e_bars.mp4 (playing)'])
	} finally {
		srv.close()
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('caspar print in sandbox mode says there is no Caspar (exit 2)', async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ta-sbx-'))
	const stateFile = path.join(tmp, 'state.json')
	fs.writeFileSync(stateFile, JSON.stringify({ mode: 'sandbox', server: 'http://127.0.0.1:1', out: tmp }))
	try {
		const r = await runCli('caspar', ['print', '1'], { HIGHASCG_TEST_STATE: stateFile, HIGHASCG_TEST_TARGET: '' })
		assert.equal(r.code, 2)
		assert.match(r.json.error, /no Caspar in the sandbox/)
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('xinput refuses the operator display', () => {
	const { guardDisplay } = require(path.join(TA, 'lib/xinput'))
	assert.throws(() => guardDisplay(':0'), /never :0/)
	assert.throws(() => guardDisplay(':0.0'), /never :0/)
	assert.throws(() => guardDisplay(''), /refusing/)
	assert.equal(guardDisplay(':120'), ':120')
})
