'use strict'

const http = require('http')

/** The hook endpoint: a node in the sandbox "restarts Caspar" by POSTing here (loopback only, its own fake's). */
async function startControl(host, api) {
	const server = http.createServer(async (req, res) => {
		const u = new URL(req.url, 'http://x')
		const send = (code, body) => {
			res.writeHead(code, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(body))
		}
		if (req.method === 'GET' && u.pathname === '/state') return send(200, { listening: api.isListening(), restarts: api.restarts().length })
		if (req.method === 'POST' && u.pathname === '/restart') {
			const ch = u.searchParams.get('channels')
			const down = u.searchParams.get('downMs')
			const staged = api.restartStaged({ ...(ch ? { channels: Number(ch) } : {}), ...(down ? { downMs: Number(down) } : {}), ...(api.nextRestart || {}) })
			api.nextRestart = null
			staged.up.catch(() => {})
			return send(200, { ok: true, restart: await staged.down })
		}
		send(404, { error: 'not found' })
	})
	await new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, host, resolve)
	})
	return { server, url: `http://${host}:${server.address().port}`, port: server.address().port }
}

module.exports = { startControl }
