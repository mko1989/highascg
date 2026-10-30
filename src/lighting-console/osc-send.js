'use strict'

/**
 * WO-837 — one-shot OSC over UDP for the lighting consoles: a datagram per message from a throw-away socket (the
 * consoles are control targets, never queried, so no reply is read). Resolves when the OS has accepted every
 * datagram; rejects with a message naming the console address when it could not (bad host, unreachable network).
 */

const dgram = require('dgram')
const osc = require('osc')

/** @param {{ host: string, port: number }} target @param {{ address: string, args: object[] }[]} messages */
function sendOsc({ host, port }, messages) {
	return new Promise((resolve, reject) => {
		const sock = dgram.createSocket(/^[0-9a-f]*:[0-9a-f:]+$/i.test(host) && host.includes(':') ? 'udp6' : 'udp4')
		let left = messages.length
		let failed = false
		const done = (err) => {
			if (failed) return
			if (err) {
				failed = true
				try {
					sock.close()
				} catch {
					/* closed */
				}
				reject(new Error(`could not send to ${host}:${port}: ${err.message}`))
			} else if (--left <= 0) {
				try {
					sock.close()
				} catch {
					/* closed */
				}
				resolve()
			}
		}
		sock.on('error', done)
		if (!messages.length) return done(null)
		for (const m of messages) sock.send(Buffer.from(osc.writePacket({ address: m.address, args: m.args || [] })), port, host, done)
	})
}

module.exports = { sendOsc }
