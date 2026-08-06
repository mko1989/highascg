'use strict'

/**
 * WO-450 — companion status must report the REAL Button-Subscriptions capability
 * (todos06.08: "companion connection gives false connected flag in the settings and doesnt
 * actually let me pick a button").
 *
 * probeCompanionTcp now reads the Satellite handshake (BEGIN + CAPS SUBSCRIPTIONS=…) live,
 * instead of the settings endpoint echoing the passive preview client — which is
 * disconnected whenever no picker is open and therefore always claimed "subscriptions not
 * enabled". Also: ensureSubscribed must tolerate CAPS arriving after BEGIN (separate lines).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('net')

const { probeCompanionTcp } = require('../../src/api/companion-connection-status')
const { SatellitePreviewClient } = require('../../src/companion/satellite-preview-client')

const BEGIN = 'BEGIN CompanionVersion="5.0.2+test" ApiVersion="1.12.0"\n'

/** @param {(socket: import('net').Socket) => void} onConn */
function mockSatellite(onConn) {
	return new Promise((resolve) => {
		const server = net.createServer(onConn)
		server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
	})
}

test('WO-450: probe parses CAPS SUBSCRIPTIONS=0 and the Companion version', async () => {
	const { server, port } = await mockSatellite((s) => {
		s.write(BEGIN)
		setTimeout(() => s.write('CAPS SUBSCRIPTIONS=0 NONSQUARE=1\n'), 50)
	})
	const r = await probeCompanionTcp('127.0.0.1', port)
	server.close()
	assert.equal(r.connected, true)
	assert.equal(r.subscriptionsSupported, false, 'CAPS 0 must surface as false, not null')
	assert.match(String(r.companionVersion), /^5\.0\.2/)
})

test('WO-450: probe waits past BEGIN for a delayed CAPS SUBSCRIPTIONS=1', async () => {
	const { server, port } = await mockSatellite((s) => {
		s.write(BEGIN)
		setTimeout(() => s.write('CAPS SUBSCRIPTIONS=1 NONSQUARE=1\n'), 300)
	})
	const r = await probeCompanionTcp('127.0.0.1', port)
	server.close()
	assert.equal(r.connected, true)
	assert.equal(r.subscriptionsSupported, true)
})

test('WO-450: silent server (no CAPS) still reports connected with unknown capability', async () => {
	const { server, port } = await mockSatellite(() => {})
	const r = await probeCompanionTcp('127.0.0.1', port, 2000)
	server.close()
	assert.equal(r.connected, true)
	assert.equal(r.subscriptionsSupported, null)
})

test('WO-450: ensureSubscribed survives CAPS arriving after BEGIN (the picker race)', async () => {
	const received = []
	const { server, port } = await mockSatellite((s) => {
		s.setEncoding('utf8')
		s.on('data', (d) => received.push(d))
		s.write(BEGIN)
		setTimeout(() => s.write('CAPS SUBSCRIPTIONS=1\n'), 250)
	})
	const client = new SatellitePreviewClient()
	const config = { companion: { satelliteEnabled: true, satelliteHost: '127.0.0.1', satellitePort: port } }
	try {
		const r = await client.ensureSubscribed(config, 1, 0, 0)
		assert.equal(r.ok, true, `late CAPS must not read as subscriptions_disabled (got ${JSON.stringify(r)})`)
		/* The ADD-SUB write reaches the mock server asynchronously — poll before asserting. */
		const deadline = Date.now() + 1500
		while (!received.join('').includes('ADD-SUB') && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 25))
		}
		assert.ok(
			received.join('').includes('ADD-SUB'),
			'client must send ADD-SUB once the capability is confirmed',
		)
	} finally {
		/* Without this cleanup a failed assertion leaves the ping interval + sockets alive and
		 * the test runner never exits. */
		client.shutdown()
		server.close()
	}
})
