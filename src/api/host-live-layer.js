'use strict'

/**
 * WO-623 D — host-channel layer actions composed on the server.
 * `POST /api/host-live/layer {action, channel, layer, ...}` replaces the STOP / MIXER CLEAR /
 * PLAY sequences the web and Godot clients used to send one by one through `/api/raw`.
 *
 *   stop      STOP + MIXER CLEAR
 *   decklink  STOP + MIXER CLEAR + PLAY ch-l DECKLINK {device}
 *   route     STOP + MIXER CLEAR + PLAY ch-l {route} (+ MIXER OPACITY 0 unless audioOnly === false)
 *
 * STOP / CLEAR / OPACITY failures are tolerated and reported in `errors` (an empty layer is a
 * fine starting point); a failed PLAY is the action failing → 502.
 */

const { amcpForPlannedRoute } = require('../engine/live-input-route-reassert')

const ROUTE_RE = /^route:\/\/\d+(-\d+)?$/

/** @param {unknown} v */
function posInt(v) {
	const n = parseInt(String(v ?? ''), 10)
	return Number.isFinite(n) && n >= 1 ? n : 0
}

/**
 * @param {object} payload
 * @returns {{ cmds: string[] } | { status: number, error: string }}
 */
function planLayerAction(payload) {
	const action = String(payload?.action || '').toLowerCase()
	const channel = posInt(payload?.channel)
	const layer = posInt(payload?.layer)
	if (!channel || !layer) return { status: 400, error: 'channel and layer must be ≥ 1' }
	const cl = `${channel}-${layer}`
	if (action === 'stop') return { cmds: [`STOP ${cl}`, `MIXER ${cl} CLEAR`] }
	if (action === 'decklink') {
		const device = posInt(payload?.device)
		if (!device) return { status: 400, error: 'DeckLink device index must be ≥ 1' }
		return { cmds: [`STOP ${cl}`, `MIXER ${cl} CLEAR`, `PLAY ${cl} DECKLINK ${device}`] }
	}
	if (action === 'route') {
		const route = String(payload?.route || '').trim()
		if (!ROUTE_RE.test(route)) return { status: 400, error: 'route must be route://ch or route://ch-layer' }
		return { cmds: amcpForPlannedRoute({ channel, layer, route, audioOnly: payload?.audioOnly !== false }) }
	}
	return { status: 400, error: 'action must be stop, decklink or route' }
}

/**
 * @param {object} ctx
 * @param {object} payload
 */
async function handleHostLiveLayer(ctx, payload) {
	const plan = planLayerAction(payload)
	if ('status' in plan) return { ok: false, status: plan.status, error: plan.error }
	if (!ctx?.amcp) return { ok: false, status: 503, error: 'Caspar not connected' }
	const errors = []
	for (const cmd of plan.cmds) {
		try {
			await ctx.amcp.raw(cmd)
		} catch (e) {
			const msg = e?.message || String(e)
			if (cmd.startsWith('PLAY ')) return { ok: false, status: 502, error: `${cmd}: ${msg}`, commands: plan.cmds }
			errors.push({ cmd, error: msg })
		}
	}
	return { ok: true, action: String(payload.action).toLowerCase(), commands: plan.cmds, errors }
}

module.exports = { planLayerAction, handleHostLiveLayer }
