'use strict'

/**
 * WO-616 T7 — what a trigger-zone transition fires. OpenFollow sends one OSC address per transition; this box has
 * no outbound OSC (PSN / OSC output dropped by the owner, T6), so a zone's four slots name an action instead:
 *
 *   look:<sceneId>            take that stored look to program (the WO-598 take-look path — no second take path)
 *   look:<sceneId>@preview    stage it on preview instead
 *   companion:<page>/<row>/<col>   press that Companion button (the timeline flag's HTTP press, WO-24 / WO-547)
 *   ''                        nothing (the zone still tracks occupancy — OpenFollow's blank destination)
 */

const LOOK = /^look:([^@\s]+)(?:@(program|preview))?$/
const COMPANION = /^companion:(\d{1,3})\/(\d{1,3})\/(\d{1,3})$/

/** → null (blank) | { type: 'look', sceneId, target } | { type: 'companion', page, row, col } | { type: 'invalid', error } */
function parseAction(text) {
	const s = String(text ?? '').trim()
	if (!s) return null
	let m = LOOK.exec(s)
	if (m) return { type: 'look', sceneId: m[1], target: m[2] || 'program' }
	m = COMPANION.exec(s)
	if (m) return { type: 'companion', page: Number(m[1]), row: Number(m[2]), col: Number(m[3]) }
	return { type: 'invalid', error: `unknown action "${s}" (look:<id>[@preview] | companion:<page>/<row>/<col>)` }
}

/**
 * Run one parsed action. → Promise<{ ok, detail }>; never throws.
 * @param {object} ctx  server ctx (config, log …)
 * @param {{ takeLook?: Function, fetch?: Function }} [deps]  test seams
 */
async function runAction(action, ctx, deps = {}) {
	try {
		if (!action) return { ok: true, detail: 'none' }
		if (action.type === 'invalid') return { ok: false, detail: action.error }
		if (action.type === 'look') {
			const take = deps.takeLook || require('../api/routes-scene-take-look').handleTakeLook
			const r = await take({ sceneId: action.sceneId, target: action.target }, ctx)
			const ok = !r || !r.status || r.status < 400
			return { ok, detail: `look ${action.sceneId} → ${action.target}${ok ? '' : ` (${r.status} ${bodyError(r)})`}` }
		}
		if (action.type === 'companion') {
			const { resolveCompanionConfig } = require('../companion/companion-config')
			const { host, port } = resolveCompanionConfig(ctx?.config)
			const loc = `${action.page}/${action.row}/${action.col}`
			const res = await (deps.fetch || fetch)(`http://${host}:${port}/api/location/${loc}/press`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}',
			})
			return { ok: !!res.ok, detail: `companion ${loc} → ${res.status}` }
		}
		return { ok: false, detail: `unhandled action ${action.type}` }
	} catch (e) {
		return { ok: false, detail: String(e?.message || e) }
	}
}

function bodyError(r) {
	try {
		return JSON.parse(r.body).error || ''
	} catch (_) {
		return ''
	}
}

module.exports = { parseAction, runAction }
