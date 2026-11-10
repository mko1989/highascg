'use strict'

/**
 * WO-1029 — a userland TCP forwarder for one directed pair, so a sandbox run can cut A→B while B→A keeps working.
 *
 *   const f = await createForwarder({ listenHost: '127.0.2.1', target: { host: '127.0.1.12', port: 4301 } })
 *   // A links B at `${f.host}:${f.port}`; every A→B call travels through f
 *   f.pause()    // A→B fails (connections are reset); B→A, which does not use f, is untouched
 *   f.resume()
 *   f.retarget({ host, port })   // B moved: new connections go to the new place
 *
 * Mechanism and limits: it only cuts what is ADDRESSED through it. A's saved address for B is the forwarder's, so
 * the cut is exact for that one direction. Source addresses are not preserved (the target sees 127.0.0.1), and a
 * pause is a reset/refuse of new and open TCP connections, not a silent black hole (no packet loss, no timeout
 * behaviour). No iptables, no sudo.
 */

const net = require('net')

function createForwarder({ listenHost = '127.0.0.1', listenPort = 0, target }) {
	let tgt = { ...target }
	let paused = false
	const open = new Set()
	const server = net.createServer((c) => {
		if (paused) return c.destroy()
		const t = net.connect({ host: tgt.host, port: tgt.port })
		open.add(c).add(t)
		const drop = () => {
			c.destroy()
			t.destroy()
			open.delete(c)
			open.delete(t)
		}
		c.on('error', drop).on('close', drop)
		t.on('error', drop).on('close', drop)
		c.pipe(t)
		t.pipe(c)
	})
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(listenPort, listenHost, () => {
			resolve({
				host: listenHost,
				port: server.address().port,
				address: `${listenHost}:${server.address().port}`,
				pause() {
					paused = true
					for (const s of open) s.destroy()
					open.clear()
				},
				resume() {
					paused = false
				},
				retarget(t2) {
					tgt = { ...t2 }
				},
				get paused() {
					return paused
				},
				close: () => new Promise((r) => {
					for (const s of open) s.destroy()
					server.close(() => r())
				}),
			})
		})
	})
}

module.exports = { createForwarder }
