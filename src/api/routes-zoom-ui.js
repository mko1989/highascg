'use strict'

/**
 * WO-1012 — Zoom's own controls from HighAsCG, through Zoom's accessibility tree (src/zoom/zoom-ui.js).
 *   GET  /api/zoom/ui → { ok, running, inMeeting, waiting, preview, muted, video, tabs: [{ name, checked }],
 *                         sharing: [name], tiles: [{ name, window, activeSpeaker }], originalSound, settings }
 *   POST /api/zoom/ui { action, … } → the new state (or the action's own result)
 *        action: "mute" | "unmute" | "video_on" | "video_off" | "join" | "meeting_tab" | "share_tab" (what the main window shows)
 *                | "participants"          → { ok, participants: [{ name, me, host, muted, video, sharing }] }
 *                | "pin", name             → pin that participant in the main window ("" = remove the pin)
 *                | "settings"              → { ok, running: true } at once (a run takes about half a minute); the result is
 *                                            `settings` in the GET: { running } | { ok, changed: [{ setting, on, why }],
 *                                            alreadyRight, failed, missing } | { error }
 * A control Zoom no longer has by that (English) name is a 400 that names it.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { getZoomUi } = require('../zoom/zoom-ui')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })
const ui = (ctx) => getZoomUi((level, msg) => ctx?.log?.(level, msg))

async function guarded(fn) {
	try {
		return reply(200, await fn())
	} catch (e) {
		return reply(400, { ok: false, error: String(e.message || e) })
	}
}

function run(z, b) {
	switch (String(b.action || '')) {
		case 'mute':
			return z.setMute(true)
		case 'unmute':
			return z.setMute(false)
		case 'video_on':
			return z.setVideo(true)
		case 'video_off':
			return z.setVideo(false)
		case 'join':
			return z.join()
		case 'meeting_tab':
			return z.selectTab('meeting')
		case 'share_tab':
			return z.selectTab('share')
		case 'participants':
			return z.participants()
		case 'pin':
			return z.pin(b.name)
		case 'settings':
			return z.startSettings()
		default:
			throw new Error(`unknown Zoom action "${b.action || ''}"`)
	}
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/zoom/ui', ({ ctx }) => guarded(() => ui(ctx).state()), opt)
	routes.post('/api/zoom/ui', ({ ctx, body }) => guarded(async () => run(ui(ctx), parseBody(body) || {})), opt)
}

module.exports = { register }
