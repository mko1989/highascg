'use strict'

/**
 * routes-pixelhue.js — WO-1035: read-only PixelHue layer positions for overlays that follow switcher layers.
 *
 *   GET  /api/pixelhue/config            { host }
 *   POST /api/pixelhue/config { host }   the switcher (or its control PC) address; '' forgets it
 *   GET  /api/pixelhue/layers            { ok, host, device, at, screens: [{ screenId, name, enabled, width, height,
 *                                          layers: [{ layerId, name, scene, type, zorder, enabled, opacity,
 *                                                     x, y, width, height, source, … }] }] }
 *        ?screen=<screenId>              that screen only
 *        ?scene=pgm|pvw                  layers of that bus only
 *
 * The address is machine-local (~/.highascg/pixelhue.json), like the box's other per-site facts: a show file moved to
 * another venue must not point at this venue's switcher.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { createPixelhueReader } = require('../pixelhue/pixelhue-read')

const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: jsonBody(obj) })
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/

function storePath(deps = {}) {
	if (deps.storePath) return deps.storePath
	/* the offline suite must never read or write the box's own file */
	if (require('../engine/projects-root').underTestRunner()) return path.join(os.tmpdir(), `highascg-pixelhue-${process.pid}.json`)
	return path.join(process.env.HOME || os.homedir(), '.highascg', 'pixelhue.json')
}

function readHost(deps) {
	try {
		const host = String(JSON.parse(fs.readFileSync(storePath(deps), 'utf8'))?.host || '').trim()
		return HOST_RE.test(host) ? host : ''
	} catch {
		return ''
	}
}

let reader = null

function handleSetConfig(body, deps = {}) {
	const host = String((parseBody(body) || {}).host ?? '').trim()
	if (host && !HOST_RE.test(host)) return reply(400, { error: 'host must be an IP address or host name' })
	const file = storePath(deps)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, `${JSON.stringify({ host }, null, 2)}\n`)
	reader = null
	return reply(200, { ok: true, host })
}

async function handleLayers(query, deps = {}) {
	const host = readHost(deps)
	if (!host) return reply(409, { error: 'no PixelHue address set — POST /api/pixelhue/config { host }' })
	if (!reader || reader.host !== host) reader = (deps.createReader || createPixelhueReader)(host)
	let snap
	try {
		snap = await reader.read()
	} catch (e) {
		return reply(502, { error: `PixelHue at ${host} did not answer: ${e?.message || e}` })
	}
	const screenId = query?.screen != null && query.screen !== '' ? Number(query.screen) : null
	const scene = String(query?.scene || '').toLowerCase()
	const screens = snap.screens
		.filter((s) => screenId == null || s.screenId === screenId)
		.map((s) => (scene ? { ...s, layers: s.layers.filter((l) => l.scene === scene) } : s))
	return reply(200, { ok: true, host: snap.host, device: snap.device, at: snap.at, screens })
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/pixelhue/config', () => reply(200, { host: readHost() }), opt)
	routes.post('/api/pixelhue/config', ({ body }) => handleSetConfig(body), opt)
	routes.get('/api/pixelhue/layers', ({ query }) => handleLayers(query), opt)
}

module.exports = { register, handleSetConfig, handleLayers }
