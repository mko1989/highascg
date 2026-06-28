'use strict'

/** CRC-32 (IEEE) for ZIP store entries. */
const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let i = 0; i < 256; i++) {
		let c = i
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[i] = c >>> 0
	}
	return table
})()

/**
 * @param {Buffer} buf
 * @returns {number}
 */
function crc32(buf) {
	let c = ~0
	for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
	return (~c) >>> 0
}

/**
 * @param {string} name
 * @returns {Buffer}
 */
function encodeName(name) {
	return Buffer.from(String(name).replace(/\\/g, '/'), 'utf8')
}

/**
 * Build a ZIP (store/no-compression) from in-memory files.
 * @param {Record<string, string | Buffer>} files path → contents
 * @returns {Buffer}
 */
function buildZipStore(files) {
	/** @type {Buffer[]} */
	const parts = []
	/** @type {{ name: Buffer, crc: number, size: number, offset: number }[]} */
	const central = []
	let offset = 0

	for (const [path, content] of Object.entries(files)) {
		const name = encodeName(path)
		const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
		const crc = crc32(data)
		const size = data.length

		const local = Buffer.alloc(30 + name.length)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(0, 6)
		local.writeUInt16LE(0, 8)
		local.writeUInt16LE(0, 10)
		local.writeUInt16LE(0, 12)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(size, 18)
		local.writeUInt32LE(size, 22)
		local.writeUInt16LE(name.length, 26)
		local.writeUInt16LE(0, 28)
		name.copy(local, 30)

		parts.push(local, data)
		central.push({ name, crc, size, offset })
		offset += local.length + data.length
	}

	const centralStart = offset
	for (const entry of central) {
		const { name, crc, size } = entry
		const header = Buffer.alloc(46 + name.length)
		header.writeUInt32LE(0x02014b50, 0)
		header.writeUInt16LE(20, 4)
		header.writeUInt16LE(20, 6)
		header.writeUInt16LE(0, 8)
		header.writeUInt16LE(0, 10)
		header.writeUInt16LE(0, 12)
		header.writeUInt16LE(0, 14)
		header.writeUInt32LE(crc, 16)
		header.writeUInt32LE(size, 20)
		header.writeUInt32LE(size, 24)
		header.writeUInt16LE(name.length, 28)
		header.writeUInt16LE(0, 30)
		header.writeUInt16LE(0, 32)
		header.writeUInt16LE(0, 34)
		header.writeUInt16LE(0, 36)
		header.writeUInt32LE(0, 38)
		header.writeUInt32LE(entry.offset, 42)
		name.copy(header, 46)
		parts.push(header)
		offset += header.length
	}

	const centralSize = offset - centralStart
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(0, 4)
	end.writeUInt16LE(0, 6)
	end.writeUInt16LE(central.length, 8)
	end.writeUInt16LE(central.length, 10)
	end.writeUInt32LE(centralSize, 12)
	end.writeUInt32LE(centralStart, 16)
	end.writeUInt16LE(0, 20)

	return Buffer.concat([...parts, end])
}

module.exports = { buildZipStore, crc32 }
