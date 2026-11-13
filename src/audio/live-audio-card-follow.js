'use strict'

/**
 * WO-1071 — a live audio input follows its sound card across USB re-enumeration.
 *
 * A slot's device is stored as `alsa://hw:<card index>,<device>`. The index is only the order the kernel met the cards
 * in: a USB interface that drops off the bus and comes back (box 13.11: the Scarlett Solo, five disconnects in 20 s,
 * `error -71`) takes the lowest free index — it was card 4, came back as card 3, and `hw:4,0` was by then the Radial
 * (playback only). So next to the device the slot remembers the card's ALSA id (`live_audio_input_<n>_card`, e.g. "USB"),
 * written when the operator picks the device, and followCards() rewrites the index when that id sits elsewhere.
 * capturePresent() tells the watchdog (live-audio-health.js) whether there is anything to open at all, so an unplugged
 * interface is waited for quietly instead of being re-PLAYed every tick.
 */

const fs = require('fs')

const CARDS_PATH = '/proc/asound/cards'
const cardKey = (slot) => `live_audio_input_${slot}_card`
const deviceKey = (slot) => `live_audio_input_${slot}_device`
const HW_RE = /^((?:alsa:\/\/)?(?:plug)?hw:)(\d+),(\d+)(.*)$/i

/** `/proc/asound/cards` → [{ index, id, name }] (" 3 [USB            ]: USB-Audio - Scarlett Solo USB"). */
function parseCards(text) {
	const out = []
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/^\s*(\d+)\s+\[([^\]]+)\]\s*:\s*\S+\s+-\s+(.*)$/)
		if (m) out.push({ index: parseInt(m[1], 10), id: m[2].trim(), name: m[3].trim() })
	}
	return out
}

/** The cards now. `ctx.asoundCards` (tests): the text of /proc/asound/cards, or a function returning it. */
function readCards(ctx) {
	const inj = ctx?.asoundCards
	if (typeof inj === 'function') return parseCards(inj())
	if (typeof inj === 'string') return parseCards(inj)
	try {
		return parseCards(fs.readFileSync(CARDS_PATH, 'utf8'))
	} catch {
		return null // no ALSA procfs (not Linux, a container): nothing is followed or judged
	}
}

/** Does card `index` have capture device `dev`? `ctx.asoundHasCapture` (tests) answers instead of procfs. */
function hasCapture(ctx, index, dev) {
	if (typeof ctx?.asoundHasCapture === 'function') return !!ctx.asoundHasCapture(index, dev)
	return fs.existsSync(`/proc/asound/card${index}/pcm${dev}c`)
}

/**
 * The operator saved the slots' devices (`body` = the POST): each slot whose device came in the body remembers the id
 * of the card that index is NOW. A device that is not `hw:N,M` (a named PCM, CARD= form) needs no memory.
 */
function rememberCards(cs, body, cards) {
	for (let i = 1; i <= 8; i++) {
		if (body && body[deviceKey(i)] == null) continue
		const m = String(cs[deviceKey(i)] || '').match(HW_RE)
		const card = m && Array.isArray(cards) ? cards.find((c) => c.index === parseInt(m[2], 10)) : null
		if (card) cs[cardKey(i)] = card.id
		else delete cs[cardKey(i)]
	}
	return cs
}

const rememberPicked = (cs, body, ctx) => rememberCards(cs, body, readCards(ctx))

/**
 * Every slot whose remembered card sits at another index gets its device rewritten (config saved).
 * @returns {{ moved: { slot: number, from: number, to: number, card: string }[] }}
 */
function followCards(ctx) {
	const cards = readCards(ctx)
	const cs = ctx?.config?.casparServer
	const moved = []
	if (!cards || !cs) return { moved }
	for (let i = 1; i <= 8; i++) {
		const id = String(cs[cardKey(i)] || '').trim()
		const m = String(cs[deviceKey(i)] || '').match(HW_RE)
		if (!id || !m) continue
		const at = parseInt(m[2], 10)
		if (cards.some((c) => c.index === at && c.id === id)) continue
		const now = cards.find((c) => c.id === id)
		if (!now) continue // unplugged: the index is kept for when it is back
		cs[deviceKey(i)] = `${m[1]}${now.index},${m[3]}${m[4]}`
		moved.push({ slot: i, from: at, to: now.index, card: id })
	}
	if (moved.length) {
		for (const mv of moved) {
			ctx.log?.('info', `[live-audio] slot ${mv.slot}: card "${mv.card}" is hw:${mv.to} now (was hw:${mv.from}) — following it`)
		}
		try {
			if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), casparServer: cs })
		} catch (e) {
			ctx.log?.('warn', `[live-audio] could not save the followed device: ${e?.message || e}`)
		}
	}
	return { moved }
}

/**
 * Is there a capture device to open for this slot right now?
 * @returns {{ present: boolean, why?: string }} present is true when it cannot be judged (a named PCM, no procfs)
 */
function capturePresent(ctx, slot) {
	const cs = ctx?.config?.casparServer || {}
	const m = String(cs[deviceKey(slot)] || '').match(HW_RE)
	const cards = readCards(ctx)
	if (!m || !cards) return { present: true }
	const index = parseInt(m[2], 10)
	const id = String(cs[cardKey(slot)] || '').trim()
	const card = cards.find((c) => c.index === index)
	if (id && (!card || card.id !== id)) return { present: false, why: `sound card "${id}" is not connected` }
	if (!card) return { present: false, why: `there is no sound card hw:${index}` }
	if (!hasCapture(ctx, index, parseInt(m[3], 10))) {
		return { present: false, why: `hw:${index},${m[3]} (${card.name}) has no capture — pick the input's device again` }
	}
	return { present: true }
}

/** A slot that runs remembers its card when it had none (configs from before WO-1071). */
function rememberRunningCard(ctx, slot) {
	const cs = ctx?.config?.casparServer
	if (!cs || cs[cardKey(slot)]) return false
	const before = cs[cardKey(slot)]
	rememberCards(cs, { [deviceKey(slot)]: true }, readCards(ctx))
	if (!cs[cardKey(slot)] || cs[cardKey(slot)] === before) return false
	try {
		if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), casparServer: cs })
	} catch {
		/* remembered in memory; the next save writes it */
	}
	return true
}

module.exports = { parseCards, readCards, rememberCards, rememberPicked, followCards, capturePresent, rememberRunningCard, cardKey }
