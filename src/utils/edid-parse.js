'use strict'

/**
 * Parse EDID 1.x base block (128 bytes) into operator-friendly fields.
 * @param {string | Buffer} hexOrBuffer
 * @returns {{
 *   monitorName: string,
 *   pnpId: string,
 *   productCode: number,
 *   serial: string,
 *   edidVersion: string,
 *   sizeMm: { width: number, height: number } | null,
 *   preferredMode: string | null,
 * } | null}
 */
function parseEdidHex(hexOrBuffer) {
	const bytes = bufferFromHex(hexOrBuffer)
	if (bytes.length < 128) return null
	if (bytes[0] !== 0x00 || bytes[1] !== 0xff || bytes[7] !== 0x00) return null

	const pnpId = decodePnpId(bytes[8], bytes[9])
	const productCode = bytes[10] | (bytes[11] << 8)
	const serialNumber = bytes[12] | (bytes[13] << 8) | (bytes[14] << 16) | (bytes[15] << 24)
	const edidVersion = `${bytes[18]}.${bytes[19]}`
	const widthCm = bytes[21]
	const heightCm = bytes[22]

	let monitorName = ''
	let serialString = ''
	for (const off of [0x36, 0x48, 0x5a, 0x6c]) {
		const desc = parseDescriptor(bytes, off)
		if (desc.type === 'name' && desc.text) monitorName = desc.text
		if (desc.type === 'serial' && desc.text) serialString = desc.text
	}

	const preferred = parseDetailedTiming(bytes, 0x36)
	const preferredMode = preferred
		? `${preferred.width}x${preferred.height}@${Math.round(preferred.hz * 100) / 100}Hz`
		: null

	return {
		monitorName,
		pnpId,
		productCode,
		serial: serialString || (serialNumber ? String(serialNumber) : ''),
		edidVersion,
		sizeMm: widthCm > 0 && heightCm > 0 ? { width: widthCm * 10, height: heightCm * 10 } : null,
		preferredMode,
	}
}

/** @param {string | Buffer} hexOrBuffer */
function bufferFromHex(hexOrBuffer) {
	if (Buffer.isBuffer(hexOrBuffer)) return hexOrBuffer
	const n = String(hexOrBuffer || '').replace(/[^0-9a-fA-F]/g, '')
	if (!n.length) return Buffer.alloc(0)
	return Buffer.from(n, 'hex')
}

function decodePnpId(b8, b9) {
	const c1 = String.fromCharCode(((b8 >> 2) & 0x1f) + 64)
	const c2 = String.fromCharCode((((b8 & 3) << 3) | ((b9 >> 5) & 7)) + 64)
	const c3 = String.fromCharCode((b9 & 0x1f) + 64)
	return c1 + c2 + c3
}

/**
 * @param {Buffer} bytes
 * @param {number} off
 */
function parseDescriptor(bytes, off) {
	const pixClk = bytes[off] | (bytes[off + 1] << 8)
	if (pixClk !== 0) return { type: 'timing' }
	const tag = bytes[off + 3]
	const text = Array.from(bytes.slice(off + 5, off + 18))
		.filter((byte) => byte !== 0x0a && byte !== 0x00)
		.map((byte) => String.fromCharCode(byte))
		.join('')
		.trim()
	if (tag === 0xfc) return { type: 'name', text }
	if (tag === 0xff) return { type: 'serial', text }
	return { type: 'other', text }
}

/**
 * @param {Buffer} bytes
 * @param {number} off
 * @returns {{ width: number, height: number, hz: number } | null}
 */
function parseDetailedTiming(bytes, off) {
	const pixClk = bytes[off] | (bytes[off + 1] << 8)
	if (!pixClk) return null
	const hActive = bytes[off + 2] | ((bytes[off + 4] & 0xf0) << 4)
	const vActive = bytes[off + 5] | ((bytes[off + 7] & 0xf0) << 4)
	const hBlank = bytes[off + 3] | ((bytes[off + 4] & 0x0f) << 8)
	const vBlank = bytes[off + 6] | ((bytes[off + 7] & 0x0f) << 8)
	const hTotal = hActive + hBlank
	const vTotal = vActive + vBlank
	if (!hTotal || !vTotal || !hActive || !vActive) return null
	const hz = (pixClk * 10000) / (hTotal * vTotal)
	if (!Number.isFinite(hz) || hz <= 0) return null
	return { width: hActive, height: vActive, hz }
}

module.exports = {
	parseEdidHex,
	bufferFromHex,
	decodePnpId,
}
