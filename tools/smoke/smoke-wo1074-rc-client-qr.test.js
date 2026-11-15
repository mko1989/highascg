'use strict'

/**
 * WO-1074 — the host panel shows the join address as a QR code (owner 15.11: "Add the qr").
 *  - the matrix is a well-formed QR symbol (size, the three finder patterns, timing rows) for a real join address;
 *  - it is drawn black on white with the 4-module quiet zone a phone camera needs;
 *  - the library is vendored inside the module (works offline, ships in the module tarball, no CDN);
 *  - the address in large type stays next to the code, and a failing QR never hides it.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const RC = path.join(__dirname, '..', '..', 'modules', 'rc-game', 'client')
const load = (f) => import(pathToFileURL(path.join(RC, f)).href)
const URL_ = 'http://192.168.50.17:4200/game/rc/'

const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111']
const block = (m, r0, c0) => FINDER.map((_, r) => m[r0 + r].slice(c0, c0 + 7).map((d) => (d ? 1 : 0)).join(''))

describe('WO-1074 join address QR code', () => {
	it('qrMatrix: a well-formed symbol for a join address', async () => {
		const { qrMatrix } = await load('join-code.js')
		const m = qrMatrix(URL_)
		const n = m.length
		assert.equal(n, 29, '34 bytes at level M → version 3 (29 × 29)')
		assert.ok(m.every((row) => row.length === n))
		assert.deepEqual(block(m, 0, 0), FINDER, 'finder top left')
		assert.deepEqual(block(m, 0, n - 7), FINDER, 'finder top right')
		assert.deepEqual(block(m, n - 7, 0), FINDER, 'finder bottom left')
		for (let i = 8; i < n - 8; i++) {
			assert.equal(m[6][i], i % 2 === 0, `timing row at ${i}`)
			assert.equal(m[i][6], i % 2 === 0, `timing column at ${i}`)
		}
		assert.equal(m[n - 8][8], true, 'the dark module')
		assert.notDeepEqual(qrMatrix(URL_.replace('.17', '.18')), m, 'another address, another code')
		assert.ok(qrMatrix('http://[fd00:1234:5678:9abc:def0:1234:5678:9abc]:4200/game/rc/').length > n, 'longer text, larger symbol')
	})

	it('drawQr: black on white, 4 modules of quiet zone', async () => {
		const { qrMatrix, drawQr, QR_QUIET } = await load('join-code.js')
		assert.equal(QR_QUIET, 4)
		const rects = []
		let fill = ''
		const canvas = {
			getContext: () => ({
				set fillStyle(v) {
					fill = v
				},
				fillRect: (x, y, w, h) => rects.push({ fill, x, y, w, h }),
			}),
		}
		const m = qrMatrix(URL_)
		drawQr(canvas, m, 8)
		const size = (29 + 8) * 8
		assert.equal(canvas.width, size)
		assert.equal(canvas.height, size)
		assert.deepEqual(rects[0], { fill: '#fff', x: 0, y: 0, w: size, h: size })
		const dark = rects.slice(1)
		assert.equal(dark.length, m.flat().filter(Boolean).length)
		for (const r of dark) {
			assert.equal(r.fill, '#000')
			assert.ok(r.x >= 32 && r.y >= 32 && r.x + r.w <= size - 32 && r.y + r.h <= size - 32, 'inside the quiet zone')
		}
	})

	it('the library is vendored in the module; the panel keeps the typed address', () => {
		const lib = fs.readFileSync(path.join(RC, 'vendor', 'qrcode-generator.mjs'), 'utf8')
		assert.match(lib, /Copyright \(c\) 2009 Kazuhiko Arase/)
		assert.match(lib, /Licensed under the MIT license/)
		const jc = fs.readFileSync(path.join(RC, 'join-code.js'), 'utf8')
		assert.match(jc, /from '\.\/vendor\/qrcode-generator\.mjs'/)
		assert.doesNotMatch(jc, /https?:\/\//, 'no CDN')
		assert.doesNotMatch(jc, /toDataURL|createImgTag|data:image/, 'drawn on a canvas (no data: image)')
		const host = fs.readFileSync(path.join(RC, 'host.js'), 'utf8')
		const fn = host.slice(host.indexOf('export function renderJoinCode'), host.indexOf('export function startHost'))
		assert.match(fn, /try \{[\s\S]*drawQr\(cv, qrMatrix\(url\)\)[\s\S]*\} catch \{/)
		assert.match(fn, /\}\n\tel\.append\(h\('div\.join-url', \{ text: url \}\)\)/, 'the address is printed whether the code drew or not')
		const notices = fs.readFileSync(path.join(RC, '..', '..', '..', 'THIRD_PARTY_NOTICES'), 'utf8')
		assert.match(notices, /qrcode-generator 2\.0\.4/)
	})
})
