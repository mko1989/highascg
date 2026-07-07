'use strict'

const routingMap = require('../config/routing-map')
const { enrichExtraLiveSource } = require('../config/extra-live-source-enrich')

/**
 * @param {object} ctx
 * @param {object} patch
 */
function persistConfigPatch(ctx, patch) {
	if (!ctx.configManager) {
		Object.assign(ctx.config, patch)
		return true
	}
	return ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
}

/**
 * @param {object} existing
 * @param {number} decklinkDevice
 */
function patchDecklinkLiveSource(existing, decklinkDevice) {
	const device = parseInt(String(decklinkDevice ?? ''), 10)
	if (!Number.isFinite(device) || device < 1) throw new Error('DeckLink device index must be ≥ 1')
	return {
		...existing,
		decklinkDevice: device,
	}
}

/**
 * @param {object} ctx
 * @param {{ slot?: number, value?: string, connectorId?: string }} query
 */
function findDecklinkLiveEntry(ctx, query) {
	const list = Array.isArray(ctx.config?.extraLiveSources) ? ctx.config.extraLiveSources : []
	const slot = parseInt(String(query?.slot ?? ''), 10) || 0
	const value = String(query?.value || '').trim()
	const connectorId = String(query?.connectorId || '').trim()
	const idx = list.findIndex((s) => {
		if (String(s?.routeType || '') !== 'decklink') return false
		if (slot > 0 && Number(s.decklinkSlot) === slot) return true
		if (connectorId && String(s.connectorId || '') === connectorId) return true
		if (value && String(s.value || '') === value) return true
		return false
	})
	if (idx < 0) return null
	return { source: list[idx], idx, list }
}

/**
 * @param {object} ctx
 * @param {number} channel
 * @param {number} layer
 * @param {number} device
 */
async function playDecklinkInputNow(ctx, channel, layer, device) {
	if (!ctx?.amcp) return { ok: false, reason: 'amcp_disconnected' }
	const cl = `${channel}-${layer}`
	const cmds = [`STOP ${cl}`, `MIXER ${cl} CLEAR`, `PLAY ${cl} DECKLINK ${device}`]
	for (const cmd of cmds) {
		try {
			await ctx.amcp.raw(cmd)
		} catch (e) {
			const msg = e?.message || String(e)
			if (/404|already playing|PLAY FAILED/i.test(msg) && cmd.startsWith('STOP')) continue
			if (cmd.startsWith('PLAY')) return { ok: false, error: msg, commands: cmds }
		}
	}
	return { ok: true, commands: cmds }
}

/**
 * @param {object} ctx
 * @param {number} slot
 * @returns {{ channel: number, layer: number } | null}
 */
function decklinkInputChannelForSlot(ctx, slot) {
	const map = routingMap.getChannelMap(ctx.config || {})
	const entries = Array.isArray(map?.inputChannels) ? map.inputChannels : []
	const hit = entries.find((e) => e?.kind === 'decklink' && Number(e.slot) === slot)
	if (!hit?.channel) return null
	return {
		channel: hit.channel,
		layer: hit.layer ?? slot,
	}
}

/**
 * @param {object} ctx
 * @param {{ slot?: number, decklinkDevice?: number, value?: string, connectorId?: string }} payload
 */
async function updateDecklinkInputDevice(ctx, payload) {
	const slot = parseInt(String(payload?.slot ?? ''), 10) || 0
	const device = parseInt(String(payload?.decklinkDevice ?? ''), 10) || 0
	if (slot < 1 || slot > 8) return { ok: false, status: 400, error: 'Invalid DeckLink input slot' }
	if (device < 1) return { ok: false, status: 400, error: 'DeckLink device index must be ≥ 1' }

	const hit = findDecklinkLiveEntry(ctx, payload)
	const cs = { ...(ctx.config?.casparServer || {}) }
	cs[`decklink_input_${slot}_direction`] = 'in'
	cs[`decklink_input_${slot}_device`] = device

	let list = Array.isArray(ctx.config?.extraLiveSources) ? [...ctx.config.extraLiveSources] : []
	let updated = null
	if (hit) {
		try {
			updated = patchDecklinkLiveSource(hit.source, device)
		} catch (e) {
			return { ok: false, status: 400, error: e?.message || String(e) }
		}
		list[hit.idx] = updated
	}

	if (!persistConfigPatch(ctx, { casparServer: cs, extraLiveSources: list })) {
		return { ok: false, status: 503, error: 'Failed to save config' }
	}
	ctx.config.casparServer = cs
	ctx.config.extraLiveSources = list

	const channelInfo = decklinkInputChannelForSlot(ctx, slot)
	let playResult
	if (channelInfo) {
		try {
			playResult = await playDecklinkInputNow(ctx, channelInfo.channel, channelInfo.layer, device)
		} catch (e) {
			playResult = { ok: false, error: e?.message || String(e) }
		}
	}

	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
	}

	const hostChannel = channelInfo?.channel ?? updated?.inputsChannel ?? null
	return {
		ok: true,
		action: 'update',
		slot,
		decklinkDevice: device,
		hostChannel,
		source: updated ? enrichExtraLiveSource(updated, ctx) : null,
		extraLiveSources: list.map((x) => enrichExtraLiveSource(x, ctx)),
		decklinkPlay: playResult,
		casparRestartRecommended: false,
		message: hostChannel
			? `DeckLink device ${device} on ch ${hostChannel} (route unchanged)`
			: `DeckLink device ${device} saved for slot ${slot}`,
	}
}

/**
 * @param {object} ctx
 * @param {{ slot?: number, value?: string, connectorId?: string }} payload
 */
async function reloadDecklinkInputDevice(ctx, payload) {
	const slot = parseInt(String(payload?.slot ?? ''), 10) || 0
	if (slot < 1) return { ok: false, status: 400, error: 'Invalid DeckLink input slot' }
	const hit = findDecklinkLiveEntry(ctx, payload)
	const device =
		parseInt(String(hit?.source?.decklinkDevice ?? routingMap.resolveDecklinkInputDeviceIndex(ctx.config, slot)), 10) ||
		0
	if (device < 1) return { ok: false, status: 404, error: 'DeckLink input not configured' }

	const channelInfo = decklinkInputChannelForSlot(ctx, slot)
	if (!channelInfo) return { ok: false, status: 404, error: 'DeckLink host channel not found' }

	let playResult
	try {
		playResult = await playDecklinkInputNow(ctx, channelInfo.channel, channelInfo.layer, device)
	} catch (e) {
		playResult = { ok: false, error: e?.message || String(e) }
	}

	return {
		ok: true,
		action: 'reload',
		slot,
		decklinkDevice: device,
		hostChannel: channelInfo.channel,
		decklinkPlay: playResult,
		message: `Reloaded DeckLink ${device} on ch ${channelInfo.channel}`,
	}
}

/**
 * @param {object} ctx
 * @param {object} payload
 */
async function handleDecklinkHostLive(ctx, payload) {
	const action = String(payload?.action || 'update').toLowerCase()
	if (action === 'update') {
		return updateDecklinkInputDevice(ctx, payload)
	}
	if (action === 'reload') {
		return reloadDecklinkInputDevice(ctx, payload)
	}
	return { ok: false, status: 400, error: 'action must be update or reload' }
}

module.exports = {
	patchDecklinkLiveSource,
	updateDecklinkInputDevice,
	reloadDecklinkInputDevice,
	handleDecklinkHostLive,
}
