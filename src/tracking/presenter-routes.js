'use strict'

/**
 * WO-675 — HTTP for the presenter roster (presenters.js), under the tracking module's /api/tracking prefix:
 *   GET    /api/tracking/presenters/intake         the audio tech's phone page (presenter-intake.html)
 *   GET    /api/tracking/presenters                { presenters, suggestions, intake_path, intake_urls (the box's LAN addresses) }
 *   POST   /api/tracking/presenters                { name, mic?, note?, consent: true, photo: JPEG base64 } → 201
 *   DELETE /api/tracking/presenters                clear the whole roster (end of show)
 *   GET    /api/tracking/presenters/<id>/photo     image/jpeg
 *   POST   /api/tracking/presenters/<id>           { name?, mic?, note?, on_enter?, on_exit? }
 *   DELETE /api/tracking/presenters/<id>
 *   POST   /api/tracking/presenters/<id>/assign    { key }  (the operator's confirmation, owner D1)
 *   POST   /api/tracking/presenters/<id>/release
 * WO-712 R1 / WO-723: with this server's `presenters` duty resolved off (a linked server does tracking;
 * src/cluster/server-duties.js) the phone page and POST (new intake) answer 409 with a plain message; the roster, its
 * GET and the operator's edit / assign / release stay.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const BASE = '/api/tracking/presenters'
const INTAKE = path.join(__dirname, 'presenter-intake.html')

const INTAKE_OFF = 'Presenter intake is off on this server: a linked server does tracking (WO-723). Use that server.'
const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(obj) })

function parse(body) {
	try {
		return { data: JSON.parse(body || '{}') }
	} catch {
		return { error: reply(400, { error: 'body must be JSON' }) }
	}
}

/** The phone page on every non-loopback IPv4 address of the box (the operator reads one out to the tech). */
function intakeUrls(port, nets = os.networkInterfaces()) {
	const out = []
	for (const list of Object.values(nets || {})) {
		for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(`http://${a.address}:${port}/intake`)
	}
	return out
}

/** → a response, or null when the path is not a presenter route. */
async function handlePresenters(presenters, { method, path: rawPath, body, req, duties = require('../cluster/server-duties') }) {
	const p = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
	if (p !== BASE && !p.startsWith(BASE + '/')) return null
	if (!presenters) return reply(503, { error: 'presenter roster not running' })
	const intakeOff = () => reply(409, { error: INTAKE_OFF })
	if (p === BASE + '/intake' && method === 'GET') {
		if (!duties.has('presenters')) return intakeOff()
		return { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: fs.readFileSync(INTAKE, 'utf8') }
	}
	if (p === BASE) {
		if (method === 'GET') {
			const port = req?.socket?.localPort || Number(process.env.PORT) || 4200
			return reply(200, { ...presenters.snapshot(), intake_enabled: duties.has('presenters'), intake_path: BASE + '/intake', intake_urls: intakeUrls(port) })
		}
		if (method === 'POST') {
			if (!duties.has('presenters')) return intakeOff()
			const { data, error } = parse(body)
			if (error) return error
			const r = await presenters.create(data)
			return reply(r.status, r.body)
		}
		if (method === 'DELETE') {
			presenters.clear()
			return reply(200, { ok: true })
		}
		return null
	}
	const m = /^\/api\/tracking\/presenters\/(p\d+)(?:\/(photo|assign|release))?$/.exec(p)
	if (!m) return reply(404, { error: 'no such presenter route' })
	const [, id, sub] = m
	if (sub === 'photo' && method === 'GET') {
		const jpg = presenters.photo(id)
		return jpg ? { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }, body: jpg } : reply(404, { error: 'no such presenter' })
	}
	if (!sub && method === 'DELETE') return reply(presenters.remove(id) ? 200 : 404, { ok: true })
	if (method !== 'POST') return null
	const { data, error } = parse(body)
	if (error) return error
	const r = !sub ? presenters.update(id, data) : sub === 'assign' ? presenters.assign(id, data?.key) : sub === 'release' ? presenters.release(id) : null
	return r ? reply(r.status, r.body) : null
}

module.exports = { handlePresenters, intakeUrls, BASE }
