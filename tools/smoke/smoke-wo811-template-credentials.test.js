'use strict'

/**
 * WO-811 template credentials — against a SANDBOX server (port 0, own config, own token file; never the box's node or
 * its .private/api-token), enforcement ON unless a test says otherwise:
 * - the node's TEMPLATE KEY (random per node start, in memory) opens /api/ws and /api/video-feed as `?template_key=`
 *   from the Caspar host, and nothing else (no HTTP route, not as Bearer / cookie / ?token=, not from another host);
 * - a template-key socket is read-only (no AMCP);
 * - every real template's WS URL, built from what the node hands it, is accepted (multiview chrome, playback timers,
 *   shader FFT tier);
 * - every AMCP string the node builds for those templates (multiview apply, scene take CG lines, timers [HTML] URL,
 *   BEGIN…COMMIT batch) reaches the wire with the template key and WITHOUT the shared password; a line that carries
 *   the password is refused.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const vm = require('vm')
const WebSocket = require('ws')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo811t-'))
process.env.HIGHASCG_API_TOKEN_FILE = path.join(TMP, 'api-token') // never the box's .private/api-token

const auth = require('../../src/server/auth')
const tc = require('../../src/server/template-credential')
const { prepareAmcpLine, injectTemplateCredential, unparam } = require('../../src/caspar/amcp-template-credential')
const { routeRequest } = require('../../src/api/router')
const { startHttpServer } = require('../../src/server/http-server')
const { attachWebSocketServer } = require('../../src/server/ws-server')
const { attachVideoFeed } = require('../../src/system/video-feed')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { buildSceneTemplateCgAmcpLines } = require('../../src/engine/scene-template-cg')
const { applyMultiviewOverlay } = require('../../src/engine/multiview-apply-overlay')
const { redactAmcpCommandForLog } = require('../../src/streaming/stream-secret-redact')
const { buildClipCommandPlan, serializeClipCommandPlan } = require('../../src/caspar/amcp-command-plan')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const PW = 'wo811-shared-password-tpl'
const KEY = tc.templateCredential()
const logLines = []
const ctx = {
	config: { security: { enforceAuth: true, apiToken: PW }, caspar: { host: '127.0.0.1', port: 5250 } },
	log: () => {},
}
let server
let port
let feed

test.before(async () => {
	auth.setAuthRuntime({ enforceAuth: true })
	server = startHttpServer({
		port: 0,
		bindAddress: '127.0.0.1',
		webDir: TMP,
		routeApi: (m, p, b, req) => routeRequest(m, p, b, ctx, req),
		log: (m) => logLines.push(String(m)),
	})
	await new Promise((r) => server.once('listening', r))
	port = server.address().port
	attachWebSocketServer(server, ctx, { log: (m) => logLines.push(String(m)) })
	feed = attachVideoFeed(server, ctx, {})
})

test.after(() => {
	auth.setAuthRuntime({ enforceAuth: false })
	try {
		feed?.close()
	} catch {}
	server?._highascgDestroyTrackedSockets?.()
	server?.close()
	fs.rmSync(TMP, { recursive: true, force: true })
	delete process.env.HIGHASCG_API_TOKEN_FILE
})

function get(p, headers = {}) {
	return new Promise((resolve, reject) => {
		http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
			res.resume()
			res.on('end', () => resolve(res.statusCode))
		}).on('error', reject)
	})
}

/** → 'open' or the HTTP status the upgrade was refused with. */
function wsTry(p, headers = {}) {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers })
		ws.on('open', () => {
			ws.terminate()
			resolve('open')
		})
		ws.on('unexpected-response', (_req, res) => {
			resolve(res.statusCode)
			res.resume()
		})
		ws.on('error', () => resolve('error'))
	})
}

