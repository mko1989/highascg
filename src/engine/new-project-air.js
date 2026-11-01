'use strict'

/**
 * WO-919 F11 — a New project must not leave the old show on air.
 *
 * createNewProject() swaps the config, deck and persisted project, but PGM / PRV kept playing the old show's looks in
 * Caspar and `liveScenesByProgramChannel` / `liveAudioOnlyLooksByChannel` / the PGM layer banks still named look ids that
 * no longer exist (Load only prunes entries whose id is missing from the incoming project, project-activate.js — for an
 * empty starter show that is all of them, so New does the same, plus the Caspar side because there is nothing in a
 * starter show that could still be "the same look").
 *
 * Scope: the show's PGM + PRV channels only — captured from the OLD config, because the running Caspar still has the
 * old channel layout until the new one is applied. The operator GUI channel, host/input channels, multiview and
 * the stream/record bus are hardware, not show content, and are never touched. Screen timers (layers 980–989) are a
 * panel-owned registry, not look layers: a whole-channel CLEAR removes them, so they are re-added right after.
 */

const { getChannelMap } = require('../config/routing')
const { clearCasparChannel } = require('./caspar-channel-clear')

/**
 * PGM + PRV Caspar channels of a config, as numbers.
 * @param {object} [cfg]
 * @returns {number[]}
 */
function showAirChannels(cfg) {
	let map
	try {
		map = getChannelMap(cfg || {})
	} catch {
		return []
	}
	const all = [...(map?.programChannels || []), ...(map?.previewChannels || [])]
	const out = []
	for (const c of all) {
		const n = parseInt(c, 10)
		if (Number.isFinite(n) && n >= 1 && !out.includes(n)) out.push(n)
	}
	return out
}

/**
 * Clear the persisted "what is live" state (look ids, audio-only looks, PGM layer banks) and tell the clients.
 * @param {object} ctx
 * @returns {Promise<string[]>} channels that had a live look
 */
async function clearPersistedAir(ctx) {
	const liveSceneState = require('../state/live-scene-state')
	const audioOnly = require('../state/live-audio-only-look-state')
	const had = Object.keys(liveSceneState.getAll() || {})
	for (const ch of had) await liveSceneState.clearChannel(ch)
	for (const ch of Object.keys(audioOnly.getAll() || {})) await audioOnly.clearChannel(ch)
	if (ctx.liveDeck?.replaceProgramLayerBanks) {
		ctx.liveDeck.replaceProgramLayerBanks({})
		ctx.liveDeck.persistProgramLayerBanks?.()
	}
	liveSceneState.broadcastSceneLive(ctx)
	audioOnly.broadcastAudioOnlyLive(ctx)
	return had
}

/**
 * @param {object} ctx
 * @param {number[]} channels from showAirChannels(old config)
 * @returns {Promise<{ channels: number[], liveCleared: string[] }>}
 */
async function clearShowAir(ctx, channels) {
	const warn = (m) => typeof ctx?.log === 'function' && ctx.log('warn', m)
	try {
		const eng = ctx.timelineEngine
		const pb = eng?.getPlayback?.()
		if (pb?.timelineId) eng.stop(pb.timelineId, { skipAmcp: true }) // the CLEAR below is the stop
	} catch (e) {
		warn(`[project] new: timeline stop: ${e?.message || e}`)
	}
	let liveCleared = []
	try {
		liveCleared = await clearPersistedAir(ctx)
	} catch (e) {
		warn(`[project] new: live state clear: ${e?.message || e}`)
	}
	if (ctx.amcp) {
		for (const ch of channels || []) {
			try {
				await clearCasparChannel(ctx.amcp, ch, ctx)
				const lines = require('./screen-timers').linesForReAdd(ch)
				if (lines.length && typeof ctx.amcp.batchSendChunked === 'function') {
					await ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
				}
			} catch (e) {
				warn(`[project] new: clear ch ${ch}: ${e?.message || e}`)
			}
		}
	}
	if (typeof ctx.log === 'function') {
		ctx.log('info', `[project] new: cleared ${(channels || []).length} show channel(s) (${(channels || []).join(', ') || 'none'}), ${liveCleared.length} live look(s)`)
	}
	return { channels: channels || [], liveCleared }
}

module.exports = { showAirChannels, clearShowAir, clearPersistedAir }
