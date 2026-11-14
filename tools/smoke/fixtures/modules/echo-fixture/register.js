'use strict'

/**
 * WO-1076 — a test module that uses every hook an external module has (tools/smoke/smoke-wo1076-*). Factory form: the
 * host reaches core files and core npm deps (an installed copy under ~/.highascg/modules cannot resolve them by
 * relative path). Lifecycle events go to globalThis.__wo1076Probe so a smoke can count boots / shutdowns / requires.
 */

const path = require('path')

const probe = (globalThis.__wo1076Probe = globalThis.__wo1076Probe || { events: [] })
probe.events.push('require')

module.exports = function register(host) {
	const { JSON_HEADERS, jsonBody } = host.requireCore('src/api/response')
	const WebSocket = host.requireCore('ws')
	const PREFIX = '/api/echo-fixture'
	return {
		name: 'echo-fixture',
		apiPathPrefixes: [PREFIX],
		registerRoutes(routes) {
			const o = { requireCaspar: false }
			routes.get(`${PREFIX}/ping`, ({ query }) => ({ status: 200, headers: JSON_HEADERS, body: jsonBody({ pong: true, q: query?.q || '', version: host.version }) }), o)
			routes.get(`${PREFIX}/public`, () => ({ status: 200, headers: JSON_HEADERS, body: jsonBody({ public: true }) }), o)
			routes.get(`${PREFIX}/blob`, ({ req }) => ({
				status: 200,
				headers: { 'Content-Type': 'application/octet-stream', 'X-Echo-UA': String(req?.headers?.['user-agent'] || '') },
				body: Buffer.from([0, 1, 2, 255]),
			}), o)
		},
		async handleApi({ method, path: p, body }) {
			if (method === 'POST' && p === `${PREFIX}/echo`) return { status: 200, headers: JSON_HEADERS, body: jsonBody({ raw: body }) }
			return null
		},
		publicPaths: (method, p) => method === 'GET' && (p === `${PREFIX}/public` || p === '/api/settings'),
		onHttpServer(server) {
			const wss = new WebSocket.Server({ noServer: true })
			const onUpgrade = (req, socket, head) => {
				if (String(req.url || '').split('?')[0] !== `${PREFIX}/ws`) return
				wss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (d) => ws.send(`echo:${d}`)))
			}
			server.on('upgrade', onUpgrade)
			probe.events.push('http-attach')
			return {
				close() {
					server.removeListener('upgrade', onUpgrade)
					for (const c of wss.clients) c.terminate()
					wss.close()
					probe.events.push('http-detach')
				},
			}
		},
		handleStatic: ({ path: p }) => (p === '/echo-fixture-hello' ? { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'hello from handleStatic' } : null),
		staticMounts: {
			'/echo-fixture/': path.join(host.moduleDir, 'public'),
			'/echo-fixture/three/': path.join(host.coreRoot, 'node_modules', 'three', 'build'),
		},
		onBoot() {
			probe.events.push('boot')
		},
		async onShutdown() {
			probe.events.push('shutdown')
		},
	}
}