/** Open, send `msg`, collect what comes back for `ms`. */
function wsExchange(p, msg, headers = {}, ms = 300) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}${p}`, { headers })
		const got = []
		ws.on('message', (d) => got.push(JSON.parse(String(d))))
		ws.on('open', () => {
			setTimeout(() => {
				got.length = 0 // drop the connect-time state/osc snapshots
				ws.send(JSON.stringify(msg))
				setTimeout(() => {
					ws.terminate()
					resolve(got.map((m) => m.type))
				}, ms)
			}, 150)
		})
		ws.on('unexpected-response', (_q, res) => reject(new Error(`refused ${res.statusCode}`)))
	})
}

const q = `template_key=${KEY}`

test('the template key: random per node process, 64 hex, not the shared password, never on disk', () => {
	assert.match(KEY, /^[0-9a-f]{64}$/)
	assert.notEqual(KEY, PW)
	const src = read('src/server/template-credential.js')
	assert.match(src, /const KEY = crypto\.randomBytes\(32\)\.toString\('hex'\)/)
	assert.ok(!/writeFile|fs\./.test(src), 'no file I/O in template-credential.js')
	assert.ok(!fs.readdirSync(TMP).length, 'nothing written to the sandbox token dir either')
})

test('enforcement ON: the template key opens /api/ws and /api/video-feed from the Caspar host', async () => {
	assert.equal(await wsTry(`/api/ws?${q}`), 'open', 'ws')
	assert.equal(await wsTry(`/ws?${q}`), 'open', 'legacy /ws')
	assert.equal(await wsTry(`/api/video-feed?width=320&fps=5&${q}`), 'open', 'video feed')
	assert.equal(await wsTry('/api/ws?template_key=' + 'f'.repeat(64)), 401, 'a wrong key')
	assert.equal(await wsTry('/api/ws'), 401, 'no credential')
})

test('enforcement ON: the template key is nothing else — not HTTP, not Bearer/cookie/?token=', async () => {
	assert.equal(await get(`/api/logs?${q}`), 401, 'HTTP ?template_key=')
	assert.equal(await get('/api/logs', { Authorization: `Bearer ${KEY}` }), 401, 'HTTP Bearer')
	assert.equal(await get(`/api/logs?token=${KEY}`), 401, 'HTTP ?token=')
	assert.equal(await wsTry(`/api/ws?token=${KEY}`), 401, 'WS ?token=')
	assert.equal(await wsTry('/api/ws', { Authorization: `Bearer ${KEY}` }), 401, 'WS Bearer')
	assert.equal(await wsTry('/api/ws', { Cookie: `highascg_session=${KEY}` }), 401, 'WS cookie')
	assert.equal(await get('/api/logs', { Authorization: `Bearer ${PW}` }), 200, 'the shared password still works for clients')
})

test('enforcement ON: only from the Caspar host', async () => {
	ctx.config.caspar.host = '10.255.255.1' // Caspar on another machine → loopback is not the Caspar host
	try {
		assert.equal(await wsTry(`/api/ws?${q}`), 401)
	} finally {
		ctx.config.caspar.host = '127.0.0.1'
	}
	const req = (remoteAddress, url = `/api/ws?${q}`) => ({ url, socket: { remoteAddress } })
	assert.ok(tc.isTemplateCredentialRequest(req('::ffff:127.0.0.1'), ctx.config), 'IPv4-mapped loopback')
	assert.ok(!tc.isTemplateCredentialRequest(req('192.0.2.7'), ctx.config), 'a LAN host')
	assert.ok(tc.isTemplateCredentialRequest(req('192.0.2.7'), { caspar: { host: '192.0.2.7' } }), 'remote Caspar')
	assert.ok(!tc.isTemplateCredentialRequest(req('127.0.0.1'), { caspar: { host: '192.0.2.7' } }), 'remote Caspar, loopback')
})

test('enforcement ON: a template-key socket is read-only (no AMCP), resync allowed', async () => {
	const amcp = { type: 'amcp', cmd: 'INFO', id: 1 }
	assert.deepEqual(await wsExchange(`/api/ws?${q}`, amcp), [], 'template: AMCP ignored, no reply')
	assert.deepEqual(await wsExchange('/api/ws', amcp, { Authorization: `Bearer ${PW}` }), ['error'], 'password client: handled (AMCP not connected)')
	const resync = await wsExchange(`/api/ws?${q}`, { type: 'osc_resync', id: 2 })
	assert.ok(resync.includes('osc_resync_ok'), `template: resync answered (${resync})`)
})

test('enforcement ON: the upgrade log line never carries the template key', async () => {
	logLines.length = 0
	await wsTry(`/api/ws?${q}`)
	const upgrade = logLines.filter((l) => l.includes('[HTTP Server Upgrade]'))
	assert.ok(upgrade.length > 0 && upgrade.every((l) => l.includes('template_key=***')), upgrade.join('\n'))
	assert.ok(!logLines.some((l) => l.includes(KEY)))
})

test('enforcement OFF: templates connect without a key, as before', async () => {
	auth.setAuthRuntime({ enforceAuth: false })
	try {
		assert.equal(await wsTry('/api/ws'), 'open')
		assert.equal(injectTemplateCredential('CG 1-10 ADD 0 "shaders/x" 1 "{}"', ctx.config), 'CG 1-10 ADD 0 "shaders/x" 1 "{}"', 'no key in AMCP while off')
	} finally {
		auth.setAuthRuntime({ enforceAuth: true })
	}
})

/** A real AmcpClient over a fake Caspar socket: every string that would hit the wire is kept. */
function wireClient(config) {
	const wire = []
	const conn = { config, response_callback: {}, log: () => {} }
	conn.socket = {
		isConnected: true,
		send(s) {
			wire.push(String(s))
			setImmediate(() => {
				if (String(s).startsWith('BEGIN')) return conn._amcpBatchDrain?.onLine('202 COMMIT OK')
				const key = String(s).trim().split(/\s+/)[0].toUpperCase()
				conn.response_callback[key]?.shift()?.(null, '202 OK')
			})
		},
	}
	return { amcp: new AmcpClient(conn), wire }
}

const TIMERS_URL = 'http://127.0.0.1:4200/templates/playback_timers.html'

test('AMCP: what the node sends for the templates carries the template key and never the shared password', async () => {
	const config = { ...ctx.config, amcp_batch: true }
	const { amcp, wire } = wireClient(config)
	// 1. the multiview chrome — the real apply, the data built where it was (multiview-apply-overlay.js)
	await applyMultiviewOverlay({ config, amcp, log: () => {} }, 3, 20, {
		layout: [{ id: 'pgm_1', label: 'PGM', x: 0, y: 0, w: 0.5, h: 0.5, source: 'route://1' }],
		showOverlay: true,
		showTimersUnderLabels: false,
		timerScale: 100,
		highlightTopTimer: true,
		programChannels: [1],
		previewChannels: [2],
		inputsCh: null,
		decklinkInputChannels: [],
	})
	// 2. a shader look layer at take time (scene-template-cg.js), single sends and a BEGIN…COMMIT batch
	const shaderLines = buildSceneTemplateCgAmcpLines(1, 10, { cgName: 'shaders/sh-test', data: '{"beat":{"kick":1}}' }, {})
	for (const l of shaderLines) await amcp.raw(l)
	await amcp.batchSend(buildSceneTemplateCgAmcpLines(2, 10, { cgName: 'shaders/sh-test', data: '{}' }, {}))
	// 3. the playback timers strip (a browser source URL): the take's serialized play plan (scene-take-lbg-amcp-pipeline.js)
	await amcp.raw(serializeClipCommandPlan(buildClipCommandPlan('PLAY', 1, 30, TIMERS_URL, { transition: 'MIX', duration: 25 })))
	// 4. a template that does not use the node WS gets nothing
	await amcp.cgAdd(1, 40, 0, 'lower-thirds/lt-classic-box', 1, '{"data":{"title":"A"}}')

	const all = wire.join('\n')
	assert.ok(!all.includes(PW), 'the shared password is in no AMCP string')
	assert.ok(!all.includes(encodeURIComponent(PW)) && !/apiToken/.test(all), 'not encoded, no apiToken field')
	const mv = wire.find((l) => /^CG 3-20 ADD 0 "multiview_(master|overlay)"/.test(l))
	assert.ok(mv, wire.join('\n'))
	const mvData = JSON.parse(unparam(mv.replace(/^CG 3-20 ADD 0 "multiview_\w+" 0 /, '')))
	assert.equal(mvData.templateKey, KEY, 'multiview chrome data')
	assert.ok(Array.isArray(mvData.cells), 'the chrome data of before is intact')
	const sh = wire.find((l) => l.startsWith('CG 1-10 ADD 0 "shaders/sh-test" 1 '))
	assert.deepEqual(JSON.parse(unparam(sh.split(' 1 ').slice(1).join(' 1 '))), { beat: { kick: 1 }, templateKey: KEY }, 'shader data')
	const batch = wire.find((l) => l.startsWith('BEGIN'))
	assert.ok(batch && batch.includes(`\\"templateKey\\":\\"${KEY}\\"`), 'shader inside BEGIN…COMMIT')
	const timers = wire.find((l) => l.startsWith('PLAY 1-30 [HTML] '))
	assert.equal(timers, `PLAY 1-30 [HTML] ${TIMERS_URL}#template_key=${KEY} MIX 25 linear`, 'timers URL')
	assert.ok(wire.includes('CG 1-40 ADD 0 "lower-thirds/lt-classic-box" 1 {\\"data\\":{\\"title\\":\\"A\\"}}'), 'LT untouched')
	assert.equal(redactAmcpCommandForLog(timers).includes(KEY), false, "the node's own AMCP log masks the key")
})

