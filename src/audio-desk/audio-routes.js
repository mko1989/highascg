'use strict'

/**
 * WO-731 — HTTP for the audio operator's page (audio-page.html, short address /audio), next to the presenter intake:
 *   GET  /api/tracking/presenters/audio            the page
 *   GET  /api/tracking/presenters/audio/desk       { settings, status, accepted, models, threshold }
 *   POST /api/tracking/presenters/audio/desk       { model?, host?, port?, threshold_db?, mics? } → the same view
 *   GET  /api/tracking/presenters/audio/channels   { channels: [{ channel, name }] } read from the desk
 *   POST /api/tracking/presenters/audio/probe      ask the desk again → status
 *   POST /api/tracking/presenters/<id>/accept      that presenter's mic channel ON, fader ≥ threshold
 * With the presenters duty resolved off (a linked server does tracking, WO-723) the page answers 409 like the intake.
 */

const fs = require('fs')
const path = require('path')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }
const BASE = '/api/tracking/presenters'
const PAGE = path.join(__dirname, 'audio-page.html')
const PAGE_OFF = 'Presenter audio is off on this server: a linked server does tracking (WO-723). Use that server.'
const reply = (status, obj) => ({ status, headers: JSON_HEADERS, body: JSON.stringify(obj) })

/** → a response, or null when the path is not an audio route. */
async function handleAudioDesk(
	desk,
	presenters,
	{ method, path: rawPath, body, duties = require('../cluster/server-duties') }
) {
	const p = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath
	const accept = /^\/api\/tracking\/presenters\/(p\d+)\/accept$/.exec(p)
	if (!accept && p !== BASE + '/audio' && !p.startsWith(BASE + '/audio/')) return null
	if (p === BASE + '/audio' && method === 'GET') {
		if (!duties.has('presenters')) return reply(409, { error: PAGE_OFF })
		return {
			status: 200,
			headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
			body: fs.readFileSync(PAGE, 'utf8'),
		}
	}
	if (!desk) return reply(503, { error: 'audio desk link not running' })
	if (accept && method === 'POST') {
		const r = await desk.accept(presenters?.list().find((q) => q.id === accept[1]))
		return reply(r.status, r.body)
	}
	if (p === BASE + '/audio/desk' && method === 'GET') return reply(200, desk.view())
	if (p === BASE + '/audio/desk' && method === 'POST') {
		let data
		try {
			data = JSON.parse(body || '{}')
		} catch {
			return reply(400, { error: 'body must be JSON' })
		}
		const r = desk.setSettings(data)
		return reply(r.status, r.body)
	}
	if (p === BASE + '/audio/channels' && method === 'GET') {
		const r = await desk.channels()
		return reply(r.status, r.body)
	}
	if (p === BASE + '/audio/probe' && method === 'POST') return reply(200, { status: await desk.probe() })
	return reply(404, { error: 'no such audio route' })
}

module.exports = { handleAudioDesk }
