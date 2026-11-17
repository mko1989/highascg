'use strict'

/**
 * WO-1055 / WO-1106 B11 — the ALSA sound cards for the LTC device pickers (split from audio-devices.js, which re-exports
 * these; that file sits at the 500-line limit).
 */

const { execFileSync } = require('child_process')

/**
 * WO-1055: `aplay -l` / `arecord -l` card lines → picker entries whose value names the card by its ALSA id
 * (`plughw:CARD=USB,DEV=0`), which survives USB re-enumeration (the Scarlett was card 4 on 13.11; a replug can renumber it).
 * `plughw` converts rate / format / channel count, as LTC's aplay / arecord need.
 * @param {string} text
 * @returns {Array<{ value: string, label: string, card: number, device: number }>}
 */
function parseAlsaCardList(text) {
	const out = []
	for (const line of String(text || '').split('\n')) {
		const m = line.match(/^card\s+(\d+):\s*(\S+)\s*\[([^\]]*)\],\s*device\s+(\d+):\s*(.*?)\s*(?:\[([^\]]*)\])?\s*$/i)
		if (!m) continue
		const dev = parseInt(m[4], 10)
		const what = (m[6] || m[5] || '').trim()
		out.push({ value: `plughw:CARD=${m[2]},DEV=${dev}`, label: `${m[3].trim()} — ${what}`, card: parseInt(m[1], 10), device: dev })
	}
	return out
}

/**
 * WO-1055: the sound cards for one direction — `playback` (aplay -l) or `capture` (arecord -l) — for the LTC device pickers.
 * @param {'playback'|'capture'} dir
 * @param {(bin: string) => string|null} [run] test seam: returns the tool's `-l` output
 */
function listAlsaCards(dir, run) {
	const bin = dir === 'capture' ? 'arecord' : 'aplay'
	const exec =
		run ||
		((b) => {
			try {
				return execFileSync(b, ['-l'], { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'pipe'] })
			} catch {
				return null
			}
		})
	const text = exec(bin)
	return { dir: dir === 'capture' ? 'capture' : 'playback', cards: text == null ? [] : parseAlsaCardList(text), ok: text != null }
}

const ALSA_CARDS_CACHE_MS = 5000
const _alsaCards = { playback: null, capture: null } // { at, value } | { job }

/**
 * WO-1106 B11: listAlsaCards without blocking the event loop — `aplay -l` / `arecord -l` run async (a wedged USB card
 * held the sync call for 8 s, freezing AMCP / OSC / timeline ticks), one run shared by concurrent requests, cached 5 s.
 * @param {'playback'|'capture'} dir
 * @param {(bin: string) => Promise<string|null>|string|null} [run] test seam: the tool's `-l` output (no cache)
 * @returns {Promise<{ dir: string, cards: object[], ok: boolean }>}
 */
async function listAlsaCardsAsync(dir, run) {
	const d = dir === 'capture' ? 'capture' : 'playback'
	const bin = d === 'capture' ? 'arecord' : 'aplay'
	const shape = (text) => ({ dir: d, cards: text == null ? [] : parseAlsaCardList(text), ok: text != null })
	if (run) return shape(await Promise.resolve().then(() => run(bin)).catch(() => null))
	const c = _alsaCards[d]
	if (c?.value && Date.now() - c.at < ALSA_CARDS_CACHE_MS) return c.value
	if (c?.job) return c.job
	const job = new Promise((resolve) => {
		require('child_process').execFile(bin, ['-l'], { encoding: 'utf8', timeout: 8000 }, (err, out) => resolve(err ? null : out))
	}).then((text) => {
		const value = shape(text)
		_alsaCards[d] = { at: Date.now(), value }
		return value
	}, () => {
		_alsaCards[d] = null
		return shape(null)
	})
	_alsaCards[d] = { job }
	return job
}

module.exports = { parseAlsaCardList, listAlsaCards, listAlsaCardsAsync }
