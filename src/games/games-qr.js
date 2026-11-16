'use strict'

/**
 * WO-1105 — the join address as a QR matrix for the Godot QR dialog and the join_qr template (template/join_qr.html).
 * The encoder is the games' own (vendor/qrcode-generator.mjs — the very file modules/rc-game/client/vendor holds, MIT,
 * THIRD_PARTY_NOTICES): error correction M, smallest version that fits, like modules/rc-game/client/join-code.js.
 * The matrix travels as hex rows (bit 1 = dark, the first module in the top bit of the first digit) so a CG ADD data
 * argument stays short: a /game/world/ address is version 3, 29 rows × 8 digits.
 */

const path = require('path')
const { pathToFileURL } = require('url')

let _lib = null
const cache = new Map() // text → { n, rows } (a handful of addresses per box)

function lib() {
	if (!_lib) _lib = import(pathToFileURL(path.join(__dirname, 'vendor', 'qrcode-generator.mjs')).href).then((m) => m.default || m.qrcode)
	return _lib
}

/** One row of booleans → hex digits (padded to whole digits with light modules). */
function rowHex(bits) {
	let s = ''
	for (let i = 0; i < bits.length; i += 4) {
		let d = 0
		for (let j = 0; j < 4; j++) d = (d << 1) | (bits[i + j] ? 1 : 0)
		s += d.toString(16)
	}
	return s
}

/** Hex rows → matrix of booleans (n × n); the inverse of rowHex (tests, the template does the same in JS). */
function rowsToMatrix(n, rows) {
	return rows.map((h) => Array.from({ length: n }, (_, c) => ((parseInt(h[c >> 2], 16) >> (3 - (c & 3))) & 1) === 1))
}

/** `text` → { text, n, rows } (null for an empty text). */
async function qrRows(text) {
	const t = String(text || '')
	if (!t) return null
	if (cache.has(t)) return cache.get(t)
	const qrcode = await lib()
	const qr = qrcode(0, 'M')
	qr.addData(t, 'Byte')
	qr.make()
	const n = qr.getModuleCount()
	const rows = []
	for (let r = 0; r < n; r++) rows.push(rowHex(Array.from({ length: n }, (_, c) => qr.isDark(r, c))))
	const out = { text: t, n, rows }
	if (cache.size > 32) cache.clear()
	cache.set(t, out)
	return out
}

module.exports = { qrRows, rowsToMatrix }
