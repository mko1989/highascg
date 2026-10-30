'use strict'

/**
 * WO-869 — find out on every Caspar (re)connect whether the running binary draws screen slices, without touching
 * anything on air.
 *
 * 1. `INFO <ch>` for each channel until one carries a screen consumer: the fork reports `<slices>n</slices>` in every
 *    screen consumer's state, stock 2.5.1 does not (config/caspar-caps.js `screenSlicesFromInfoXml`). Read-only.
 * 2. No screen consumer anywhere (all heads on DeckLink, or nothing configured yet): `APPLY <ch>-65535 SLICES CLEAR`.
 *    No consumer has index 65535, so nothing changes; a binary without the APPLY command answers 400 (no slices for
 *    certain), one with it answers 403 "no consumer" (APPLY exists, slices still unknown → left null).
 *
 * The obvious probe, `APPLY <ch>-640 SLICES SET 0`, is NOT used: on a live slice window it clears the slices.
 */

const { setCasparCaps, screenSlicesFromInfoXml } = require('../config/caspar-caps')
const { infoResponseToXml } = require('../caspar/channel-info-xml')

const NO_CONSUMER_INDEX = 65535

/** True for the AMCP 400 reply ("Command not understood"): the binary has no such command. */
function isUnknownCommandError(e) {
	const msg = String(e?.message || e || '')
	return /^400\b|COMMAND_UNKNOWN|Command not understood/i.test(msg)
}

/** Channel numbers from a bare `INFO` reply ("1 1080p5000 PLAYING" per line). */
function channelsFromInfoList(res) {
	const lines = Array.isArray(res?.data) ? res.data : String(res?.data || '').split(/\r?\n/)
	const out = []
	for (const l of lines) {
		const m = String(l).trim().match(/^(\d+)\s/)
		if (m) out.push(Number(m[1]))
	}
	return out
}

/**
 * @param {object} ctx app context (amcp, log)
 * @returns {Promise<ReturnType<typeof import('../config/caspar-caps').getCasparCaps>|null>} null when not connected
 */
async function probeCasparCaps(ctx) {
	const amcp = ctx?.amcp
	if (!amcp || typeof amcp.info !== 'function' || typeof amcp.raw !== 'function') return null
	const log = (level, msg) => (typeof ctx.log === 'function' ? ctx.log(level, msg) : undefined)
	let channels = []
	try {
		channels = channelsFromInfoList(await amcp.info())
	} catch (e) {
		log('warn', `[caspar-caps] INFO: ${e?.message || e}`)
		return null
	}
	for (const ch of channels) {
		let found = null
		try {
			found = screenSlicesFromInfoXml(infoResponseToXml(await amcp.info(ch)))
		} catch {
			continue
		}
		if (found === null) continue
		const caps = setCasparCaps({ screenSlices: found, source: `info:${ch}` })
		log('info', `[caspar-caps] screen slices ${found ? 'supported' : 'NOT supported'} (INFO ${ch})`)
		return caps
	}
	if (!channels.length) return null
	try {
		await amcp.raw(`APPLY ${channels[0]}-${NO_CONSUMER_INDEX} SLICES CLEAR`)
	} catch (e) {
		if (isUnknownCommandError(e)) {
			log('info', '[caspar-caps] screen slices NOT supported (no APPLY command)')
			return setCasparCaps({ screenSlices: false, source: 'apply:400' })
		}
	}
	return setCasparCaps({ screenSlices: null, source: 'no-screen-consumer' })
}

module.exports = { probeCasparCaps, isUnknownCommandError }
