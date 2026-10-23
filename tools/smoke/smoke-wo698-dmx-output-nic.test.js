'use strict'
/**
 * WO-698 — fixtures.dmx.iface picks the network card the fixture DMX output leaves by. Unbound, the kernel sends
 * 255.255.255.255 and sACN multicast out of the default route's NIC (eno1, the office LAN on this box) whatever
 * universe is patched; the sender binds to the chosen address instead, and falls back to the default when the address
 * is not on this box.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('dgram')
const fs = require('fs')
const path = require('path')

const { normalizeDmx } = require('../../src/fixtures/gdtf-patch')
const { ArtnetSender } = require('../../src/fixtures/artdmx')

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-698 DMX output interface', () => {
	it('normalizeDmx keeps an IPv4 iface, drops names and junk', () => {
		assert.equal(normalizeDmx({ iface: ' 2.0.0.13 ' }).iface, '2.0.0.13')
		assert.equal(normalizeDmx({ iface: 'eno2' }).iface, '')
		assert.equal(normalizeDmx().iface, '')
	})

	it('the sender binds to the chosen address and sends from it', async () => {
		const rx = dgram.createSocket('udp4')
		await new Promise((r) => rx.bind(0, '127.0.0.1', r))
		const got = new Promise((r) => rx.once('message', (_m, from) => r(from.address)))
		const s = new ArtnetSender()
		s.setInterface('127.0.0.1')
		await s.send({ host: '127.0.0.1', port: rx.address().port }, Buffer.from('x'))
		assert.equal(s._sock.address().address, '127.0.0.1')
		assert.equal(await got, '127.0.0.1')
		const same = s._sock
		s.setInterface('127.0.0.1') // unchanged → same socket
		assert.equal(s._sock, same)
		s.close()
		rx.close()
	})

	it('an address not on this box falls back to the OS default route (logged)', async () => {
		const logs = []
		const s = new ArtnetSender({ log: (lvl, m) => logs.push(m) })
		s.setInterface('192.0.2.77') // TEST-NET-1, never local
		await s.send({ host: '127.0.0.1', port: 9 }, Buffer.from('x'))
		assert.equal(s.iface, '')
		assert.equal(s._sock.address().address, '0.0.0.0')
		assert.ok(logs.some((m) => /DMX output interface 192\.0\.2\.77: .* using the OS default route/.test(m)))
		s.close()
	})

	it('the service applies the slice iface; status and the Godot picker carry it', () => {
		assert.match(SRC('src/fixtures/follow-service.js'), /engine\.configure\(slice\)\n\t\tsender\.setInterface\(engine\.dmx\.iface\)/)
		assert.match(SRC('src/fixtures/follow-engine.js'), /sacn_port: this\.dmx\.sacn_port, iface: this\.dmx\.iface \}/)
		assert.match(SRC('src/fixtures/artdmx.js'), /if \(iface\) sock\.setMulticastInterface\(iface\)/)
		const ui = SRC('godot/client/features/previs/fixtures/fixtures_section.gd')
		assert.match(ui, /_set_dmx\(\{"iface": str\(_via\.get_item_metadata\(i\)\)\}\)/)
		assert.match(ui, /Api\.get_json\("\/api\/tracking\/follow"\)/)
	})
})
