'use strict'

/**
 * WO-1029 plan 07 (C12) — "Channels only for the screens cabled here", one device-local switch (a linked server's own
 * switch is reached through /api/cluster/peers/:id/relay/api/cluster/channels-where-cabled).
 *   GET  /api/cluster/channels-where-cabled → { on, plan } — the dry run of flipping it (turn on when off, off when on)
 *   POST /api/cluster/channels-where-cabled { enable: bool, dryRun?: bool, force?: bool }
 *        dryRun (default true): the plan, writes nothing. dryRun: false: the flag + the by-role remap of persisted state,
 *        the server marked "restart needed"; Caspar is NOT restarted (the cluster Apply does that). `force` overrides the
 *        forceable refusals (a destination cabled nowhere, content on a channel that disappears).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { channelsWhereCabledEnabled } = require('../config/screen-channels')
const { planChannelsCabled, publicPlan } = require('../system/channels-cabled-plan')

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

function handleGet(ctx) {
	try {
		const on = channelsWhereCabledEnabled(ctx.config)
		return reply(200, { on, plan: publicPlan(planChannelsCabled(ctx, { enable: !on, includeProjects: false })) })
	} catch (e) {
		return reply(500, { error: e?.message || String(e) })
	}
}

async function handlePost(body, ctx) {
	const b = parseBody(body) || {}
	if (typeof b.enable !== 'boolean') return reply(400, { error: '"enable" (true | false) required' })
	try {
		if (b.dryRun !== false) {
			return reply(200, { ok: true, dryRun: true, on: channelsWhereCabledEnabled(ctx.config), plan: publicPlan(planChannelsCabled(ctx, { enable: b.enable })) })
		}
		const { runChannelsCabledSwitch } = require('../system/channels-cabled-switch')
		const log = typeof ctx.log === 'function' ? (level, msg) => ctx.log(level, msg) : undefined
		const { status, ...rest } = await runChannelsCabledSwitch(ctx, { enable: b.enable, force: b.force === true, log })
		return reply(status, { dryRun: false, ...rest })
	} catch (e) {
		if (typeof ctx.log === 'function') ctx.log('error', `[WO-1029] channels-where-cabled: ${e?.stack || e}`)
		return reply(500, { ok: false, error: e?.message || String(e) })
	}
}

module.exports = { handleGet, handlePost }
