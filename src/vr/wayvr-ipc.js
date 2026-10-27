'use strict'

/**
 * WO-792 — a minimal client for WayVR's IPC (wayvr-ipc v26.8.0, protocol 4): abstract unix socket
 * `@/tmp/wayvr_ipc.sock`, every packet a u32 big-endian length + JSON (serde's externally tagged enums).
 *
 * WayVR serves the socket from its render loop: while its session is not visible (headset asleep or disconnected, or
 * WayVR frozen) a connection waits unanswered and `request` times out. An answer does NOT mean someone wears the
 * headset — right after start WayVR renders with the headset lying on the desk (27.10); vr-desk-panel.js checks that
 * the head pose moves.
 */

const net = require('net')

const SOCKET = '\0/tmp/wayvr_ipc.sock'
const PROTOCOL_VERSION = 4

/**
 * Handshake, send `packets`, resolve with the server packets that answer them (matched by count: one response per
 * packet that carries a serial; packets without one, like 'WlxShowHide', get none).
 * @param {Array<object|string>} packets
 * @param {{ timeoutMs?: number, connect?: Function }} [opts]
 * @returns {Promise<object[]>}
 */
function request(packets, opts = {}) {
	const timeoutMs = opts.timeoutMs || 2000
	const connect = opts.connect || (() => net.createConnection({ path: SOCKET }))
	const expected = packets.filter((p) => typeof p === 'object').length
	return new Promise((resolve, reject) => {
		const sock = connect()
		const out = []
		let buf = Buffer.alloc(0)
		let done = false
		const finish = (err) => {
			if (done) return
			done = true
			clearTimeout(timer)
			// end() flushes what was written (WayVR reads it on its next tick); then drop the socket for good
			sock.end()
			setTimeout(() => sock.destroy(), 200).unref()
			if (err) reject(err)
			else resolve(out)
		}
		const timer = setTimeout(() => finish(new Error('WayVR did not answer')), timeoutMs)
		const send = (o) => {
			const body = Buffer.from(JSON.stringify(o))
			const head = Buffer.alloc(4)
			head.writeUInt32BE(body.length)
			sock.write(Buffer.concat([head, body]))
		}
		sock.on('error', (e) => finish(e))
		sock.on('connect', () =>
			send({ Handshake: { protocol_version: PROTOCOL_VERSION, magic: 'wayvr_ipc', client_name: 'highascg' } })
		)
		sock.on('data', (d) => {
			buf = Buffer.concat([buf, d])
			while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
				const n = buf.readUInt32BE(0)
				let msg
				try {
					msg = JSON.parse(buf.subarray(4, 4 + n).toString())
				} catch (e) {
					return finish(e)
				}
				buf = buf.subarray(4 + n)
				if (msg && msg.Disconnect) return finish(new Error(`WayVR: ${msg.Disconnect.reason}`))
				if (msg && msg.HandshakeSuccess) {
					packets.forEach(send)
					if (!expected) finish()
				} else if (msg && !msg.WvrStateChanged) {
					out.push(msg)
					if (out.length >= expected) finish()
				}
			}
		})
	})
}

/** Head pose: resolves `{ hmd_pos }` while WayVR is rendering in the headset; rejects otherwise. */
async function inputState(opts) {
	const [r] = await request([{ WlxInputState: 1 }], opts)
	return r.WlxInputStateResponse[1]
}

/** WayVR's windows: [{ size_x, size_y, visible, ... }]. */
async function windowList(opts) {
	const [r] = await request([{ WvrWindowList: 1 }], opts)
	const list = r.WvrWindowListResponse[1]
	return list ? list.list : []
}

/** Show / hide WayVR's overlay set — on a fresh WayVR (nothing shown yet) it shows it, anchored 1 m in front. */
function showHide(opts) {
	return request(['WlxShowHide'], opts)
}

module.exports = { request, inputState, windowList, showHide }
