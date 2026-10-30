'use strict'

/**
 * WO-868 — "Operator GUI first" (Caspar channel 1 + leftmost X monitor), one machine-local switch.
 *   GET  /api/system/operator-first  — { enabled, refusals, warnings, channels } for toggling it (no project scan)
 *   POST /api/system/operator-first  — { enable: bool, dryRun?: bool, force?: bool }
 *        dryRun (default true): the full plan — channel table before/after, the remap, config / state / project counts,
 *        the X layout before/after, refusals and warnings; writes nothing.
 *        dryRun: false: backup, renumber every store, set the flag, full apply (Caspar restart). `force` overrides only
 *        the on-air refusal.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { isOperatorGuiFirst } = require('../config/operator-gui-first')
const { planOperatorFirst, publicPlan } = require('../system/operator-first-plan')

function reply(status, body) {
	return { status, headers: JSON_HEADERS, body: jsonBody(body) }
}

function handleGet(ctx) {
	try {
		const enabled = isOperatorGuiFirst(ctx.config)
		const plan = planOperatorFirst(ctx, { enable: !enabled, includeProjects: false })
		return reply(200, { enabled, refusals: plan.refusals, warnings: plan.warnings, channels: plan.channels })
	} catch (e) {
		return reply(500, { error: e?.message || String(e) })
	}
}

async function handlePost(body, ctx) {
	const b = parseBody(body) || {}
	if (typeof b.enable !== 'boolean') return reply(400, { error: '"enable" (true | false) required' })
	try {
		if (b.dryRun !== false) {
			return reply(200, { ok: true, dryRun: true, ...publicPlan(planOperatorFirst(ctx, { enable: b.enable })) })
		}
		const { runOperatorFirstSwitch } = require('../system/operator-first-switch')
		const log = typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined
		const r = await runOperatorFirstSwitch(ctx, { enable: b.enable, force: b.force === true, log })
		const { status, ...rest } = r
		return reply(status, { dryRun: false, ...rest })
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('error', `[WO-868] operator-first: ${e?.stack || e}`)
		return reply(500, { ok: false, error: e?.message || String(e) })
	}
}

module.exports = { handleGet, handlePost }