test('AMCP: a line that carries the shared password is refused before the wire (single, batch, typed)', async () => {
	const { amcp, wire } = wireClient({ ...ctx.config, amcp_batch: true })
	const data = JSON.stringify({ title: PW })
	await assert.rejects(amcp.cgAdd(1, 10, 0, 'lower-thirds/x', 1, data), /carries the HighAsCG password/)
	await assert.rejects(amcp.raw(`PLAY 1-10 [HTML] "http://example.com/?token=${encodeURIComponent(PW)}"`), /password/)
	await assert.rejects(amcp.batchSend(['MIXER 1-10 OPACITY 1', `CG 1-10 UPDATE 0 ${JSON.stringify(data)}`]), /password/)
	await assert.rejects(amcp.cgUpdate(1, 10, 0, data), /password/)
	assert.deepEqual(wire, [], 'nothing reached the socket')
	assert.equal(prepareAmcpLine('MIXER 1-10 OPACITY 1', ctx.config).error, null, 'ordinary lines pass')
})

/** Run a template's wsAuthQuery() as the page would, with what the node handed it. */
function wsAuthQueryOf(rel, { hash = '', key } = {}) {
	const m = read(rel).match(/function wsAuthQuery\(\) \{[\s\S]*?\n\s*\}\n\s*\}\n/)
	assert.ok(m, `${rel}: wsAuthQuery present`)
	const sandbox = { window: key ? { __HIGHASCG_TEMPLATE_KEY__: key } : {}, location: { search: '?token=pw', hash }, URLSearchParams, encodeURIComponent }
	return vm.runInNewContext(`${m[0]}; wsAuthQuery()`, sandbox)
}

