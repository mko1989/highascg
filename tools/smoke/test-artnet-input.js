'use strict'

const dgram = require('dgram')
const client = dgram.createSocket('udp4')

console.log('Art-Net sender started. Sending test values...')

let opacity = 255
let r = 255
let g = 0
let b = 0
let width = 100

const timer = setInterval(() => {
	// Cycle colors
	r = (r + 5) % 256
	g = (g + 10) % 256
	b = (b + 15) % 256
	
	const buf = Buffer.alloc(18 + 512) // Header + 512 channels
	buf.write('Art-Net\0', 0, 'ascii')
	buf.writeUInt16LE(0x5000, 8) // OpCode ArtDmx
	buf.writeUInt16BE(14, 10) // ProtVer
	buf.writeUInt8(0, 12) // Sequence
	buf.writeUInt8(0, 13) // Physical
	buf.writeUInt8(0, 14) // SubUni
	buf.writeUInt8(0, 15) // Net
	buf.writeUInt16BE(512, 16) // Length
	
	// Channels 0-14 (indices 18-32)
	buf[18] = 255 // On
	buf[19] = 0 // Border type
	buf[20] = opacity
	buf[21] = r
	buf[22] = g
	buf[23] = b
	buf[24] = width
	buf[25] = 128 // Speed
	buf[26] = 100 // Spread/Blur
	buf[27] = 255 // Glow R
	buf[28] = 255 // Glow G
	buf[29] = 0 // Glow B
	buf[30] = 10 // Radius
	buf[31] = 5 // Count
	buf[32] = 50 // Length
	
	client.send(buf, 6454, '127.0.0.1', (err) => {
		if (err) console.error('Failed to send packet:', err)
	})
	
	console.log(`Sent: On=255, Type=0, Opacity=${opacity}, Color=#${toHex(r)}${toHex(g)}${toHex(b)}, Width=${width}`)
}, 1000)

function toHex(val) {
	const hex = val.toString(16)
	return hex.length === 1 ? '0' + hex : hex
}

// Stop after 20 seconds
setTimeout(() => {
	clearInterval(timer)
	client.close()
	console.log('Test finished.')
	process.exit(0)
}, 20000)
