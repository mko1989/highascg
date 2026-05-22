'use strict'

/**
 * HighAsCG tests: offline router + AMCP dispatch (no TCP to Caspar).
 *
 * For **live** Caspar AMCP on localhost, run `npm run test:highascg:live`.
 * For **live** HighAsCG HTTP → Caspar, run `HIGHASCG_HTTP_PORT=8080 npm run test:highascg:live:http`.
 *
 * Optional: probe a running server from this file only:
 *   HIGHASCG_INTEGRATION_PORT=8099 node --test tools/highascg-health-api-amcp.test.js
 *   HIGHASCG_EXPECT_CASPAR=1  — require 200 on /api/state and /api/ping
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')

const defaults = require('../../src/config/defaults')
const { defaultLogger } = require('../../src/utils/logger')
const { StateManager } = require('../../src/state/state-manager')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { routeRequest } = require('../../src/api/router')
const {
	dispatchStructuredAmcp,
	isStructuredAmcpMessage,
	TYPE_TO_PATH,
	_stripForBody,
} = require('../../src/server/ws-amcp-dispatch')

/** @param {AmcpClient} amcp @param {string[]} bucket */
function captureAmcp(amcp, bucket) {
	const sim = amcp._simulated
	const orig = sim.send.bind(sim)
	sim.send = function wrappedSend(cmd) {
		bucket.push(String(cmd).trim())
		return orig(cmd)
	}
}

function makeOfflineAmcp(overrides = {}) {
	/** @type {import('../../src/caspar/amcp-protocol').AmcpConnectionContext} */
	const ctx = {
		socket: { isConnected: false },
		config: {
			offline_mode: true,
			amcp_batch: false,
			amcp_max_batch_commands: 64,
			amcp_mixer_commit_before_amcp_batch: true,
			...overrides,
		},
		response_callback: {},
		_amcpSendQueue: Promise.resolve(),
		log: () => {},
	}
	return new AmcpClient(ctx)
}

function makeAppCtx(amcp) {
	const state = new StateManager({ logger: defaultLogger })
	const cfg = JSON.parse(JSON.stringify(defaults))
	return {
		state,
		variables: state.variables,
		config: cfg,
		gatheredInfo: {
			channelIds: [],
			channelStatusLines: {},
			channelXml: {},
			infoConfig: '',
			infoPaths: '',
			infoSystem: '',
		},
		CHOICES_MEDIAFILES: [],
		CHOICES_TEMPLATES: [],
		mediaDetails: {},
		programLayerBankByChannel: {},
		sceneDeck: { looks: [], previewSceneId: null, layerPresets: [], lookPresets: [] },
		persistence: { get: () => null, set: () => {}, remove: () => {} },
		amcp,
		_casparStatus: { connected: true, host: cfg.caspar?.host || '127.0.0.1', port: cfg.caspar?.port ?? 5250 },
		log: () => {},
		timelineEngine: null,
		getState: null,
	}
}

test('GET /api/state returns 503 when Caspar (ctx.amcp) is missing', async () => {
	const ctx = makeAppCtx(null)
	ctx.amcp = null
	const res = await routeRequest('GET', '/api/state', '', ctx, null)
	assert.equal(res.status, 503)
	const body = JSON.parse(res.body)
	assert.equal(body.error, 'Caspar not connected')
})

test('GET /api/state returns 200 with expected scene.deck shape when AMCP present', async () => {
	const amcp = makeOfflineAmcp()
	const ctx = makeAppCtx(amcp)
	const res = await routeRequest('GET', '/api/state', '', ctx, null)
	assert.equal(res.status, 200)
	const st = JSON.parse(res.body)
	assert.ok(st.scene && st.scene.deck)
	assert.ok(Array.isArray(st.scene.deck.layerPresets))
	assert.ok(Array.isArray(st.scene.deck.lookPresets))
	assert.ok(st.caspar)
})

test('POST /api/ping issues AMCP PING with token', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const res = await routeRequest(
		'POST',
		'/api/ping',
		JSON.stringify({ token: 'highascg-health' }),
		ctx,
		null,
	)
	assert.equal(res.status, 200)
	const body = JSON.parse(res.body)
	assert.equal(body.ok, true)
	assert.ok(captured.some((c) => /^PING\b/i.test(c) && c.includes('highascg-health')))
})

test('offline AMCP health: VERSION (same command family as ConnectionManager periodic check)', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const r = await amcp.version()
	assert.equal(r.ok, true)
	assert.ok(captured.some((c) => /^VERSION\b/i.test(c)))
})

test('POST /api/play records PLAY with clip', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const res = await routeRequest(
		'POST',
		'/api/play',
		JSON.stringify({ channel: 1, layer: 10, clip: 'AMB' }),
		ctx,
		null,
	)
	assert.equal(res.status, 200)
	assert.ok(captured.some((c) => /^PLAY\s+1-10\b/i.test(c) && /\bAMB\b/i.test(c)))
})

test('POST /api/amcp/batch sends each command line (sequential mode when batching off)', async () => {
	const amcp = makeOfflineAmcp({ amcp_batch: false })
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const lines = ['LOADBG 1-20 AMB', 'PLAY 1-20']
	const res = await routeRequest(
		'POST',
		'/api/amcp/batch',
		JSON.stringify({ commands: lines }),
		ctx,
		null,
	)
	assert.equal(res.status, 200)
	assert.ok(captured.some((c) => /^LOADBG\s+1-20\b/i.test(c)))
	assert.ok(captured.some((c) => /^PLAY\s+1-20\b/i.test(c)))
})

