'use strict'

/**
 * WO-715 — every OSC message is handled ONCE. osc.js emits 'bundle' and then 'message' for each packet in it
 * (osc-transports.js fireBundleEvents), so a listener on both ran all of Caspar's OSC (one bundle per channel per
 * frame) through OscState twice. Real UDP on a loopback test port, never the box's 6250 / 6251.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const fs = require('node:fs')
const path = require('node:path')
const osc = require('osc')

const { OscListener } = require('../../src/osc/osc-listener')

const freePort = () =>
	new Promise((resolve) => {
		const s = dgram.createSocket('udp4')
		s.bind(0, '127.0.0.1', () => {
			const p = s.address().port
			s.close(() => resolve(p))
		})
	})
const until = async (fn, ms = 2000) => {
	const end = Date.now() + ms
	while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
}

describe('WO-715 OSC bundle members are handled once', () => {
	it('a bundle (with a nested bundle) and a bare message: one handleOscMessage per message', async () => {
		const port = await freePort()
		const seen = []
		const l = new OscListener(
			{ enabled: true, listenAddress: '127.0.0.1', listenPort: port, floatByteOrder: 'auto' },
			() => {},
			{ handleOscMessage: (m) => seen.push(m.address) }
		)
		l.start()
		await new Promise((r) => setTimeout(r, 50))
		const bundle = osc.writePacket({
			timeTag: osc.timeTag(0),
			packets: [
				{ address: '/channel/1/format', args: [{ type: 's', value: '720p5000' }] },
				{ address: '/channel/1/framerate', args: [{ type: 'i', value: 50 }] },
				{
					timeTag: osc.timeTag(0),
					packets: [{ address: '/channel/1/stage/layer/10/frame', args: [{ type: 'i', value: 3 }] }],
				},
			],
		})
		const bare = osc.writePacket({ address: '/channel/1/mixer/audio/volume', args: [{ type: 'i', value: 0 }] })
		const tx = dgram.createSocket('udp4')
		await new Promise((r) => tx.send(Buffer.from(bundle), port, '127.0.0.1', r))
		await new Promise((r) => tx.send(Buffer.from(bare), port, '127.0.0.1', r))
		await until(() => seen.length >= 4)
		await new Promise((r) => setTimeout(r, 100)) // a duplicate would land in this window
		tx.close()
		l.stop()
		assert.deepEqual(seen.sort(), [
			'/channel/1/format',
			'/channel/1/framerate',
			'/channel/1/mixer/audio/volume',
			'/channel/1/stage/layer/10/frame',
		])
		assert.equal(l.getStats().received, 4, 'the diagnostics counter counts messages once too')
	})

	it('source pin: no bundle handler in osc-listener.js', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/osc/osc-listener.js'), 'utf8')
		assert.doesNotMatch(src, /on\('bundle'/)
		assert.match(src, /udpPort\.on\('message'/)
	})
})
