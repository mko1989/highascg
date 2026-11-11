'use strict'

/**
 * routes-pixelhue.js — WO-1035: read-only PixelHue layer positions for overlays that follow switcher layers.
 *
 *   GET  /api/pixelhue/config            { host, drive }
 *   POST /api/pixelhue/config { host?, drive? }   host: the switcher (or its control PC) address, '' forgets it;
 *                                        drive (WO-1038, default false): looks move the switcher's layers on a
 *                                        program take (src/pixelhue/pixelhue-look-drive.js) — the only write
 *   GET  /api/pixelhue/layers            { ok, host, device, at, screens: [{ screenId, name, enabled, width, height,
 *                                          layers: [{ layerId, name, scene, type, zorder, enabled, opacity,
 *                                                     x, y, width, height, source, fill, … }] }] }
 *                                        fill = the rectangle as a look-layer fill { x, y, scaleX, scaleY }: the
 *                                        layer inspector's "Match PixelHue layer" copies it onto a look layer
 *        ?screen=<screenId>              that screen only
 *        ?scene=pgm|pvw                  layers of that bus only
 *   GET  /api/pixelhue/sources           { ok, sources: [{ id, type, name, connected, connectorType? }] } — what a
 *                                        switcher layer can show (inputs, then screen PGM / PVW), for WO-1038
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

/** @returns {{ host: string, drive: boolean }} */
function readSettings(deps) {
	try {
		const j = JSON.parse(fs.readFileSync(storePath(deps), 'utf8')) || {}
		const host = String(j.host || '').trim()
		return { host: HOST_RE.test(host) ? host : '', drive: j.drive === true }
	} catch {
		return { host: '', drive: false }
	}
}
const readHost = (deps) => readSettings(deps).host

let reader = null

/** The one reader per address (its token and cache are shared by the layer list and the look drive). */
function readerFor(host, deps = {}) {
	if (!reader || reader.host !== host) reader = (deps.createReader || createPixelhueReader)(host)
	return reader
}

function handleSetConfig(body, deps = {}) {
	const b = parseBody(body) || {}
	const was = readSettings(deps)
	const host = b.host === undefined ? was.host : String(b.host ?? '').trim()
	if (host && !HOST_RE.test(host)) return reply(400, { error: 'host must be an IP address or host name' })
	// a new address never inherits the old one's permission to be written to
	const drive = b.drive === undefined ? (host === was.host ? was.drive : false) : b.drive === true
	const file = storePath(deps)
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, `${JSON.stringify({ host, drive: !!host && drive }, null, 2)}\n`)
	if (host !== was.host) reader = null
	return reply(200, { ok: true, host, drive: !!host && drive })
}

async function handleLayers(query, deps = {}) {
	const host = readHost(deps)
	if (!host) return reply(409, { error: 'no PixelHue address set — POST /api/pixelhue/config { host }' })
	let snap
	try {
		snap = await readerFor(host, deps).read()
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

async function handleSources(deps = {}) {
	const host = readHost(deps)
	if (!host) return reply(409, { error: 'no PixelHue address set — POST /api/pixelhue/config { host }' })
	try {
		return reply(200, { ok: true, sources: await readerFor(host, deps).sources() })
	} catch (e) {
		return reply(502, { error: `PixelHue at ${host} did not answer: ${e?.message || e}` })
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/pixelhue/config', () => reply(200, readSettings()), opt)
	routes.post('/api/pixelhue/config', ({ body }) => handleSetConfig(body), opt)
	routes.get('/api/pixelhue/layers', ({ query }) => handleLayers(query), opt)
	routes.get('/api/pixelhue/sources', () => handleSources(), opt)
}

module.exports = { register, handleSetConfig, handleLayers, handleSources, readSettings, readerFor }