test('POST /api/amcp/raw-batch records one raw send per line', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const lines = ['CLEAR 1-10', 'CLEAR 1-20']
	const res = await routeRequest(
		'POST',
		'/api/amcp/raw-batch',
		JSON.stringify({ commands: lines }),
		ctx,
		null,
	)
	assert.equal(res.status, 200)
	const jsv = JSON.parse(res.body)
	assert.equal(jsv.rawBatch, true)
	assert.equal(jsv.count, 2)
	assert.equal(captured.filter((c) => /^CLEAR\b/i.test(c)).length, 2)
})

test('POST /api/raw forwards full cmd string', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const cmd = 'INFO 1'
	const res = await routeRequest('POST', '/api/raw', JSON.stringify({ cmd }), ctx, null)
	assert.equal(res.status, 200)
	assert.ok(captured.includes(cmd))
})

test('WebSocket structured AMCP: dispatchStructuredAmcp play matches HTTP body semantics', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const out = await dispatchStructuredAmcp(ctx, {
		type: 'play',
		id: 'ws-1',
		channel: 2,
		layer: 5,
		clip: 'CLIPPATH',
	})
	assert.equal(out && out.ok, true)
	assert.ok(captured.some((c) => /^PLAY\s+2-5\b/i.test(c) && /CLIPPATH/i.test(c)))
})

test('WebSocket structured AMCP: mixer opacity hits MIXER OPACITY', async () => {
	const amcp = makeOfflineAmcp()
	const captured = []
	captureAmcp(amcp, captured)
	const ctx = makeAppCtx(amcp)
	const out = await dispatchStructuredAmcp(ctx, {
		type: 'mixer',
		command: 'opacity',
		channel: 1,
		layer: 10,
		opacity: 0.42,
	})
	assert.equal(out && out.ok, true)
	assert.ok(captured.some((c) => /^MIXER\s+1-10\s+OPACITY\b/i.test(c) && c.includes('0.42')))
})

test('isStructuredAmcpMessage and _stripForBody', () => {
	assert.equal(isStructuredAmcpMessage({ type: 'ping', token: 'x' }), true)
	assert.equal(isStructuredAmcpMessage({ type: 'mixer', command: 'opacity' }), true)
	assert.equal(isStructuredAmcpMessage({ type: 'unknown' }), false)
	const stripped = _stripForBody({
		type: 'play',
		id: 'a',
		command: 'ignored',
		channel: 1,
		layer: 2,
		clip: 'c',
	})
	assert.deepEqual(stripped, { channel: 1, layer: 2, clip: 'c' })
	for (const t of Object.keys(TYPE_TO_PATH)) {
		assert.ok(typeof TYPE_TO_PATH[t] === 'string' && TYPE_TO_PATH[t].startsWith('/api/'))
	}
})

// —— Optional HTTP integration against a running server —— //

const integrationPortRaw = process.env.HIGHASCG_INTEGRATION_PORT || ''
const integrationPort = integrationPortRaw ? parseInt(integrationPortRaw, 10) : NaN
const runIntegration = Number.isFinite(integrationPort) && integrationPort > 0
const expectCaspar = process.env.HIGHASCG_EXPECT_CASPAR === '1' || String(process.env.HIGHASCG_EXPECT_CASPAR).toLowerCase() === 'true'

function httpRequest(method, path, { json } = {}) {
	return new Promise((resolve, reject) => {
		const body = json !== undefined ? JSON.stringify(json) : null
		const req = http.request(
			{
				hostname: '127.0.0.1',
				port: integrationPort,
				path,
				method,
				timeout: 8000,
				headers:
					json !== undefined
						? {
								'Content-Type': 'application/json',
								'Content-Length': Buffer.byteLength(body, 'utf8'),
							}
						: undefined,
			},
			(res) => {
				let text = ''
				res.on('data', (c) => {
					text += c
				})
				res.on('end', () => resolve({ status: res.statusCode, body: text }))
			},
		)
		req.on('error', reject)
		req.on('timeout', () => {
			req.destroy()
			reject(new Error('timeout'))
		})
		if (body) req.write(body)
		req.end()
	})
}

test(
	'integration: HTTP surface responds (set HIGHASCG_INTEGRATION_PORT)',
	{ skip: !runIntegration },
	async () => {
		const root = await httpRequest('GET', '/')
		assert.equal(root.status, 200)

		const settings = await httpRequest('GET', '/api/settings')
		assert.equal(settings.status, 200)

		const sceneLive = await httpRequest('GET', '/api/scene/live')
		assert.equal(sceneLive.status, 200)

		const state = await httpRequest('GET', '/api/state')
		if (expectCaspar) {
			assert.equal(state.status, 200, 'GET /api/state should be 200 when HIGHASCG_EXPECT_CASPAR=1')
			const st = JSON.parse(state.body)
			assert.ok(st.scene?.deck?.layerPresets && st.scene?.deck?.lookPresets)

			const ping = await httpRequest('POST', '/api/ping', { json: { token: 'integration' } })
			assert.equal(ping.status, 200)
			const pj = JSON.parse(ping.body)
			assert.equal(pj.ok, true)
		} else {
			assert.ok(
				state.status === 200 || state.status === 503,
				'GET /api/state should be 200 (Caspar up) or 503 (no AMCP)',
			)
		}
	},
)
