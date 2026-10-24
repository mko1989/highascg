'use strict'

/**
 * WO-731 — OSC over UDP for the Behringer desks: one socket per desk, a query = the address sent without arguments
 * and answered with the same address (the desk replies to the sending port). Replies are matched by address; a
 * query that gets no answer is retried once, then fails with a message the operator can act on.
 */

const dgram = require('dgram')
const osc = require('osc')

const TIMEOUT_MS = 800

/** @param {{ host: string, port: number, timeoutMs?: number, onMessage?: Function }} opts */
function createOscUdp({ host, port, timeoutMs = TIMEOUT_MS, onMessage }) {
	const sock = dgram.createSocket('udp4')
	const waiting = new Map() // address → [resolve]
	let closed = false
	sock.on('error', () => {})
	sock.on('message', (buf) => {
		let msg
		try {
			msg = osc.readPacket(buf, { metadata: true })
		} catch {
			return
		}
		for (const m of msg.packets || [msg]) {
			const list = waiting.get(m.address)
			if (list?.length) list.shift()(m.args || [])
			onMessage?.(m)
		}
	})
	sock.bind(0)

	function send(address, args = []) {
		if (closed) return
		sock.send(Buffer.from(osc.writePacket({ address, args })), port, host)
	}

	/** Send `address` (+ args) and wait for the reply with the same address → its args. */
	async function query(address, args = []) {
		for (let attempt = 0; attempt < 2; attempt++) {
			const got = await new Promise((resolve) => {
				const list = waiting.get(address) || []
				const done = (a) => {
					clearTimeout(t)
					resolve(a)
				}
				const t = setTimeout(() => {
					const i = list.indexOf(done)
					if (i >= 0) list.splice(i, 1)
					resolve(null)
				}, timeoutMs)
				list.push(done)
				waiting.set(address, list)
				send(address, args)
			})
			if (got) return got
		}
		throw new Error(`no answer from the desk at ${host}:${port} (${address})`)
	}

	return {
		send,
		query,
		close() {
			closed = true
			try {
				sock.close()
			} catch {
				/* already closed */
			}
		},
	}
}

module.exports = { createOscUdp }