test('templates: each real template WS URL, from what the node hands it, is accepted (enforcement ON)', async () => {
	for (const rel of ['template/multiview_overlay.js', 'template/multiview_master.js', 'template/playback_timers.js']) {
		assert.equal(wsAuthQueryOf(rel), '', `${rel}: nothing handed → the URL of before (page ?token= is ignored)`)
		const fromData = wsAuthQueryOf(rel, { key: KEY })
		const fromUrl = wsAuthQueryOf(rel, { hash: `#template_key=${KEY}` })
		assert.equal(fromData, `?${q}`, `${rel}: CG data`)
		assert.equal(fromUrl, `?${q}`, `${rel}: #template_key=`)
		assert.equal(await wsTry(`/api/ws${fromData}`), 'open', `${rel}: its WS opens`)
		assert.match(read(rel), /new WebSocket\([^\n]*wsAuthQuery\(\)\)/, `${rel}: used on connect`)
		assert.ok(!/__HIGHASCG_WS_TOKEN__|get\('token'\)|apiToken/.test(read(rel)), `${rel}: no shared-password path left`)
	}
	for (const rel of ['template/multiview_overlay.js', 'template/multiview_master-labels.js']) {
		assert.match(read(rel), /if \(data && data\.templateKey\) window\.__HIGHASCG_TEMPLATE_KEY__ = String\(data\.templateKey\)/, rel)
	}
	// shader FFT tier: the URL lines of initTierB, run as the page runs them
	const player = read('template/shaders/player.js')
	assert.match(player, /if \(data\.templateKey\) window\.__HIGHASCG_TEMPLATE_KEY__ = String\(data\.templateKey\)/)
	const lines = player.match(/\t\t\tconst tok = [^\n]+\n\t\t\turl = [^\n]+\n/)
	assert.ok(lines, 'initTierB URL lines')
	const url = vm.runInNewContext(`let url; const origin = 'http://127.0.0.1:${port}'; ${lines[0]}; url`, {
		window: { __HIGHASCG_TEMPLATE_KEY__: KEY },
		location: { hash: '' },
		URLSearchParams,
		encodeURIComponent,
	})
	assert.equal(url, `ws://127.0.0.1:${port}/api/ws?${q}`)
	assert.equal(await wsTry(url.replace(`ws://127.0.0.1:${port}`, '')), 'open', 'shader FFT tier WS opens')
	assert.match(player, /ws\.onclose = \(\) => \{\n\t\t\t\tif \(!THUMB_MODE\) setTimeout\(initTierB, 2000\)/, 'retries once the key arrives')
	assert.ok(!/__HIGHASCG_WS_TOKEN__|query\.get\('token'\)|apiToken/.test(player), 'player: no shared-password path left')
})

test('the shared password is no longer put into the multiview data', () => {
	const src = read('src/engine/multiview-apply-overlay.js')
	assert.ok(!/apiToken|templateApiToken|getExpectedApiToken/.test(src))
	assert.equal(auth.templateApiToken, undefined, 'the old helper is gone')
})
