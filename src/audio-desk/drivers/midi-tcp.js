'use strict'

/**
 * WO-731 — MIDI over TCP for the Allen & Heath desks: a raw MIDI byte stream, no framing. Messages may split across
 * reads and the desk uses running status, so bytes go through a parser: real-time bytes (F8-FF, e.g. active sensing)
 * are dropped, SysEx is collected to F7, channel messages keep their status. NRPN (CC 63 / 62 / 06 [/ 26]) is
 * assembled per MIDI channel into one event. A request sends bytes and waits for the first event that matches.
 */

const net = require('net')

const TIMEOUT_MS = 1500

/** Byte parser → onEvent({ kind: 'note' | 'cc' | 'nrpn' | 'sysex', ... }). */
function createMidiParser(onEvent) {
	let status = 0
	let data = []
	let sysex = null
	const nrpn = new Map() // midi ch → { msb, lsb, vc }
	const length = (st) => ((st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 1 : 2)

	function channelMessage(st, d) {
		const ch = st & 0x0f
		const type = st & 0xf0
		if (type === 0x90) return onEvent({ kind: 'note', ch, note: d[0], vel: d[1] })
		if (type !== 0xb0) return
		onEvent({ kind: 'cc', ch, cc: d[0], value: d[1] })
		const n = nrpn.get(ch) || {}
		if (d[0] === 0x63) nrpn.set(ch, { msb: d[1] })
		else if (d[0] === 0x62) nrpn.set(ch, { msb: n.msb, lsb: d[1] })
		else if (d[0] === 0x06 && n.lsb !== undefined) {
			nrpn.set(ch, { ...n, vc: d[1] })
			onEvent({ kind: 'nrpn', ch, msb: n.msb, lsb: n.lsb, vc: d[1] })
		} else if (d[0] === 0x26 && n.vc !== undefined)
			onEvent({ kind: 'nrpn', ch, msb: n.msb, lsb: n.lsb, vc: n.vc, vf: d[1] })
	}

	return (buf) => {
		for (const b of buf) {
			if (b >= 0xf8) continue
			if (b === 0xf0) {
				sysex = [b]
				continue
			}
			if (sysex) {
				if (b === 0xf7) {
					sysex.push(b)
					onEvent({ kind: 'sysex', bytes: sysex })
					sysex = null
				} else if (b < 0x80) sysex.push(b)
				else sysex = null // a status byte inside SysEx: drop the broken message, read on
				if (sysex) continue
			}
			if (b >= 0xf0) {
				status = 0
				continue
			}
			if (b >= 0x80) {
				status = b
				data = []
				continue
			}
			if (!status) continue
			data.push(b)
			if (data.length === length(status)) {
				channelMessage(status, data)
				data = []
			}
		}
	}
}

/** @param {{ host: string, port: number, timeoutMs?: number }} opts */
function createMidiTcp({ host, port, timeoutMs = TIMEOUT_MS }) {
	let sock = null
	let ready = null
	const waiting = new Set() // { match, resolve }
	const parse = createMidiParser((evt) => {
		for (const w of waiting) {
			if (w.match(evt)) {
				waiting.delete(w)
				w.resolve(evt)
			}
		}
	})

	function connect() {
		if (ready) return ready
		ready = new Promise((resolve, reject) => {
			const s = net.createConnection({ host, port })
			const t = setTimeout(
				() => s.destroy(new Error(`the desk at ${host}:${port} did not accept a connection`)),
				timeoutMs
			)
			s.setNoDelay(true)
			s.on('connect', () => {
				clearTimeout(t)
				sock = s
				resolve(s)
			})
			s.on('data', parse)
			s.on('error', (e) => {
				clearTimeout(t)
				reject(e)
			})
			s.on('close', () => {
				sock = null
				ready = null
			})
		})
		ready.catch(() => {
			ready = null
		})
		return ready
	}

	async function send(bytes) {
		const s = await connect()
		s.write(Buffer.from(bytes))
	}

	/** Send `bytes`, resolve with the first event `match` accepts. */
	async function request(bytes, match, what) {
		await connect()
		return new Promise((resolve, reject) => {
			const w = { match, resolve }
			const t = setTimeout(() => {
				waiting.delete(w)
				reject(new Error(`no answer from the desk at ${host}:${port} (${what})`))
			}, timeoutMs)
			w.resolve = (evt) => {
				clearTimeout(t)
				resolve(evt)
			}
			waiting.add(w)
			send(bytes).catch(reject)
		})
	}

	return {
		send,
		request,
		close() {
			if (sock) sock.destroy()
			sock = null
			ready = null
		},
	}
}

module.exports = { createMidiTcp, createMidiParser }
