'use strict'

/**
 * WO-629 — LED test card control (src/engine/led-test-card-control.js):
 *   GET  /api/led-test-card/settings  — { settings, active, patterns: [{ id, name }], channels: [{ index, program,
 *                                        videoMode, outputs }] } (channels from the running Caspar config)
 *   POST /api/led-test-card/settings  — settings patch → { settings, applied? } (re-applies while the card is up)
 *   POST /api/led-test-card/master    — { enabled } → { ok, enabled, targets, failures }
 *   POST /api/led-test-card/channel   — { channel, enabled } → the dialog's per-channel "Show test card"
 * The per-channel template call itself stays POST /api/led-test-card (routes-led-test-card.js).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const ctl = require('../engine/led-test-card-control')
const { airHeldBy } = require('../replication/amcp-fanout')
const { airHeldReply } = require('../replication/air-held') // WO-1029 B2

const reply = (status, body) => ({ status, headers: JSON_HEADERS, body: jsonBody(body) })

/** Pure: the dialog's channel rows from state (configComparison.serverChannels + channelMap). */
function channelRows(st) {
	const program = (st?.channelMap?.programChannels || []).map((x) => parseInt(String(x), 10))
	const rows = Array.isArray(st?.configComparison?.serverChannels) ? st.configComparison.serverChannels : []
	return rows
		.filter((c) => Number.isFinite(c?.index))
		.map((c) => ({
			index: c.index,
			program: program.includes(c.index),
			videoMode: String(c.videoMode || ''),
			outputs:
				[c.hasScreen ? 'Screen' : '', c.hasDecklinkOutput ? 'DeckLink' : ''].filter(Boolean).join(' · ') ||
				'no screen / DeckLink',
		}))
		.sort((a, b) => a.index - b.index)
}

function handleGet(ctx) {
	const st = typeof ctx?.getState === 'function' ? ctx.getState() || {} : {}
	return reply(200, {
		settings: ctl.getSettings(),
		active: ctx?._ledTestPatternActive === true,
		patterns: ctl.PATTERNS.map(([id, name]) => ({ id, name })),
		channels: channelRows(st),
	})
}

async function handlePost(op, body, ctx) {
	const b = parseBody(body)
	if (op === 'settings') {
		const settings = ctl.saveSettings(b)
		if (ctx?._ledTestPatternActive !== true || !ctx.amcp) return reply(200, { settings })
		return reply(200, { settings, applied: await ctl.applyCard(ctx, true) })
	}
	if (op !== 'master' && op !== 'channel') return reply(404, { error: `Unknown test card operation: ${op}` })
	if (!ctx?.amcp) return reply(503, { error: 'Caspar not connected' })
	if (op === 'master') {
		const enabled = b.enabled === true
		// WO-1029 B2: the card goes only on the screens this server drives; a screen the master drives here is refused
		// (409 when that is every target), so the card is never flagged on for lines that were not sent.
		const st = typeof ctx?.getState === 'function' ? ctx.getState() || {} : {}
		const targets = ctl.planTargets(ctl.getSettings(), st.channelMap, enabled)
		const refused = targets.map((c) => airHeldBy(ctx, c)).filter(Boolean)
		if (refused.length && refused.length === targets.length) return airHeldReply(refused[0], { refused })
		const held = new Set(refused.map((h) => h.channel))
		const opts = refused.length ? { channels: targets.filter((c) => !held.has(c)), masterOff: !enabled } : {}
		const r = await ctl.applyCard(ctx, enabled, opts)
		return reply(r.ok ? 200 : 502, refused.length ? { ...r, refused } : r)
	}
	const ch = parseInt(String(b.channel), 10)
	if (!Number.isFinite(ch) || ch < 1) return reply(400, { error: 'channel must be a positive channel number' })
	const held = airHeldBy(ctx, ch) // WO-1029 B2: refused before the dialog's choice is stored or anything is sent
	if (held) return airHeldReply(held)
	const r = await ctl.setChannel(ctx, ch, b.enabled === true)
	return reply(r.ok ? 200 : 502, r)
}

module.exports = { channelRows, handleGet, handlePost }
