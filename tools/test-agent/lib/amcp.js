'use strict'

/**
 * WO-836 Part 3c — a tiny AMCP client for the test tools (PRINT / INFO straight to Caspar, or through the sandbox
 * node's POST /api/amcp/raw, which fronts the simulated Caspar). No shared state with the node's own client.
 */

const net = require('net')

/**
 * Parse one AMCP reply. 200 = multi-line data ended by an empty line, 201 = one data line, 202 = no data, 4xx/5xx = error.
 * @param {string} text everything received so far
 * @returns {{ done: boolean, code?: number, status?: string, data?: string }}
 */
function parseReply(text) {
	const nl = text.indexOf('\r\n')
	if (nl < 0) return { done: false }
	const status = text.slice(0, nl)
	const code = parseInt(status.slice(0, 3), 10)
	const rest = text.slice(nl + 2)
	if (code === 200) {
		const end = rest.indexOf('\r\n\r\n')
		if (end < 0 && !rest.startsWith('\r\n')) return { done: false }
		return { done: true, code, status, data: end < 0 ? '' : rest.slice(0, end) }
	}
	if (code === 201) {
		const end = rest.indexOf('\r\n')
		if (end < 0) return { done: false }
		return { done: true, code, status, data: rest.slice(0, end) }
	}
	return { done: true, code, status, data: '' }
}

/** @returns {Promise<{code:number,status:string,data:string}>} rejects on a 4xx/5xx or a timeout */
function amcp(host, port, cmd, timeoutMs = 8000) {
	return new Promise((resolve, reject) => {
		const sock = net.connect(port, host)
		let buf = ''
		const timer = setTimeout(() => {
			sock.destroy()
			reject(new Error(`no AMCP answer to '${cmd}' from ${host}:${port} within ${timeoutMs / 1000}s`))
		}, timeoutMs)
		sock.setEncoding('utf8')
		sock.on('connect', () => sock.write(`${cmd}\r\n`))
		sock.on('data', (d) => {
			buf += d
			const r = parseReply(buf)
			if (!r.done) return
			clearTimeout(timer)
			sock.end()
			if (r.code >= 400) reject(new Error(`Caspar refused '${cmd}': ${r.status}`))
			else resolve({ code: r.code, status: r.status, data: r.data })
		})
		sock.on('error', (e) => {
			clearTimeout(timer)
			reject(new Error(`cannot reach Caspar AMCP on ${host}:${port} (${e.code || e.message})`))
		})
	})
}

module.exports = { amcp, parseReply }
