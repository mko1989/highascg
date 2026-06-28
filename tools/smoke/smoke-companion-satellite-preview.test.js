'use strict'

const { describe, it, before, after } = require('node:test')
const assert = require('node:assert/strict')
const net = require('net')
const fs = require('fs')
const path = require('path')
const { parseSatelliteLine } = require('../../src/companion/satellite-protocol.js')
const { getSatellitePreviewClient } = require('../../src/companion/satellite-preview-client.js')
const { readPreviewJpeg, CACHE_DIR } = require('../../src/companion/button-preview-cache.js')

describe('companion satellite preview', () => {
	/** @type {import('net').Server} */
	let server
	let port = 0

	before(async () => {
		server = net.createServer((socket) => {
			socket.on('error', () => {})
			socket.write('BEGIN CompanionVersion=4.0.0 ApiVersion=1.10.0\n')
			socket.write('CAPS SUBSCRIPTIONS=1\n')
			socket.on('data', (buf) => {
				const text = buf.toString('utf8')
				for (const line of text.split(/\r?\n/)) {
					if (!line.trim()) continue
					if (line.startsWith('PING')) {
						socket.write(`PONG ${line.slice(5)}\n`)
						continue
					}
					const parsed = parseSatelliteLine(line)
					if (parsed?.command === 'ADD-SUB') {
						const subId = parsed.args.SUBID
						const rgb = Buffer.from([40, 80, 120, 40, 80, 120, 40, 80, 120, 40, 80, 120])
						socket.write(
							`SUB-STATE SUBID=${subId} TYPE=BUTTON BITMAP=${rgb.toString('base64')}\n`,
						)
						socket.write(`ADD-SUB OK SUBID=${subId}\n`)
					}
					if (parsed?.command === 'REMOVE-SUB') {
						socket.write('REMOVE-SUB OK\n')
					}
				}
			})
		})
		await new Promise((resolve) => {
			server.listen(0, '127.0.0.1', () => {
				port = /** @type {import('net').AddressInfo} */ (server.address()).port
				resolve()
			})
		})
	})

	after(async () => {
		const client = getSatellitePreviewClient()
		client.shutdown()
		await new Promise((r) => setTimeout(r, 50))
		await new Promise((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()))
		})
		try {
			fs.rmSync(CACHE_DIR, { recursive: true, force: true })
		} catch {
			/* ignore */
		}
	})

	it('subscribes and writes preview jpeg cache', async () => {
		const client = getSatellitePreviewClient()
		const config = {
			companion: {
				host: '127.0.0.1',
				port: 8000,
				satelliteEnabled: true,
				satelliteHost: '127.0.0.1',
				satellitePort: port,
				previewBitmapSize: 2,
			},
		}
		client.configure(config)
		const result = await client.ensureSubscribed(config, 1, 0, 2, { waitMs: 2000 })
		assert.equal(result.ok, true)
		const hit = readPreviewJpeg(1, 0, 2)
		assert.ok(hit?.buffer?.length > 0)
		client.releaseSubscribed(1, 0, 2)
	})
})
