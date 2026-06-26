/**
 * CG Studio dedicated HTTP server (default port 4300, launcher-hosted).
 */

'use strict'

const http = require('http')
const { handleStudioRequest } = require('./routes')

/**
 * @param {{ port: number, bindAddress?: string, log?: (level: string, msg: string) => void }} opts
 */
function startStudioServer(opts) {
	const port = opts.port
	const bindAddress = opts.bindAddress || '127.0.0.1'
	const log = opts.log || (() => {})

	return new Promise((resolve, reject) => {
		const server = http.createServer(async (req, res) => {
			try {
				const result = await handleStudioRequest(req)
				if (!result) {
					res.writeHead(404, { 'Content-Type': 'text/plain' })
					res.end('Not found')
					return
				}
				res.writeHead(result.status, result.headers)
				res.end(result.body)
			} catch (e) {
				log('warn', '[cg-studio] request error: ' + (e.message || e))
				res.writeHead(500, { 'Content-Type': 'text/plain' })
				res.end('Internal error')
			}
		})

		server.on('error', reject)

		server.listen(port, bindAddress, () => {
			const host = bindAddress === '0.0.0.0' ? '127.0.0.1' : bindAddress
			log('info', `[cg-studio] UI at http://${host}:${port}/`)
			resolve({
				server,
				port,
				url: `http://${host}:${port}/`,
				close: () =>
					new Promise((res, rej) => {
						server.close((err) => (err ? rej(err) : res()))
					}),
			})
		})
	})
}

module.exports = { startStudioServer }
