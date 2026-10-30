'use strict'

/**
 * WO-836 Part 3c — client of the Godot "eyes" (godot/client/e2e/scenarios/99_remote.gd): one newline-delimited JSON
 * command per connection, one JSON line back: {ok, result|error, ms}.
 */

const net = require('net')

/**
 * @param {number} port
 * @param {object} cmd  {cmd: 'find', label: …}
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok: boolean, result?: any, error?: string, ms?: number}>}
 */
function send(port, cmd, timeoutMs = 30000) {
	return new Promise((resolve, reject) => {
		const sock = net.connect(port, '127.0.0.1')
		let buf = ''
		const timer = setTimeout(() => {
			sock.destroy()
			reject(new Error(`the Godot client did not answer '${cmd.cmd}' within ${timeoutMs / 1000}s (hung? try: ui state, or ui stop && ui start)`))
		}, timeoutMs)
		sock.setEncoding('utf8')
		sock.on('connect', () => sock.write(JSON.stringify(cmd) + '\n'))
		sock.on('data', (d) => {
			buf += d
			const nl = buf.indexOf('\n')
			if (nl >= 0) {
				clearTimeout(timer)
				sock.end()
				try {
					resolve(JSON.parse(buf.slice(0, nl)))
				} catch {
					reject(new Error(`bad answer from the client: ${buf.slice(0, 200)}`))
				}
			}
		})
		sock.on('error', (e) => {
			clearTimeout(timer)
			reject(new Error(`cannot reach the Godot client on 127.0.0.1:${port} (${e.code || e.message}) — is the driver running? tools/test-agent/ui start`))
		})
	})
}

/** Poll until the remote answers ping (or timeout). */
async function waitUp(port, timeoutMs) {
	const until = Date.now() + timeoutMs
	let last = ''
	while (Date.now() < until) {
		try {
			const r = await send(port, { cmd: 'ping' }, 3000)
			if (r.ok) return true
		} catch (e) {
			last = e.message
		}
		await new Promise((r) => setTimeout(r, 500))
	}
	throw new Error(`the Godot client did not open its remote port ${port} within ${timeoutMs / 1000}s (${last})`)
}

module.exports = { send, waitUp }
