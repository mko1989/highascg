'use strict'

/** A ZIP of stored (uncompressed) entries, for tests that need .mvr / .gdtf archives. { name: Buffer | string } → Buffer */
const zlib = require('zlib')

function zipStored(files) {
	const locals = []
	const central = []
	let at = 0
	for (const [name, data] of Object.entries(files)) {
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
		const n = Buffer.from(name)
		const crc = zlib.crc32(buf)
		const h = Buffer.alloc(30)
		h.writeUInt32LE(0x04034b50, 0)
		h.writeUInt16LE(20, 4)
		h.writeUInt32LE(crc, 14)
		h.writeUInt32LE(buf.length, 18)
		h.writeUInt32LE(buf.length, 22)
		h.writeUInt16LE(n.length, 26)
		const c = Buffer.alloc(46)
		c.writeUInt32LE(0x02014b50, 0)
		c.writeUInt16LE(20, 4)
		c.writeUInt16LE(20, 6)
		c.writeUInt32LE(crc, 16)
		c.writeUInt32LE(buf.length, 20)
		c.writeUInt32LE(buf.length, 24)
		c.writeUInt16LE(n.length, 28)
		c.writeUInt32LE(at, 42)
		locals.push(h, n, buf)
		central.push(c, n)
		at += 30 + n.length + buf.length
	}
	const cd = Buffer.concat(central)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(Object.keys(files).length, 8)
	end.writeUInt16LE(Object.keys(files).length, 10)
	end.writeUInt32LE(cd.length, 12)
	end.writeUInt32LE(at, 16)
	return Buffer.concat([...locals, cd, end])
}

module.exports = { zipStored }
